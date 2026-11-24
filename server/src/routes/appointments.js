import { Router } from 'express'
import { z } from 'zod'
import { query, withTx } from '../db.js'
import { requireAuth, requireRole, ensureActive } from '../middleware/auth.js'
import { AppError } from '../lib/errors.js'
import { bookAppointment, cancelAppointment } from '../lib/booking.js'
import { queueInfo, ACTIVE_STATUSES } from '../lib/queue.js'
import { emitQueueChanged } from '../lib/realtime.js'
import { slotInstant, todayLagos } from '../lib/time.js'

const router = Router()
// ensureActive: a disabled or deleted account loses access at once, even with a valid token.
router.use(requireAuth, ensureActive, requireRole('patient'))

const bookSchema = z.object({
  familyMemberId: z.uuid(),
  departmentId: z.uuid(),
  date: z.iso.date(),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  alertAhead: z.number().int().min(1).max(10).optional(),
})

async function toJson(db, a) {
  const { rows } = await db.query(
    `SELECT d.name AS department_name, d.avg_visit_minutes, d.consultation_fee_naira,
            c.name AS clinic_name, c.cancel_window_minutes
     FROM departments d JOIN clinics c ON c.id = d.clinic_id WHERE d.id = $1`,
    [a.department_id],
  )
  const d = rows[0]
  const earlyCancel =
    slotInstant(a.appt_date, a.slot_time) - Date.now() >= d.cancel_window_minutes * 60_000
  return {
    id: a.id,
    clinicId: a.clinic_id,
    clinicName: d.clinic_name,
    departmentId: a.department_id,
    departmentName: d.department_name,
    patientName: a.patient_name,
    familyMemberId: a.family_member_id,
    type: a.type,
    date: a.appt_date,
    time: a.slot_time.slice(0, 5), // an arrival time, not a guaranteed consultation time
    queueNumber: a.queue_number,
    status: a.status,
    deposit: { amount: a.deposit_naira, status: a.deposit_status },
    alertAhead: a.alert_ahead,
    canCancel: a.status === 'booked',
    cancelRefundsDeposit: earlyCancel,
    queue: await queueInfo(db, a, { avg_visit_minutes: d.avg_visit_minutes }),
  }
}

router.post('/', async (req, res) => {
  const data = bookSchema.parse(req.body)
  const { appointment, department } = await withTx((db) =>
    bookAppointment(db, { userId: req.user.id, ...data }),
  )
  emitQueueChanged(department.clinic_id, department.id)
  res.status(201).json({ appointment: await toJson({ query }, appointment) })
})

// ?scope=upcoming (default) | previous
router.get('/', async (req, res) => {
  const scope = z.enum(['upcoming', 'previous']).default('upcoming').parse(req.query.scope)
  const today = todayLagos()
  const { rows } = await query(
    scope === 'upcoming'
      ? `SELECT * FROM appointments WHERE booked_by = $1 AND appt_date >= $2 AND status = ANY($3)
         ORDER BY appt_date, slot_time`
      : `SELECT * FROM appointments WHERE booked_by = $1
           AND NOT (appt_date >= $2 AND status = ANY($3))
         ORDER BY appt_date DESC, slot_time DESC LIMIT 100`,
    [req.user.id, today, ACTIVE_STATUSES],
  )
  res.json({ appointments: await Promise.all(rows.map((a) => toJson({ query }, a))) })
})

router.get('/:id', async (req, res) => {
  const { rows } = await query('SELECT * FROM appointments WHERE id = $1 AND booked_by = $2', [
    z.uuid().parse(req.params.id),
    req.user.id,
  ])
  if (!rows[0]) throw new AppError(404, 'not_found')
  res.json({ appointment: await toJson({ query }, rows[0]) })
})

// Cancel. Within the clinic's cancellation window the deposit is forfeited, so the
// patient must send { confirm: true } after seeing the warning.
router.post('/:id/cancel', async (req, res) => {
  const { confirm } = z.object({ confirm: z.boolean().default(false) }).parse(req.body ?? {})
  const result = await withTx((db) =>
    cancelAppointment(db, { appointmentId: z.uuid().parse(req.params.id), userId: req.user.id, confirm }),
  )
  emitQueueChanged(result.clinicId, result.departmentId)
  res.json({ status: 'cancelled', depositStatus: result.depositStatus })
})

// Change when the "turn is close" alert fires (1 to 10 people ahead).
router.patch('/:id/alert', async (req, res) => {
  const { alertAhead } = z.object({ alertAhead: z.number().int().min(1).max(10) }).parse(req.body)
  const { rows } = await query(
    `UPDATE appointments SET alert_ahead = $3 WHERE id = $1 AND booked_by = $2 RETURNING *`,
    [z.uuid().parse(req.params.id), req.user.id, alertAhead],
  )
  if (!rows[0]) throw new AppError(404, 'not_found')
  res.json({ appointment: await toJson({ query }, rows[0]) })
})

export default router
