import { Router } from 'express'
import { z } from 'zod'
import { query, withTx } from '../db.js'
import { requireStaff } from '../middleware/auth.js'
import { AppError } from '../lib/errors.js'
import { logAction } from '../lib/log.js'
import { settleDeposit } from '../lib/kolo.js'
import { emitQueueChanged } from '../lib/realtime.js'
import { QUEUE_ORDER } from '../lib/queue.js'
import { firstName, normalizePhone } from '../lib/phone.js'
import { nextQueueNumber, translateBookingError, recordSchoolNoShow } from '../lib/booking.js'
import { generateSlots, nowMinutesLagos, toMinutes, todayLagos } from '../lib/time.js'

// Front-desk dashboard API. Staff and managers only ever see and change their own clinic's data.
const router = Router()
router.use(requireStaff)

const clinicId = (req) => req.user.clinicId

async function getActor(db, req) {
  const { rows } = await db.query('SELECT id, name FROM users WHERE id = $1', [req.user.id])
  return rows[0]
}

// Runs one action on one appointment, inside a transaction, after checking it belongs to
// this clinic. Trying to touch another clinic's appointment is refused and logged.
async function withAppointment(req, id, fn) {
  id = z.uuid().parse(id)
  const { rows } = await query('SELECT clinic_id FROM appointments WHERE id = $1', [id])
  if (!rows[0]) throw new AppError(404, 'not_found')
  if (rows[0].clinic_id !== clinicId(req)) {
    await logAction({ query }, {
      clinicId: clinicId(req),
      actor: await getActor({ query }, req),
      action: 'access_denied',
      details: { appointmentId: id },
    })
    throw new AppError(403, 'not_authorised_for_clinic')
  }

  const { result, departmentId } = await withTx(async (db) => {
    const { rows: locked } = await db.query(
      'SELECT * FROM appointments WHERE id = $1 AND clinic_id = $2 FOR UPDATE',
      [id, clinicId(req)],
    )
    const appt = locked[0]
    return { result: await fn(db, appt, await getActor(db, req)), departmentId: appt.department_id }
  })
  emitQueueChanged(clinicId(req), departmentId)
  return result
}

const staffJson = (a, graceMinutes) => ({
  id: a.id,
  departmentId: a.department_id,
  departmentName: a.department_name,
  queueNumber: a.queue_number,
  firstName: firstName(a.patient_name), // the list shows first names only
  type: a.type,
  time: a.slot_time.slice(0, 5),
  status: a.status,
  depositStatus: a.deposit_status,
  arrivedAt: a.arrived_at,
  calledAt: a.called_at,
  finishedAt: a.finished_at,
  graceEndsAt:
    a.status === 'called' && a.called_at ? new Date(new Date(a.called_at).getTime() + graceMinutes * 60_000) : null,
})

const needStatus = (appt, ...allowed) => {
  if (!allowed.includes(appt.status)) throw new AppError(409, 'invalid_status', { status: appt.status })
}

