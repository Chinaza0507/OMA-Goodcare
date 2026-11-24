import { Router } from 'express'
import { z } from 'zod'
import rateLimit from 'express-rate-limit'
import { query, withTx } from '../db.js'
import { signToken, requireAuth } from '../middleware/auth.js'
import { AppError } from '../lib/errors.js'
import { normalizePhone } from '../lib/phone.js'
import { hashSecret, verifySecret } from '../lib/secret.js'
import crypto from 'node:crypto'
import { cancelAppointment } from '../lib/booking.js'
import { emitQueueChanged } from '../lib/realtime.js'

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
  email: z.string().trim().toLowerCase().email().max(200).optional(),
  pin: z.string().regex(/^\d{4}$/, 'PIN must be 4 digits'),
  language: z.enum(LANGUAGES).default('en'),
  consent: z.literal(true), // NDPA consent is required at sign-up
})

const loginSchema = z.object({
  phone: phoneField,
  secret: z.string().min(4).max(72),
})

export const emailField = z.string().trim().toLowerCase().email().max(200)

const workLoginSchema = z.object({
  email: emailField,
  password: z.string().min(1).max(72),
})

const updateSchema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  language: z.enum(LANGUAGES).optional(),
  alertAhead: z.number().int().min(1).max(10).optional(),
  // Patients may add, change or clear their email (''). Hospital/staff emails are their log-in.
  email: z.union([emailField, z.literal('')]).optional(),
})

