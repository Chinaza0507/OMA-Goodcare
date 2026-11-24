import { Router } from 'express'
import { z } from 'zod'
import { query, withTx } from '../db.js'
import { requireAuth, requireRole, ensureActive } from '../middleware/auth.js'
import { getBalances, topUp } from '../lib/kolo.js'

const router = Router()
// ensureActive: a disabled or deleted account loses access at once, even with a valid token.
router.use(requireAuth, ensureActive, requireRole('patient'))

router.get('/', async (req, res) => {
  res.json({ ...(await getBalances({ query }, req.user.id)), simulated: true })
})

// Simulated top-up for the prototype. Real money needs a licensed financial partner (Phase 2).
router.post('/topup', async (req, res) => {
  const { amount } = z.object({ amount: z.number().int().min(100).max(100_000) }).parse(req.body)
  const balances = await withTx((db) => topUp(db, req.user.id, amount))
  res.status(201).json({ available: balances.available, reserved: balances.reserved, simulated: true })
})

// Full history, newest first. Each row shows the linked visit and what happened to the deposit.
router.get('/transactions', async (req, res) => {
  const limit = z.coerce.number().int().min(1).max(200).default(50).parse(req.query.limit)
  const { rows } = await query(
    `SELECT t.*, a.appt_date, a.slot_time, a.patient_name, a.status AS appointment_status,
            a.deposit_status, d.name AS department_name, c.name AS clinic_name
     FROM kolo_transactions t
     LEFT JOIN appointments a ON a.id = t.appointment_id
     LEFT JOIN departments d ON d.id = a.department_id
     LEFT JOIN clinics c ON c.id = a.clinic_id
     WHERE t.user_id = $1 ORDER BY t.created_at DESC, t.id DESC LIMIT $2`,
    [req.user.id, limit],
  )
  res.json({
    transactions: rows.map((t) => ({
      id: t.id,
      type: t.type,
      amount: t.amount_naira,
      availableAfter: t.available_after,
      reservedAfter: t.reserved_after,
      createdAt: t.created_at,
      appointment: t.appointment_id && {
        id: t.appointment_id,
        clinicName: t.clinic_name,
        departmentName: t.department_name,
        patientName: t.patient_name,
        date: t.appt_date,
        time: t.slot_time.slice(0, 5),
        status: t.appointment_status,
        depositStatus: t.deposit_status,
      },
    })),
  })
})

export default router