// Lowest rank in this department/day, minus one: puts someone at the very front.
async function frontOfQueueRank(db, appt) {
  await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${appt.department_id}:${appt.appt_date}`])
  const { rows } = await db.query(
    'SELECT COALESCE(MIN(front_rank), 0) - 1 AS rank FROM appointments WHERE department_id = $1 AND appt_date = $2',
    [appt.department_id, appt.appt_date],
  )
  return rows[0].rank
}

const clinicSettings = async (db, id) =>
  (await db.query('SELECT * FROM clinics WHERE id = $1', [id])).rows[0]

// ---------- reading ----------

router.get('/clinic', async (req, res) => {
  const { rows: c } = await query('SELECT * FROM clinics WHERE id = $1', [clinicId(req)])
  const { rows: depts } = await query(
    'SELECT * FROM departments WHERE clinic_id = $1 AND active ORDER BY name',
    [clinicId(req)],
  )
  res.json({
    clinic: {
      id: c[0].id,
      name: c[0].name,
      type: c[0].type,
      billingType: c[0].billing_type,
      status: c[0].status,
      graceMinutes: c[0].grace_minutes,
    },
    departments: depts.map((d) => ({
      id: d.id,
      name: d.name,
      slotMinutes: d.slot_minutes,
      opensAt: d.opens_at.slice(0, 5),
      closesAt: d.closes_at.slice(0, 5),
    })),
  })
})

const dayQuery = z.object({
  date: z.iso.date().optional(),
  departmentId: z.uuid().optional(),
})

// Today's booked and walk-in patients, per department in queue order.
router.get('/today', async (req, res) => {
  const q = dayQuery.parse(req.query)
  const date = q.date ?? todayLagos()
  const { rows } = await query(
    `SELECT a.*, d.name AS department_name FROM appointments a JOIN departments d ON d.id = a.department_id
     WHERE a.clinic_id = $1 AND a.appt_date = $2 AND ($3::uuid IS NULL OR a.department_id = $3)
     ORDER BY d.name, a.${QUEUE_ORDER.replaceAll(', ', ', a.')}`,
    [clinicId(req), date, q.departmentId ?? null],
  )
  const clinic = await clinicSettings({ query }, clinicId(req))
  res.json({ date, appointments: rows.map((a) => staffJson(a, clinic.grace_minutes)) })
})

// Daily numbers: patients seen, average wait, no-show rate, walk-in vs booked, attendance.
router.get('/stats', async (req, res) => {
  const q = dayQuery.parse(req.query)
  const date = q.date ?? todayLagos()
  // ROLLUP adds one extra row (department_id NULL) holding the totals for the whole clinic.
  const { rows } = await query(
    `SELECT d.id AS department_id, d.name AS department_name,
       count(*) FILTER (WHERE a.status = 'seen')::int AS seen,
       count(*) FILTER (WHERE a.status = 'no_show')::int AS no_shows,
       count(*) FILTER (WHERE a.status = 'cancelled')::int AS cancelled,
       count(*) FILTER (WHERE a.type = 'booked' AND a.status <> 'cancelled')::int AS booked,
       count(*) FILTER (WHERE a.type = 'walk_in' AND a.status <> 'cancelled')::int AS walk_ins,
       count(*) FILTER (WHERE a.type = 'booked' AND a.status = 'no_show')::int AS booked_no_shows,
       avg(extract(epoch FROM (a.called_at - a.arrived_at)) / 60)
         FILTER (WHERE a.called_at IS NOT NULL AND a.arrived_at IS NOT NULL) AS avg_wait,
       avg(extract(epoch FROM (a.finished_at - a.called_at)) / 60)
         FILTER (WHERE a.status = 'seen' AND a.finished_at IS NOT NULL AND a.called_at IS NOT NULL) AS avg_visit
     FROM departments d
     LEFT JOIN appointments a ON a.department_id = d.id AND a.appt_date = $2
     WHERE d.clinic_id = $1 AND ($3::uuid IS NULL OR d.id = $3)
     GROUP BY ROLLUP ((d.id, d.name)) ORDER BY d.name NULLS LAST`,
    [clinicId(req), date, q.departmentId ?? null],
  )
  const round1 = (n) => (n == null ? null : Math.round(Number(n) * 10) / 10)
  const summary = (r) => ({
    patientsSeen: r.seen,
    noShows: r.no_shows,
    cancelled: r.cancelled,
    booked: r.booked,
    walkIns: r.walk_ins,
    // Share of booked slots (not cancelled) that ended as a verified no-show.
    noShowRate: r.booked > 0 ? Math.round((r.booked_no_shows / r.booked) * 1000) / 10 : null,
    averageWaitMinutes: round1(r.avg_wait),
    averageVisitMinutes: round1(r.avg_visit),
  })
  const totals = rows.find((r) => r.department_id === null)
  res.json({
    date,
    totals: totals ? summary(totals) : null,
    byDepartment: rows
      .filter((r) => r.department_id !== null)
      .map((r) => ({ departmentId: r.department_id, departmentName: r.department_name, ...summary(r) })),
  })
})

// The action log for a day, newest first. It cannot be edited.
router.get('/log', async (req, res) => {
  const date = z.iso.date().default(todayLagos()).parse(req.query.date)
  const { rows } = await query(
    `SELECT * FROM action_log WHERE clinic_id = $1
       AND (created_at AT TIME ZONE 'Africa/Lagos')::date = $2::date
     ORDER BY created_at DESC, id DESC LIMIT 300`,
    [clinicId(req), date],
  )
  res.json({
    date,
    entries: rows.map((l) => ({
      id: l.id,
      action: l.action,
      staffName: l.actor_name,
      patientName: l.patient_name && firstName(l.patient_name),
      reason: l.reason,
      details: l.details,
      createdAt: l.created_at,
    })),
  })
})

// School clinics: each student's no-show count and any active booking block.
router.get('/noshows', async (req, res) => {
  const { rows } = await query(
    `SELECT t.miss_count, t.blocked_until, u.name FROM noshow_tracking t JOIN users u ON u.id = t.user_id
     WHERE t.clinic_id = $1 AND (t.miss_count > 0 OR t.blocked_until > now()) ORDER BY u.name`,
    [clinicId(req)],
  )
  res.json({
    students: rows.map((r) => ({
      name: r.name,
      missCount: r.miss_count,
      blockedUntil: r.blocked_until && new Date(r.blocked_until) > new Date() ? r.blocked_until : null,
    })),
  })
})

// ---------- queue actions ----------

router.post('/appointments/:id/check-in', async (req, res) => {
  const out = await withAppointment(req, req.params.id, async (db, appt, actor) => {
    needStatus(appt, 'booked')
    await db.query(`UPDATE appointments SET status = 'checked_in', arrived_at = now() WHERE id = $1`, [appt.id])
    await logAction(db, { clinicId: clinicId(req), actor, action: 'check_in', appt })
    return { status: 'checked_in' }
  })
  res.json(out)
})

// Call a specific patient (for example a booked patient who has not been checked in).
router.post('/appointments/:id/call', async (req, res) => {
  const out = await withAppointment(req, req.params.id, async (db, appt, actor) => {
    needStatus(appt, 'booked', 'checked_in')
    await db.query(`UPDATE appointments SET status = 'called', called_at = now() WHERE id = $1`, [appt.id])
    await logAction(db, { clinicId: clinicId(req), actor, action: 'call', appt })
    return { status: 'called' }
  })
  res.json(out)
})

// "Call next": the next arrived patient in the department's queue becomes "Now serving".
router.post('/departments/:id/call-next', async (req, res) => {
  const departmentId = z.uuid().parse(req.params.id)
  const out = await withTx(async (db) => {
    const { rows: d } = await db.query('SELECT id FROM departments WHERE id = $1 AND clinic_id = $2', [
      departmentId,
      clinicId(req),
    ])
    if (!d[0]) throw new AppError(404, 'not_found')
    const { rows } = await db.query(
      `SELECT * FROM appointments WHERE department_id = $1 AND appt_date = $2 AND status = 'checked_in'
       ORDER BY ${QUEUE_ORDER} LIMIT 1 FOR UPDATE`,
      [departmentId, todayLagos()],
    )
    const next = rows[0]
    if (!next) throw new AppError(409, 'nobody_waiting')
    await db.query(`UPDATE appointments SET status = 'called', called_at = now() WHERE id = $1`, [next.id])
    await logAction(db, { clinicId: clinicId(req), actor: await getActor(db, req), action: 'call', appt: next })
    return { id: next.id, queueNumber: next.queue_number, firstName: firstName(next.patient_name) }
  })
  emitQueueChanged(clinicId(req), departmentId)
  res.json(out)
})

// Seen = a completed, billable visit. A held deposit is credited against the fee, or
// returned to Kolo when the clinic visit is free.
router.post('/appointments/:id/seen', async (req, res) => {
  const out = await withAppointment(req, req.params.id, async (db, appt, actor) => {
    needStatus(appt, 'called')
    const { rows: d } = await db.query('SELECT consultation_fee_naira FROM departments WHERE id = $1', [appt.department_id])
    const free = d[0].consultation_fee_naira === 0
    const depositStatus = await settleDeposit(db, appt, free ? 'returned' : 'deducted')
    await db.query(
      `UPDATE appointments SET status = 'seen', finished_at = now(), deposit_status = $2 WHERE id = $1`,
      [appt.id, depositStatus],
    )
    await logAction(db, { clinicId: clinicId(req), actor, action: 'seen', appt, details: { depositStatus } })
    return { status: 'seen', depositStatus }
  })
  res.json(out)
})

// A verified no-show: only after the grace period that follows the patient being called.
router.post('/appointments/:id/no-show', async (req, res) => {
  const out = await withAppointment(req, req.params.id, async (db, appt, actor) => {
    needStatus(appt, 'called')
    const clinic = await clinicSettings(db, appt.clinic_id)
    const graceEndsAt = new Date(new Date(appt.called_at).getTime() + clinic.grace_minutes * 60_000)
    if (graceEndsAt > new Date()) throw new AppError(409, 'grace_not_ended', { graceEndsAt })

    const depositStatus = await settleDeposit(db, appt, 'forfeited') // the deposit goes to the hospital
    await db.query(`UPDATE appointments SET status = 'no_show', finished_at = now(), deposit_status = $2 WHERE id = $1`, [
      appt.id,
      depositStatus,
    ])
    const rule = clinic.billing_type === 'covered' ? await recordSchoolNoShow(db, appt) : null
    await logAction(db, { clinicId: clinicId(req), actor, action: 'no_show', appt, details: { depositStatus, rule } })
    return { status: 'no_show', depositStatus, studentRule: rule }
  })
  res.json(out)
})

// Emergency or very sick patient: move anyone to the front. Always logged with a reason.
router.post('/appointments/:id/move-to-front', async (req, res) => {
  const { reason } = z.object({ reason: z.string().trim().min(2).max(200) }).parse(req.body)
  const out = await withAppointment(req, req.params.id, async (db, appt, actor) => {
    needStatus(appt, 'booked', 'checked_in', 'called')
    const rank = await frontOfQueueRank(db, appt)
    await db.query('UPDATE appointments SET front_rank = $2 WHERE id = $1', [appt.id, rank])
    await logAction(db, { clinicId: clinicId(req), actor, action: 'move_to_front', appt, reason })
    return { frontRank: rank }
  })
  res.json(out)
})

// A booked patient who arrives after being called goes next in line (same day).
router.post('/appointments/:id/requeue', async (req, res) => {
  const out = await withAppointment(req, req.params.id, async (db, appt, actor) => {
    needStatus(appt, 'called')
    const rank = await frontOfQueueRank(db, appt)
    await db.query(
      `UPDATE appointments SET status = 'checked_in', called_at = NULL, arrived_at = now(), front_rank = $2 WHERE id = $1`,
      [appt.id, rank],
    )
    await logAction(db, { clinicId: clinicId(req), actor, action: 'late_arrival_requeued', appt })
    return { status: 'checked_in' }
  })
  res.json(out)
})

// Walk-ins: name only. They take a free time in the same schedule as online bookings, and
// get the next queue number to match a numbered card.
router.post('/walk-ins', async (req, res) => {
  const d = z
    .object({
      departmentId: z.uuid(),
      name: z.string().trim().min(2).max(100),
      phone: z.string().optional(),
      time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
    })
    .parse(req.body)
  const phone = d.phone ? normalizePhone(d.phone) : null
  if (d.phone && !phone) throw new AppError(400, 'invalid_phone')

  const appt = await withTx(async (db) => {
    const { rows: depts } = await db.query(
      'SELECT * FROM departments WHERE id = $1 AND clinic_id = $2 AND active',
      [d.departmentId, clinicId(req)],
    )
    const dept = depts[0]
    if (!dept) throw new AppError(404, 'not_found')

    const date = todayLagos()
    const now = nowMinutesLagos()
    const queueNumber = await nextQueueNumber(db, dept.id, date)
    const { rows: taken } = await db.query(
      `SELECT slot_time FROM appointments WHERE department_id = $1 AND appt_date = $2 AND status <> 'cancelled'`,
      [dept.id, date],
    )
    const takenSet = new Set(taken.map((t) => t.slot_time.slice(0, 5)))
    // A time is usable while its slot has not finished yet.
    const open = generateSlots(dept.opens_at, dept.closes_at, dept.slot_minutes).filter(
      (t) => toMinutes(t) + dept.slot_minutes > now,
    )

    let time = d.time
    if (time) {
      if (!open.includes(time)) throw new AppError(400, 'invalid_slot')
      if (takenSet.has(time)) throw new AppError(409, 'slot_taken')
    } else {
      time = open.find((t) => !takenSet.has(t))
      if (!time) throw new AppError(409, 'day_full') // no waiting list, nothing carries over
    }

    // A walk-in with a phone number that has an Oma account can follow their place online.
    let memberId = null
    let bookedBy = null
    if (phone) {
      const { rows: owner } = await db.query(
        `SELECT u.id, f.id AS member_id FROM users u JOIN family_members f ON f.owner_id = u.id AND f.is_self
         WHERE u.phone = $1 AND u.role = 'patient'`,
        [phone],
      )
      if (owner[0]) {
        bookedBy = owner[0].id
        memberId = owner[0].member_id
      }
    }

    try {
      const { rows } = await db.query(
        `INSERT INTO appointments (clinic_id, department_id, family_member_id, booked_by, patient_name,
           patient_phone, type, appt_date, slot_time, queue_number, status, arrived_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'walk_in', $7, $8, $9, 'checked_in', now()) RETURNING *`,
        [clinicId(req), dept.id, memberId, bookedBy, d.name, phone, date, time, queueNumber],
      )
      await logAction(db, { clinicId: clinicId(req), actor: await getActor(db, req), action: 'walk_in_registered', appt: rows[0] })
      return { ...rows[0], department_name: dept.name }
    } catch (err) {
      throw translateBookingError(err)
    }
  })
  emitQueueChanged(clinicId(req), appt.department_id)
  const clinic = await clinicSettings({ query }, clinicId(req))
  res.status(201).json({ appointment: staffJson(appt, clinic.grace_minutes) })
})

// Doctor left early or the clinic closes: cancel the rest of today. Deposits go back to Kolo.
router.post('/cancel-day', async (req, res) => {
  const d = z
    .object({ departmentId: z.uuid().optional(), reason: z.string().trim().min(2).max(200).default('Clinic closed') })
    .parse(req.body ?? {})

  const result = await withTx(async (db) => {
    const actor = await getActor(db, req)
    const { rows } = await db.query(
      `SELECT * FROM appointments WHERE clinic_id = $1 AND appt_date = $2 AND status IN ('booked', 'checked_in', 'called')
         AND ($3::uuid IS NULL OR department_id = $3) FOR UPDATE`,
      [clinicId(req), todayLagos(), d.departmentId ?? null],
    )
    for (const appt of rows) {
      const depositStatus = await settleDeposit(db, appt, 'returned')
      await db.query(
        `UPDATE appointments SET status = 'cancelled', cancelled_at = now(), cancelled_by = 'clinic', deposit_status = $2 WHERE id = $1`,
        [appt.id, depositStatus],
      )
      await logAction(db, { clinicId: clinicId(req), actor, action: 'cancelled_by_clinic', appt, reason: d.reason })
    }
    await logAction(db, {
      clinicId: clinicId(req), actor, action: 'day_cancelled', reason: d.reason, details: { count: rows.length },
    })
    return { cancelled: rows.length, departments: [...new Set(rows.map((r) => r.department_id))] }
  })
  result.departments.forEach((id) => emitQueueChanged(clinicId(req), id))
  res.json({ cancelled: result.cancelled })
})

// Staff may adjust a department's slot length at any time (the change is logged).
router.patch('/departments/:id/slot-length', async (req, res) => {
  const id = z.uuid().parse(req.params.id)
  const { slotMinutes } = z.object({ slotMinutes: z.number().int().min(5).max(120) }).parse(req.body)
  await withTx(async (db) => {
    const { rowCount } = await db.query('UPDATE departments SET slot_minutes = $3 WHERE id = $1 AND clinic_id = $2', [
      id, clinicId(req), slotMinutes,
    ])
    if (!rowCount) throw new AppError(404, 'not_found')
    await logAction(db, {
      clinicId: clinicId(req), actor: await getActor(db, req), action: 'slot_length_changed', details: { departmentId: id, slotMinutes },
    })
  })
  res.json({ slotMinutes })
})

export default router
