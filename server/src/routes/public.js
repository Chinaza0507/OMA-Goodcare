import { Router } from 'express'
import { z } from 'zod'
import rateLimit from 'express-rate-limit'
import { query } from '../db.js'
import { AppError } from '../lib/errors.js'
import { firstName } from '../lib/phone.js'
import { QUEUE_ORDER } from '../lib/queue.js'
import { todayLagos } from '../lib/time.js'

const router = Router()

const limiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => res.status(429).json({ error: 'too_many_requests' }),
})

// The public "Now serving" screen (TV, laptop or phone in the waiting area).
// Privacy: only first names and queue numbers, nothing else about the patient.
router.get('/clinics/:id/now-serving', limiter, async (req, res) => {
  const clinicId = z.uuid().parse(req.params.id)
  const { rows: c } = await query(`SELECT id, name FROM clinics WHERE id = $1 AND status = 'approved' AND active`, [clinicId])
  if (!c[0]) throw new AppError(404, 'not_found')

  const { rows: depts } = await query('SELECT id, name FROM departments WHERE clinic_id = $1 AND active ORDER BY name', [clinicId])
  const date = todayLagos()

  const departments = []
  for (const d of depts) {
    const { rows: serving } = await query(
      `SELECT queue_number, patient_name FROM appointments
       WHERE department_id = $1 AND appt_date = $2 AND status = 'called'
       ORDER BY called_at DESC LIMIT 1`,
      [d.id, date],
    )
    const { rows: next } = await query(
      `SELECT queue_number, patient_name FROM appointments
       WHERE department_id = $1 AND appt_date = $2 AND status = 'checked_in'
       ORDER BY ${QUEUE_ORDER} LIMIT 3`,
      [d.id, date],
    )
    const person = (r) => ({ queueNumber: r.queue_number, firstName: firstName(r.patient_name) })
    departments.push({
      departmentId: d.id,
      departmentName: d.name,
      nowServing: serving[0] ? person(serving[0]) : null,
      next: next.map(person),
    })
  }
  res.json({ clinic: { id: c[0].id, name: c[0].name }, departments })
})

export default router
