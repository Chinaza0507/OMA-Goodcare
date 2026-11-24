import { Router } from 'express'
import { z } from 'zod'
import { query } from '../db.js'
import { AppError } from '../lib/errors.js'
import { generateSlots, nowMinutesLagos, toMinutes, todayLagos, addDays } from '../lib/time.js'
import { MAX_DAYS_AHEAD } from '../lib/booking.js'

const router = Router()

const listSchema = z.object({
  state: z.string().trim().max(60).optional(),
  area: z.string().trim().max(60).optional(),
  maxFee: z.coerce.number().int().min(0).optional(),
  // Optional "near me": the browser sends coordinates only if the user allowed location.
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
})

const distanceKm = (lat1, lng1, lat2, lng2) => {
  const rad = (d) => (d * Math.PI) / 180
  const a =
    Math.sin(rad(lat2 - lat1) / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2
  return 6371 * 2 * Math.asin(Math.sqrt(a))
}

const departmentJson = (d) => ({
  id: d.id,
  name: d.name,
  consultationFee: d.consultation_fee_naira,
  opensAt: d.opens_at.slice(0, 5),
  closesAt: d.closes_at.slice(0, 5),
  slotMinutes: d.slot_minutes,
})

const clinicJson = (c, departments) => ({
  id: c.id,
  name: c.name,
  type: c.type,
  state: c.state,
  area: c.area,
  address: c.address,
  landmark: c.landmark,
  billingType: c.billing_type,
  depositNaira: c.billing_type === 'paid' ? c.deposit_naira : 0,
  cancelWindowMinutes: c.cancel_window_minutes,
  departments: departments.map(departmentJson),
})

async function loadDepartments(clinicIds) {
  const { rows } = await query(
    'SELECT * FROM departments WHERE clinic_id = ANY($1) AND active ORDER BY name',
    [clinicIds],
  )
  return rows
}

// Patients see only approved, active hospitals. Filter by state/area or consultation fee;
// pass lat+lng to sort nearest first (hospitals without coordinates go last).
router.get('/', async (req, res) => {
  const f = listSchema.parse(req.query)
  const { rows: clinics } = await query(
    `SELECT * FROM clinics WHERE status = 'approved' AND active
       AND ($1::text IS NULL OR lower(state) = lower($1))
       AND ($2::text IS NULL OR lower(area) = lower($2))
     ORDER BY name`,
    [f.state ?? null, f.area ?? null],
  )
  const departments = clinics.length ? await loadDepartments(clinics.map((c) => c.id)) : []

  let result = clinics.map((c) => ({
    ...clinicJson(c, departments.filter((d) => d.clinic_id === c.id)),
    distanceKm:
      f.lat != null && f.lng != null && c.latitude != null && c.longitude != null
        ? Math.round(distanceKm(f.lat, f.lng, c.latitude, c.longitude) * 10) / 10
        : null,
  }))

  if (f.maxFee != null) {
    // Keep hospitals with at least one department at or under the fee (fee not provided = kept).
    result = result.filter((c) =>
      c.departments.some((d) => d.consultationFee == null || d.consultationFee <= f.maxFee),
    )
  }
  if (f.lat != null && f.lng != null) {
    result.sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity))
  }
  res.json({ clinics: result })
})

// Values for the state/area filter dropdowns.
router.get('/locations', async (_req, res) => {
  const { rows } = await query(
    `SELECT DISTINCT state, area FROM clinics WHERE status = 'approved' AND active
     AND state IS NOT NULL ORDER BY state, area`,
  )
  res.json({ locations: rows })
})

router.get('/:id', async (req, res) => {
  const id = z.uuid().parse(req.params.id)
  const { rows } = await query(`SELECT * FROM clinics WHERE id = $1 AND status = 'approved' AND active`, [id])
  if (!rows[0]) throw new AppError(404, 'not_found')
  res.json({ clinic: clinicJson(rows[0], await loadDepartments([id])) })
})

// Free and taken times for a department on a day.
router.get('/departments/:departmentId/slots', async (req, res) => {
  const departmentId = z.uuid().parse(req.params.departmentId)
  const today = todayLagos()
  const date = z.iso.date().default(today).parse(req.query.date)
  if (date < today || date > addDays(today, MAX_DAYS_AHEAD)) throw new AppError(400, 'invalid_date')

  const { rows } = await query(
    `SELECT d.* FROM departments d JOIN clinics c ON c.id = d.clinic_id
     WHERE d.id = $1 AND d.active AND c.active AND c.status = 'approved'`,
    [departmentId],
  )
  const dept = rows[0]
  if (!dept) throw new AppError(404, 'not_found')

  const { rows: taken } = await query(
    `SELECT slot_time FROM appointments WHERE department_id = $1 AND appt_date = $2 AND status <> 'cancelled'`,
    [departmentId, date],
  )
  const takenSet = new Set(taken.map((t) => t.slot_time.slice(0, 5)))
  const now = nowMinutesLagos()

  const slots = generateSlots(dept.opens_at, dept.closes_at, dept.slot_minutes).map((time) => ({
    time,
    available: !takenSet.has(time) && !(date === today && toMinutes(time) < now),
  }))
  res.json({ date, slotMinutes: dept.slot_minutes, slots })
})

export default router
