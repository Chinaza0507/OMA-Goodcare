import { Router } from 'express'
import { z } from 'zod'
import rateLimit from 'express-rate-limit'
import { query, withTx } from '../db.js'
import { signToken, requireAuth } from '../middleware/auth.js'
import { AppError } from '../lib/errors.js'
import { normalizePhone } from '../lib/phone.js'
import { hashSecret, verifySecret } from '../lib/secret.js'

const router = Router()

export const LANGUAGES = ['en', 'pcm', 'yo', 'ig', 'ha']
const MAX_FAILED_ATTEMPTS = 5
const LOCK_MINUTES = 15

// Slows guessing from one address. Per-account lockout (below) stops guessing across addresses.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.AUTH_RATE_LIMIT) || 30,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => res.status(429).json({ error: 'too_many_requests' }),
})

export const phoneField = z
  .string()
  .transform((v, ctx) => {
    const phone = normalizePhone(v)
    if (!phone) ctx.addIssue({ code: 'custom', message: 'invalid_phone' })
    return phone
  })

const registerSchema = z.object({
  name: z.string().trim().min(2).max(100),
  phone: phoneField,
  pin: z.string().regex(/^\d{4}$/, 'PIN must be 4 digits'),
  language: z.enum(LANGUAGES).default('en'),
  consent: z.literal(true), // NDPA consent is required at sign-up
})

const loginSchema = z.object({
  phone: phoneField,
  secret: z.string().min(4).max(72),
})

const updateSchema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  language: z.enum(LANGUAGES).optional(),
  alertAhead: z.number().int().min(1).max(10).optional(),
})

export const publicUser = (u) => ({
  id: u.id,
  name: u.name,
  phone: u.phone,
  role: u.role,
  language: u.language,
  alertAhead: u.alert_ahead,
  clinicId: u.clinic_id,
})

// A fixed hash to compare against when the phone is unknown, so response time
// does not reveal which numbers have accounts.
const DUMMY_HASH_PROMISE = hashSecret('0000')

router.post('/register', authLimiter, async (req, res) => {
  const data = registerSchema.parse(req.body)
  const hash = await hashSecret(data.pin)

  try {
    const user = await withTx(async (db) => {
      const { rows } = await db.query(
        `INSERT INTO users (role, name, phone, secret_hash, language, consent_at)
         VALUES ('patient', $1, $2, $3, $4, now()) RETURNING *`,
        [data.name, data.phone, hash, data.language],
      )
      // Every account starts with the owner as their own "family member" so booking
      // for yourself and for family work the same way.
      await db.query('INSERT INTO family_members (owner_id, name, is_self) VALUES ($1, $2, true)', [
        rows[0].id,
        data.name,
      ])
      return rows[0]
    })
    res.status(201).json({ token: signToken(user), user: publicUser(user) })
  } catch (err) {
    if (err.code === '23505') throw new AppError(409, 'phone_taken')
    throw err
  }
})

router.post('/login', authLimiter, async (req, res) => {
  const { phone, secret } = loginSchema.parse(req.body)
  const { rows } = await query('SELECT * FROM users WHERE phone = $1', [phone])
  const user = rows[0]

  if (user && !user.active) throw new AppError(403, 'account_disabled')
  if (user?.locked_until && new Date(user.locked_until) > new Date()) {
    throw new AppError(429, 'account_locked', { until: user.locked_until })
  }

  const ok = await verifySecret(secret, user ? user.secret_hash : await DUMMY_HASH_PROMISE)
  if (!user || !ok) {
    if (user) {
      const attempts = user.failed_attempts + 1
      const lock = attempts >= MAX_FAILED_ATTEMPTS
      await query(
        `UPDATE users SET failed_attempts = $2,
           locked_until = CASE WHEN $3 THEN now() + make_interval(mins => $4) ELSE locked_until END
         WHERE id = $1`,
        [user.id, lock ? 0 : attempts, lock, LOCK_MINUTES],
      )
    }
    throw new AppError(401, 'bad_credentials')
  }

  if (user.failed_attempts > 0 || user.locked_until) {
    await query('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = $1', [user.id])
  }
  res.json({ token: signToken(user), user: publicUser(user) })
})

router.get('/me', requireAuth, async (req, res) => {
  const { rows } = await query('SELECT * FROM users WHERE id = $1', [req.user.id])
  if (!rows[0]) throw new AppError(401, 'session_expired')

  // School-clinic booking rule: surfaces the first-miss warning and any active block.
  const { rows: tracking } = await query(
    `SELECT t.clinic_id, c.name AS clinic_name, t.miss_count, t.blocked_until
     FROM noshow_tracking t JOIN clinics c ON c.id = t.clinic_id
     WHERE t.user_id = $1 AND (t.miss_count > 0 OR t.blocked_until > now())`,
    [req.user.id],
  )
  res.json({
    user: publicUser(rows[0]),
    noShowStatus: tracking.map((t) => ({
      clinicId: t.clinic_id,
      clinicName: t.clinic_name,
      missCount: t.miss_count,
      blockedUntil: t.blocked_until && new Date(t.blocked_until) > new Date() ? t.blocked_until : null,
    })),
  })
})

router.patch('/me', requireAuth, async (req, res) => {
  const data = updateSchema.parse(req.body)
  const { rows } = await query(
    `UPDATE users SET name = COALESCE($2, name), language = COALESCE($3, language),
       alert_ahead = COALESCE($4, alert_ahead) WHERE id = $1 RETURNING *`,
    [req.user.id, data.name ?? null, data.language ?? null, data.alertAhead ?? null],
  )
  res.json({ user: publicUser(rows[0]) })
})

export default router
