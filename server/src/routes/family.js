import { Router } from 'express'
import { z } from 'zod'
import { query, withTx } from '../db.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { AppError } from '../lib/errors.js'
import { cancelAppointment } from '../lib/booking.js'
import { emitQueueChanged } from '../lib/realtime.js'

const router = Router()
router.use(requireAuth, requireRole('patient'))

const MAX_MEMBERS = 12

const memberSchema = z.object({
  name: z.string().trim().min(2).max(100),
  age: z.number().int().min(0).max(120).optional(),
})

const toJson = (m) => ({ id: m.id, name: m.name, age: m.age, isSelf: m.is_self })

router.get('/', async (req, res) => {
  const { rows } = await query(
    'SELECT * FROM family_members WHERE owner_id = $1 ORDER BY is_self DESC, created_at',
    [req.user.id],
  )
  res.json({ members: rows.map(toJson) })
})

router.post('/', async (req, res) => {
  const data = memberSchema.parse(req.body)
  const member = await withTx(async (db) => {
    const { rows: count } = await db.query('SELECT count(*)::int AS n FROM family_members WHERE owner_id = $1', [
      req.user.id,
    ])
    if (count[0].n >= MAX_MEMBERS) throw new AppError(409, 'family_full')
    const { rows } = await db.query(
      'INSERT INTO family_members (owner_id, name, age) VALUES ($1, $2, $3) RETURNING *',
      [req.user.id, data.name, data.age ?? null],
    )
    return rows[0]
  })
  res.status(201).json({ member: toJson(member) })
})

router.patch('/:id', async (req, res) => {
  const data = memberSchema.partial().parse(req.body)
  const { rows } = await query(
    `UPDATE family_members SET name = COALESCE($3, name), age = COALESCE($4, age)
     WHERE id = $1 AND owner_id = $2 RETURNING *`,
    [z.uuid().parse(req.params.id), req.user.id, data.name ?? null, data.age ?? null],
  )
  if (!rows[0]) throw new AppError(404, 'not_found')
  res.json({ member: toJson(rows[0]) })
})

// Removing a family member cancels their upcoming visits under the normal rules.
router.delete('/:id', async (req, res) => {
  const id = z.uuid().parse(req.params.id)
  const events = await withTx(async (db) => {
    const { rows } = await db.query('SELECT * FROM family_members WHERE id = $1 AND owner_id = $2', [id, req.user.id])
    if (!rows[0]) throw new AppError(404, 'not_found')
    if (rows[0].is_self) throw new AppError(409, 'cannot_remove_self')

    const { rows: upcoming } = await db.query(
      `SELECT id FROM appointments WHERE family_member_id = $1 AND status = 'booked'`,
      [id],
    )
    const emitted = []
    for (const a of upcoming) {
      emitted.push(await cancelAppointment(db, { appointmentId: a.id, userId: req.user.id, confirm: true }))
    }
    // Keep past visit records (they store the patient's name): detach, then delete.
    await db.query('UPDATE appointments SET family_member_id = NULL WHERE family_member_id = $1', [id])
    await db.query('DELETE FROM family_members WHERE id = $1', [id])
    return emitted
  })
  events.forEach((e) => emitQueueChanged(e.clinicId, e.departmentId))
  res.status(204).end()
})

export default router
