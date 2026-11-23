import { Router } from 'express'
import { z } from 'zod'
import { query, withTx } from '../db.js'
import { requireAuth, requireRole, ensureActive } from '../middleware/auth.js'
import { AppError } from '../lib/errors.js'
import { logAction } from '../lib/log.js'
import { hashSecret } from '../lib/secret.js'
import { toMinutes } from '../lib/time.js'
import { phoneField } from './auth.js'

// Clinic manager: set up the clinic they belong to. Everything is scoped to req.user.clinicId,
// and every change goes in the action log.
const router = Router()
router.use(
  requireAuth,
  requireRole('manager'),
  (req, _res, next) => {
    if (!req.user.clinicId) throw new AppError(403, 'forbidden')
    next()
  },
  ensureActive,
)

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)

const clinicSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    state: z.string().trim().min(2).max(60),
    area: z.string().trim().min(2).max(60),
    address: z.string().trim().min(3).max(200),
    latitude: z.number().min(-90).max(90).nullable(),
    longitude: z.number().min(-180).max(180).nullable(),
    graceMinutes: z.number().int().min(0).max(120),
    cancelWindowMinutes: z.number().int().min(0).max(24 * 60),
  })
  .partial()

const departmentSchema = z.object({
  name: z.string().trim().min(2).max(80),
  consultationFee: z.number().int().min(0).max(10_000_000).nullable(),
  opensAt: hhmm,
  closesAt: hhmm,
  slotMinutes: z.number().int().min(5).max(120),
  avgVisitMinutes: z.number().int().min(1).max(240),
})

const checkHours = (d) => {
  if (d.opensAt && d.closesAt && toMinutes(d.closesAt) <= toMinutes(d.opensAt)) {
    throw new AppError(400, 'invalid_input', { details: [{ field: 'closesAt', message: 'must be after opensAt' }] })
  }
}

const actor = (req, name) => ({ id: req.user.id, name })
async function actorName(db, id) {
  const { rows } = await db.query('SELECT name FROM users WHERE id = $1', [id])
  return rows[0]?.name ?? 'manager'
}

const departmentJson = (d) => ({
  id: d.id,
  name: d.name,
  consultationFee: d.consultation_fee_naira,
  opensAt: d.opens_at.slice(0, 5),
  closesAt: d.closes_at.slice(0, 5),
  slotMinutes: d.slot_minutes,
  avgVisitMinutes: d.avg_visit_minutes,
  active: d.active,
})

router.get('/clinic', async (req, res) => {
  const { rows: c } = await query('SELECT * FROM clinics WHERE id = $1', [req.user.clinicId])
  const { rows: depts } = await query('SELECT * FROM departments WHERE clinic_id = $1 ORDER BY name', [req.user.clinicId])
  const { rows: staff } = await query(
    `SELECT id, name, phone, role, active FROM users WHERE clinic_id = $1 ORDER BY role, name`,
    [req.user.clinicId],
  )
  res.json({
    clinic: {
      id: c[0].id,
      name: c[0].name,
      type: c[0].type,
      billingType: c[0].billing_type,
      paymentOption: c[0].payment_option,
      status: c[0].status,
      state: c[0].state,
      area: c[0].area,
      address: c[0].address,
      latitude: c[0].latitude,
      longitude: c[0].longitude,
      graceMinutes: c[0].grace_minutes,
      cancelWindowMinutes: c[0].cancel_window_minutes,
      depositNaira: c[0].deposit_naira,
    },
    departments: depts.map(departmentJson),
    staff,
  })
})

// Clinic type and billing type are set at registration and only an Oma admin can change them.
router.patch('/clinic', async (req, res) => {
  const d = clinicSchema.parse(req.body)
  await withTx(async (db) => {
    await db.query(
      `UPDATE clinics SET name = COALESCE($2, name), state = COALESCE($3, state), area = COALESCE($4, area),
         address = COALESCE($5, address), grace_minutes = COALESCE($6, grace_minutes),
         cancel_window_minutes = COALESCE($7, cancel_window_minutes),
         latitude = CASE WHEN $8 THEN $9 ELSE latitude END,
         longitude = CASE WHEN $8 THEN $10 ELSE longitude END
       WHERE id = $1`,
      [
        req.user.clinicId, d.name ?? null, d.state ?? null, d.area ?? null, d.address ?? null,
        d.graceMinutes ?? null, d.cancelWindowMinutes ?? null,
        d.latitude !== undefined || d.longitude !== undefined, d.latitude ?? null, d.longitude ?? null,
      ],
    )
    await logAction(db, {
      clinicId: req.user.clinicId,
      actor: actor(req, await actorName(db, req.user.id)),
      action: 'clinic_settings_changed',
      details: d,
    })
  })
  res.json({ ok: true })
})

