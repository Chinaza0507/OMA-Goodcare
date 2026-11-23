import { Router } from 'express'
import { z } from 'zod'
import { query, withTx } from '../db.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { AppError } from '../lib/errors.js'
import { logAction } from '../lib/log.js'
import { CLINIC_TYPES, billingTypeFor } from './hospitals.js'

// Oma admin: approve new hospitals and control the things a clinic manager cannot.
const router = Router()
router.use(requireAuth, requireRole('admin'))

const clinicJson = (c) => ({
  id: c.id,
  name: c.name,
  type: c.type,
  billingType: c.billing_type,
  paymentOption: c.payment_option,
  state: c.state,
  area: c.area,
  address: c.address,
  landmark: c.landmark,
  email: c.email,
  status: c.status,
  active: c.active,
  createdAt: c.created_at,
})

router.get('/clinics', async (req, res) => {
  const status = z.enum(['pending', 'approved']).optional().parse(req.query.status)
  const { rows } = await query(
    'SELECT * FROM clinics WHERE ($1::text IS NULL OR status = $1) ORDER BY created_at DESC',
    [status ?? null],
  )
  res.json({ clinics: rows.map(clinicJson) })
})

router.post('/clinics/:id/approve', async (req, res) => {
  const id = z.uuid().parse(req.params.id)
  const clinic = await withTx(async (db) => {
    const { rows } = await db.query(`UPDATE clinics SET status = 'approved' WHERE id = $1 RETURNING *`, [id])
    if (!rows[0]) throw new AppError(404, 'not_found')
    await logAction(db, {
      clinicId: id,
      actor: { id: req.user.id, name: 'Oma admin' },
      action: 'clinic_approved',
    })
    return rows[0]
  })
  res.json({ clinic: clinicJson(clinic) })
})

// Only an Oma admin can change a clinic's type or payment option. Choosing 'school' turns
// the deposit off and the miss-2-bookings rule on; other types take the deposit.
router.patch('/clinics/:id', async (req, res) => {
  const id = z.uuid().parse(req.params.id)
  const data = z
    .object({
      type: z.enum(CLINIC_TYPES).optional(),
      paymentOption: z.enum(['per_patient', 'monthly']).optional(),
      active: z.boolean().optional(),
    })
    .parse(req.body)

  const clinic = await withTx(async (db) => {
    const { rows } = await db.query(
      `UPDATE clinics SET type = COALESCE($2, type),
         billing_type = COALESCE($3, billing_type),
         payment_option = COALESCE($4, payment_option),
         active = COALESCE($5, active)
       WHERE id = $1 RETURNING *`,
      [id, data.type ?? null, data.type ? billingTypeFor(data.type) : null, data.paymentOption ?? null, data.active ?? null],
    )
    if (!rows[0]) throw new AppError(404, 'not_found')
    await logAction(db, {
      clinicId: id,
      actor: { id: req.user.id, name: 'Oma admin' },
      action: 'clinic_updated_by_admin',
      details: data,
    })
    return rows[0]
  })
  res.json({ clinic: clinicJson(clinic) })
})

export default router
