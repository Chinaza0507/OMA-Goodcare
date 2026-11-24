import { AppError } from './errors.js'
import { generateSlots, nowMinutesLagos, slotInstant, toMinutes, todayLagos, addDays } from './time.js'
import { hold, settleDeposit } from './kolo.js'

// Same-day booking only: patients book a time for today, the day they are going.
export const MAX_DAYS_AHEAD = 0

// Serialises queue-number assignment for one department and day.
export async function nextQueueNumber(db, departmentId, date) {
  await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${departmentId}:${date}`])
  const { rows } = await db.query(
    'SELECT COALESCE(max(queue_number), 0) + 1 AS n FROM appointments WHERE department_id = $1 AND appt_date = $2',
    [departmentId, date],
  )
  return rows[0].n
}

// Turns the unique-index violations into clear errors.
export function translateBookingError(err) {
  if (err.code === '23505') {
    if (err.constraint === 'appointments_member_day_unique') return new AppError(409, 'already_booked')
    return new AppError(409, 'slot_taken')
  }
  return err
}

export async function loadBookableDepartment(db, departmentId) {
  const { rows } = await db.query(
    `SELECT d.*, c.billing_type, c.deposit_naira, c.cancel_window_minutes, c.grace_minutes,
            c.name AS clinic_name, c.id AS clinic_id
     FROM departments d JOIN clinics c ON c.id = d.clinic_id
     WHERE d.id = $1 AND d.active AND c.active AND c.status = 'approved'`,
    [departmentId],
  )
  if (!rows[0]) throw new AppError(404, 'not_found')
  return rows[0]
}

export async function bookAppointment(db, { userId, familyMemberId, departmentId, date, time, alertAhead }) {
  const today = todayLagos()
  if (date < today || date > addDays(today, MAX_DAYS_AHEAD)) throw new AppError(400, 'invalid_date')

  const { rows: members } = await db.query('SELECT * FROM family_members WHERE id = $1 AND owner_id = $2', [
    familyMemberId,
    userId,
  ])
  if (!members[0]) throw new AppError(404, 'not_found')

  const dept = await loadBookableDepartment(db, departmentId)

  if (!generateSlots(dept.opens_at, dept.closes_at, dept.slot_minutes).includes(time.slice(0, 5))) {
    throw new AppError(400, 'invalid_slot')
  }
  if (date === today && toMinutes(time) < nowMinutesLagos()) throw new AppError(409, 'slot_past')

  // School clinics: students who missed two bookings cannot book for 7 days (walk-ins still allowed).
  if (dept.billing_type === 'covered') {
    const { rows: block } = await db.query(
      'SELECT blocked_until FROM noshow_tracking WHERE user_id = $1 AND clinic_id = $2 AND blocked_until > now()',
      [userId, dept.clinic_id],
    )
    if (block[0]) throw new AppError(403, 'booking_blocked', { until: block[0].blocked_until })
  }

  const { rows: users } = await db.query('SELECT alert_ahead FROM users WHERE id = $1', [userId])
  const deposit = dept.billing_type === 'paid' ? dept.deposit_naira : 0

  const queueNumber = await nextQueueNumber(db, departmentId, date)
  let appt
  try {
    const { rows } = await db.query(
      `INSERT INTO appointments (clinic_id, department_id, family_member_id, booked_by, patient_name, type,
         appt_date, slot_time, queue_number, deposit_naira, deposit_status, alert_ahead)
       VALUES ($1, $2, $3, $4, $5, 'booked', $6, $7, $8, $9, $10, $11) RETURNING *`,
      [
        dept.clinic_id,
        departmentId,
        familyMemberId,
        userId,
        members[0].name,
        date,
        time,
        queueNumber,
        deposit,
        deposit > 0 ? 'held' : 'none',
        alertAhead ?? users[0].alert_ahead,
      ],
    )
    appt = rows[0]
  } catch (err) {
    throw translateBookingError(err)
  }

  // Reserve the deposit. If the balance is too low this throws and the whole booking rolls back.
  if (deposit > 0) await hold(db, userId, deposit, appt.id)

  return { appointment: appt, department: dept }
}

// Patient cancels a booked visit. Early cancel (2+ hours, set per clinic) returns the deposit;
// later cancellation forfeits it, and the patient must confirm first.
export async function cancelAppointment(db, { appointmentId, userId, confirm }) {
  const { rows } = await db.query('SELECT * FROM appointments WHERE id = $1 AND booked_by = $2 FOR UPDATE', [
    appointmentId,
    userId,
  ])
  const appt = rows[0]
  if (!appt) throw new AppError(404, 'not_found')
  if (appt.status !== 'booked') throw new AppError(409, 'cannot_cancel')

  let depositStatus = appt.deposit_status
  if (appt.deposit_status === 'held') {
    const { rows: clinic } = await db.query('SELECT cancel_window_minutes FROM clinics WHERE id = $1', [
      appt.clinic_id,
    ])
    const msBefore = slotInstant(appt.appt_date, appt.slot_time) - Date.now()
    const early = msBefore >= clinic[0].cancel_window_minutes * 60_000
    if (!early && !confirm) {
      throw new AppError(409, 'needs_confirmation', { depositForfeited: true, amount: appt.deposit_naira })
    }
    depositStatus = await settleDeposit(db, appt, early ? 'returned' : 'forfeited')
  }

  await db.query(
    `UPDATE appointments SET status = 'cancelled', cancelled_at = now(), cancelled_by = 'patient',
       deposit_status = $2 WHERE id = $1`,
    [appt.id, depositStatus],
  )
  return { clinicId: appt.clinic_id, departmentId: appt.department_id, depositStatus }
}

// School-clinic rule: a first no-show is a warning, the second blocks booking for 7 days.
export async function recordSchoolNoShow(db, appt) {
  if (!appt.booked_by) return null
  const { rows } = await db.query(
    `INSERT INTO noshow_tracking (user_id, clinic_id, miss_count) VALUES ($1, $2, 1)
     ON CONFLICT (user_id, clinic_id)
     DO UPDATE SET miss_count = noshow_tracking.miss_count + 1, updated_at = now()
     RETURNING miss_count`,
    [appt.booked_by, appt.clinic_id],
  )
  if (rows[0].miss_count < 2) return { missCount: rows[0].miss_count, blockedUntil: null }

  const { rows: blocked } = await db.query(
    `UPDATE noshow_tracking SET miss_count = 0, blocked_until = now() + interval '7 days', updated_at = now()
     WHERE user_id = $1 AND clinic_id = $2 RETURNING blocked_until`,
    [appt.booked_by, appt.clinic_id],
  )
  return { missCount: 2, blockedUntil: blocked[0].blocked_until }
}