router.post('/departments', async (req, res) => {
  const d = departmentSchema.parse(req.body)
  checkHours(d)
  try {
    const dept = await withTx(async (db) => {
      const { rows } = await db.query(
        `INSERT INTO departments (clinic_id, name, consultation_fee_naira, opens_at, closes_at, slot_minutes, avg_visit_minutes)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [req.user.clinicId, d.name, d.consultationFee, d.opensAt, d.closesAt, d.slotMinutes, d.avgVisitMinutes],
      )
      await logAction(db, {
        clinicId: req.user.clinicId,
        actor: actor(req, await actorName(db, req.user.id)),
        action: 'department_created',
        details: { name: d.name },
      })
      return rows[0]
    })
    res.status(201).json({ department: departmentJson(dept) })
  } catch (err) {
    if (err.code === '23505') throw new AppError(409, 'department_exists')
    throw err
  }
})

router.patch('/departments/:id', async (req, res) => {
  const id = z.uuid().parse(req.params.id)
  const d = departmentSchema.partial().extend({ active: z.boolean().optional() }).parse(req.body)
  checkHours(d)
  const dept = await withTx(async (db) => {
    const { rows } = await db.query(
      `UPDATE departments SET name = COALESCE($3, name),
         consultation_fee_naira = CASE WHEN $4 THEN $5 ELSE consultation_fee_naira END,
         opens_at = COALESCE($6, opens_at), closes_at = COALESCE($7, closes_at),
         slot_minutes = COALESCE($8, slot_minutes), avg_visit_minutes = COALESCE($9, avg_visit_minutes),
         active = COALESCE($10, active)
       WHERE id = $1 AND clinic_id = $2 RETURNING *`,
      [
        id, req.user.clinicId, d.name ?? null, d.consultationFee !== undefined, d.consultationFee ?? null,
        d.opensAt ?? null, d.closesAt ?? null, d.slotMinutes ?? null, d.avgVisitMinutes ?? null, d.active ?? null,
      ],
    )
    if (!rows[0]) throw new AppError(404, 'not_found')
    if (toMinutes(rows[0].closes_at) <= toMinutes(rows[0].opens_at)) throw new AppError(400, 'invalid_input')
    await logAction(db, {
      clinicId: req.user.clinicId,
      actor: actor(req, await actorName(db, req.user.id)),
      action: 'department_updated',
      details: { id, ...d },
    })
    return rows[0]
  })
  res.json({ department: departmentJson(dept) })
})

// Staff accounts for this clinic (front-desk staff only; managers are created at registration).
router.post('/staff', async (req, res) => {
  const d = z
    .object({ name: z.string().trim().min(2).max(100), phone: phoneField, password: z.string().min(8).max(72) })
    .parse(req.body)
  const hash = await hashSecret(d.password)
  try {
    const user = await withTx(async (db) => {
      const { rows } = await db.query(
        `INSERT INTO users (role, name, phone, secret_hash, clinic_id) VALUES ('staff', $1, $2, $3, $4)
         RETURNING id, name, phone, role, active`,
        [d.name, d.phone, hash, req.user.clinicId],
      )
      await logAction(db, {
        clinicId: req.user.clinicId,
        actor: actor(req, await actorName(db, req.user.id)),
        action: 'staff_created',
        details: { name: d.name },
      })
      return rows[0]
    })
    res.status(201).json({ staff: user })
  } catch (err) {
    if (err.code === '23505') throw new AppError(409, 'phone_taken')
    throw err
  }
})

router.patch('/staff/:id', async (req, res) => {
  const id = z.uuid().parse(req.params.id)
  const { active } = z.object({ active: z.boolean() }).parse(req.body)
  const user = await withTx(async (db) => {
    const { rows } = await db.query(
      `UPDATE users SET active = $3 WHERE id = $1 AND clinic_id = $2 AND role = 'staff'
       RETURNING id, name, phone, role, active`,
      [id, req.user.clinicId, active],
    )
    if (!rows[0]) throw new AppError(404, 'not_found')
    await logAction(db, {
      clinicId: req.user.clinicId,
      actor: actor(req, await actorName(db, req.user.id)),
      action: active ? 'staff_enabled' : 'staff_disabled',
      details: { name: rows[0].name },
    })
    return rows[0]
  })
  res.json({ staff: user })
})

export default router
