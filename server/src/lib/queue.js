import { nowMinutesLagos, toMinutes, fromMinutes, todayLagos } from './time.js'

export const ACTIVE_STATUSES = ['booked', 'checked_in', 'called']

// Queue order within a department and day: front-of-queue moves first, then
// arrival time, then queue number. This is the ONE definition of "who is ahead".
export const QUEUE_ORDER = 'front_rank, slot_time, queue_number'

// Average consultation length today: the last 10 patients seen, or the
// department's set average until 10 have been seen.
export async function averageVisitMinutes(db, departmentId, date, fallbackMinutes) {
  const { rows } = await db.query(
    `SELECT count(*)::int AS n,
            avg(extract(epoch FROM (finished_at - called_at)) / 60) AS avg_minutes
     FROM (SELECT finished_at, called_at FROM appointments
           WHERE department_id = $1 AND appt_date = $2 AND status = 'seen'
             AND finished_at IS NOT NULL AND called_at IS NOT NULL
           ORDER BY finished_at DESC LIMIT 10) recent`,
    [departmentId, date],
  )
  const { n, avg_minutes } = rows[0]
  return n >= 10 && avg_minutes > 0 ? Number(avg_minutes) : fallbackMinutes
}

// Live position for one appointment: people ahead and the estimated wait.
// Estimated wait = people ahead x average consultation time.
export async function queueInfo(db, appt, dept) {
  if (!ACTIVE_STATUSES.includes(appt.status) || appt.appt_date !== todayLagos()) return null

  const { rows } = await db.query(
    `SELECT count(*)::int AS ahead FROM appointments o
     WHERE o.department_id = $1 AND o.appt_date = $2 AND o.id <> $3
       AND o.status = ANY($4)
       AND (o.front_rank, o.slot_time, o.queue_number) < ($5, $6, $7)`,
    [appt.department_id, appt.appt_date, appt.id, ACTIVE_STATUSES, appt.front_rank, appt.slot_time, appt.queue_number],
  )
  const ahead = rows[0].ahead
  const avg = await averageVisitMinutes(db, appt.department_id, appt.appt_date, dept.avg_visit_minutes)
  const waitMinutes = Math.round(ahead * avg)

  // "Arrive by 10:00 - Estimated consultation 10:20-10:40"
  const start = Math.max(nowMinutesLagos() + waitMinutes, toMinutes(appt.slot_time))
  return {
    ahead,
    waitMinutes,
    averageVisitMinutes: Math.round(avg),
    estimatedFrom: fromMinutes(start % 1440),
    estimatedTo: fromMinutes((start + Math.round(avg)) % 1440),
    alertNow: ahead <= appt.alert_ahead,
  }
}
