import { Router } from 'express'
import { z } from 'zod'
import rateLimit from 'express-rate-limit'
import { withTx } from '../db.js'
import { signToken } from '../middleware/auth.js'
import { AppError } from '../lib/errors.js'
import { hashSecret } from '../lib/secret.js'
import { logAction } from '../lib/log.js'
import { emailField, publicUser, LANGUAGES } from './auth.js'

const router = Router()

const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: Number(process.env.AUTH_RATE_LIMIT) || 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => res.status(429).json({ error: 'too_many_requests' }),
})

export const CLINIC_TYPES = ['public', 'mission', 'private', 'school']
// School clinics are fully covered by school fees: no deposit, booking rule instead.
export const billingTypeFor = (type) => (type === 'school' ? 'covered' : 'paid')

const registerSchema = z.object({
  hospitalName: z.string().trim().min(2).max(120),
  type: z.enum(CLINIC_TYPES),
  state: z.string().trim().min(2).max(60),
  area: z.string().trim().min(2).max(60),
  address: z.string().trim().min(3).max(200),
  landmark: z.string().trim().max(200).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  email: emailField, // the hospital's official email: its sign-in for the front desk
  password: z.string().min(8).max(72),
  language: z.enum(LANGUAGES).default('en'),
})

// Register a hospital: creates the clinic (pending until an Oma admin approves it) and the
// hospital's own sign-in (official email + password), shared by whoever is at the front desk.
router.post('/register', signupLimiter, async (req, res) => {
  const d = registerSchema.parse(req.body)
  if ((d.latitude == null) !== (d.longitude == null)) throw new AppError(400, 'invalid_input')
  const hash = await hashSecret(d.password)

  try {
    const { clinic, manager } = await withTx(async (db) => {
      const { rows: c } = await db.query(
        `INSERT INTO clinics (name, type, billing_type, state, area, address, landmark, email, latitude, longitude, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending') RETURNING *`,
        [d.hospitalName, d.type, billingTypeFor(d.type), d.state, d.area, d.address, d.landmark || null, d.email, d.latitude ?? null, d.longitude ?? null],
      )
      const { rows: u } = await db.query(
        `INSERT INTO users (role, name, email, secret_hash, language, clinic_id, consent_at)
         VALUES ('manager', $1, $2, $3, $4, $5, now()) RETURNING *`,
        [d.hospitalName, d.email, hash, d.language, c[0].id],
      )
      await logAction(db, {
        clinicId: c[0].id,
        actor: { id: u[0].id, name: u[0].name },
        action: 'clinic_registered',
        details: { type: d.type },
      })
      return { clinic: c[0], manager: u[0] }
    })
    res.status(201).json({
      token: signToken(manager),
      user: publicUser(manager),
      clinic: { id: clinic.id, name: clinic.name, type: clinic.type, status: clinic.status },
    })
  } catch (err) {
    if (err.code === '23505') throw new AppError(409, 'email_taken')
    throw err
  }
})

export default router