export const publicUser = (u) => ({
  id: u.id,
  name: u.name,
  phone: u.phone,
  email: u.email,
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
        `INSERT INTO users (role, name, phone, email, secret_hash, language, consent_at)
         VALUES ('patient', $1, $2, $3, $4, $5, now()) RETURNING *`,
        [data.name, data.phone, data.email ?? null, hash, data.language],
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

// Shared by both sign-ins: lockout after repeated failures, constant-time-ish when the
// account does not exist, and the same error either way so accounts cannot be probed.
async function signIn(user, secret) {
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
  return { token: signToken(user), user: publicUser(user) }
}

// Patients: phone number + 4-digit PIN.
router.post('/login', authLimiter, async (req, res) => {
  const { phone, secret } = loginSchema.parse(req.body)
  const { rows } = await query(`SELECT * FROM users WHERE phone = $1 AND role = 'patient'`, [phone])
  res.json(await signIn(rows[0], secret))
})

// Hospitals (front desk), staff and Oma admins: official email + password.
router.post('/work-login', authLimiter, async (req, res) => {
  const { email, password } = workLoginSchema.parse(req.body)
  const { rows } = await query(
    `SELECT u.*, c.name AS clinic_name, c.status AS clinic_status FROM users u
     LEFT JOIN clinics c ON c.id = u.clinic_id
     WHERE lower(u.email) = $1 AND u.role <> 'patient'`,
    [email],
  )
  const result = await signIn(rows[0], password)
  const u = rows[0]
  res.json({ ...result, clinic: u.clinic_id ? { id: u.clinic_id, name: u.clinic_name, status: u.clinic_status } : null })
})

router.get('/me', requireAuth, async (req, res) => {
  const { rows } = await query('SELECT * FROM users WHERE id = $1', [req.user.id])
  if (!rows[0]) throw new AppError(401, 'session_expired')
  if (!rows[0].active) throw new AppError(403, 'account_disabled')

  // School-clinic booking rule: surfaces the first-miss warning and any active block.
  const { rows: tracking } = await query(
    `SELECT t.clinic_id, c.name AS clinic_name, t.miss_count, t.blocked_until
     FROM noshow_tracking t JOIN clinics c ON c.id = t.clinic_id
     WHERE t.user_id = $1 AND (t.miss_count > 0 OR t.blocked_until > now())`,
    [req.user.id],
  )
  let clinic = null
  if (rows[0].clinic_id) {
    const { rows: c } = await query('SELECT id, name, status FROM clinics WHERE id = $1', [rows[0].clinic_id])
    clinic = c[0] ?? null
  }
  res.json({
    user: publicUser(rows[0]),
    clinic,
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
  if (data.email !== undefined && req.user.role !== 'patient') throw new AppError(403, 'forbidden')
  const user = await withTx(async (db) => {
    const { rows } = await db.query(
      `UPDATE users SET name = COALESCE($2, name), language = COALESCE($3, language),
         alert_ahead = COALESCE($4, alert_ahead),
         email = CASE WHEN $5 THEN NULLIF($6, '') ELSE email END
       WHERE id = $1 RETURNING *`,
      [req.user.id, data.name ?? null, data.language ?? null, data.alertAhead ?? null, data.email !== undefined, data.email ?? null],
    )
    // Keep the "self" family member's name in step, so new bookings use the new name.
    if (data.name) await db.query('UPDATE family_members SET name = $2 WHERE owner_id = $1 AND is_self', [req.user.id, data.name])
    return rows[0]
  })
  res.json({ user: publicUser(user) })
})

// Change PIN (patients: 4 digits) or password (staff/hospital/admin: 8+ characters).
router.post('/change-secret', authLimiter, requireAuth, async (req, res) => {
  const { current, next } = z.object({ current: z.string().min(1).max(72), next: z.string().min(4).max(72) }).parse(req.body)
  const { rows } = await query('SELECT * FROM users WHERE id = $1 AND active', [req.user.id])
  const user = rows[0]
  if (!user) throw new AppError(401, 'session_expired')
  const valid = user.role === 'patient' ? /^\d{4}$/.test(next) : next.length >= 8
  if (!valid) throw new AppError(400, 'invalid_input')
  if (!(await verifySecret(current, user.secret_hash))) throw new AppError(401, 'wrong_secret')
  await query('UPDATE users SET secret_hash = $2 WHERE id = $1', [user.id, await hashSecret(next)])
  res.json({ ok: true })
})

// ----- Forgot PIN (patients) -----
// No SMS provider is connected yet, so in development the code is returned for on-screen
// testing ("practice mode"). In production it must be sent by SMS and is never returned.
const RESET_MINUTES = 10
const RESET_TRIES = 5
const showCodeOnScreen = () => process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test'

router.post('/forgot-pin', authLimiter, async (req, res) => {
  const { phone } = z.object({ phone: phoneField }).parse(req.body)
  const { rows } = await query(`SELECT id FROM users WHERE phone = $1 AND role = 'patient' AND active`, [phone])
  const user = rows[0]
  let code = null
  if (user) {
    code = String(crypto.randomInt(100000, 1000000))
    await withTx(async (db) => {
      await db.query('UPDATE pin_resets SET used_at = now() WHERE user_id = $1 AND used_at IS NULL', [user.id])
      await db.query(
        `INSERT INTO pin_resets (user_id, code_hash, expires_at) VALUES ($1, $2, now() + make_interval(mins => $3))`,
        [user.id, await hashSecret(code), RESET_MINUTES],
      )
    })
    if (!showCodeOnScreen()) throw new AppError(503, 'reset_unavailable') // until an SMS provider is connected
  }
  // Same answer whether or not the number has an account, so numbers can't be probed.
  res.json({ ok: true, minutes: RESET_MINUTES, ...(showCodeOnScreen() && code ? { practiceCode: code } : {}) })
})

router.post('/reset-pin', authLimiter, async (req, res) => {
  const { phone, code, pin } = z
    .object({ phone: phoneField, code: z.string().regex(/^\d{6}$/), pin: z.string().regex(/^\d{4}$/) })
    .parse(req.body)
  const { rows } = await query(
    `SELECT r.*, u.id AS uid FROM pin_resets r JOIN users u ON u.id = r.user_id
     WHERE u.phone = $1 AND u.role = 'patient' AND u.active AND r.used_at IS NULL AND r.expires_at > now()
     ORDER BY r.created_at DESC LIMIT 1`,
    [phone],
  )
  const reset = rows[0]
  if (!reset || reset.attempts >= RESET_TRIES) throw new AppError(400, 'code_expired')
  if (!(await verifySecret(code, reset.code_hash))) {
    await query('UPDATE pin_resets SET attempts = attempts + 1 WHERE id = $1', [reset.id])
    throw new AppError(400, 'bad_code', { triesLeft: RESET_TRIES - reset.attempts - 1 })
  }
  await withTx(async (db) => {
    await db.query('UPDATE pin_resets SET used_at = now() WHERE id = $1', [reset.id])
    await db.query('UPDATE users SET secret_hash = $2, failed_attempts = 0, locked_until = NULL WHERE id = $1', [reset.uid, await hashSecret(pin)])
  })
  res.json({ ok: true })
})

// Delete my account (patients). Upcoming visits are cancelled under the normal rules, and the
// person's name, phone and email are erased. Hospital visit records stay, with the name replaced,
// because hospitals must keep attendance records. The Kolo history is append-only and stays.
router.post('/delete-account', authLimiter, requireAuth, async (req, res) => {
  if (req.user.role !== 'patient') throw new AppError(403, 'forbidden')
  const { secret } = z.object({ secret: z.string().min(1).max(72) }).parse(req.body)
  const { rows } = await query('SELECT * FROM users WHERE id = $1 AND active', [req.user.id])
  const user = rows[0]
  if (!user) throw new AppError(401, 'session_expired')
  if (!(await verifySecret(secret, user.secret_hash))) throw new AppError(401, 'wrong_secret')

  const events = await withTx(async (db) => {
    const { rows: upcoming } = await db.query(
      `SELECT id FROM appointments WHERE booked_by = $1 AND status = 'booked'`,
      [user.id],
    )
    const emitted = []
    for (const a of upcoming) emitted.push(await cancelAppointment(db, { appointmentId: a.id, userId: user.id, confirm: true }))
    await db.query(`UPDATE appointments SET patient_name = 'Deleted patient', patient_phone = NULL WHERE booked_by = $1`, [user.id])
    await db.query(`UPDATE family_members SET name = 'Deleted', age = NULL WHERE owner_id = $1`, [user.id])
    await db.query(
      `UPDATE users SET name = 'Deleted account', phone = $2, email = NULL, secret_hash = $3, active = false
       WHERE id = $1`,
      [user.id, `deleted:${user.id}`, await hashSecret(crypto.randomBytes(24).toString('hex'))],
    )
    return emitted
  })
  events.forEach((e) => emitQueueChanged(e.clinicId, e.departmentId))
  res.json({ ok: true })
})

export default router
