import jwt from 'jsonwebtoken'
import { AppError } from '../lib/errors.js'
import { query } from '../db.js'

export function signToken(user) {
  return jwt.sign({ sub: user.id, role: user.role, clinicId: user.clinic_id ?? null }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '1d',
  })
}

// Requires a valid "Authorization: Bearer <token>" header.
export function requireAuth(req, _res, next) {
  const header = req.headers.authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : null
  if (!token) throw new AppError(401, 'auth_required')

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET)
    req.user = { id: payload.sub, role: payload.role, clinicId: payload.clinicId }
    next()
  } catch {
    throw new AppError(401, 'session_expired')
  }
}

// Use after requireAuth: requireRole('staff', 'manager')
export const requireRole =
  (...roles) =>
  (req, _res, next) => {
    if (!roles.includes(req.user?.role)) throw new AppError(403, 'forbidden')
    next()
  }

// A disabled account loses access immediately, even with a token that has not expired.
export async function ensureActive(req, _res, next) {
  const { rows } = await query('SELECT active FROM users WHERE id = $1', [req.user.id])
  if (!rows[0]?.active) throw new AppError(403, 'account_disabled')
  next()
}

// Front-desk staff and clinic managers, always tied to one clinic.
export const requireStaff = [
  requireAuth,
  requireRole('staff', 'manager'),
  (req, _res, next) => {
    if (!req.user.clinicId) throw new AppError(403, 'forbidden')
    next()
  },
  ensureActive,
]
