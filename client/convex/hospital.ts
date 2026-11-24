// Hospital side: front desk (staff + manager), manager settings, ỌMA admin, the public
// "Now serving" screen and the live version numbers screens subscribe to.
import { v } from 'convex/values'
import { mutation, query, type MutationCtx, type QueryCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import {
  cleanEmail, dayStartMs, fail, firstName, generateSlots, hashSecret, int, logAction, normalizePhone,
  nowMinutesLagos, queueChanged, requireRole, requireStaff, text, todayLagos, toMinutes, HHMM,
} from './lib/core'
import { frontOfQueueRank, nextQueueNumber, queueCompare, recordSchoolNoShow, settleDeposit, takenTimes, dayAppointments } from './lib/rules'
import { billingTypeFor } from './patient'

const tokenArg = { token: v.optional(v.string()) }
const iso = (ms?: number) => (ms ? new Date(ms).toISOString() : null)

const staffJson = (a: Doc<'appointments'>, deptName: string, graceMinutes: number) => ({
  id: a._id,
  departmentId: a.departmentId,
  departmentName: deptName,
  queueNumber: a.queueNumber,
  firstName: firstName(a.patientName), // the list shows first names only
  type: a.type,
  time: a.time,
  status: a.status,
  depositStatus: a.depositStatus,
  arrivedAt: iso(a.arrivedAt),
  calledAt: iso(a.calledAt),
  finishedAt: iso(a.finishedAt),
  graceEndsAt: a.status === 'called' && a.calledAt ? iso(a.calledAt + graceMinutes * 60_000) : null,
})

const clinicDepartments = (ctx: QueryCtx, clinicId: Id<'clinics'>) =>
  ctx.db.query('departments').withIndex('by_clinic', (q) => q.eq('clinicId', clinicId)).collect()

// ---------- front desk: reading ----------
export const staffClinic = query({
  args: tokenArg,
  handler: async (ctx, { token }) => {
    const user = await requireStaff(ctx, token)
    const c = (await ctx.db.get(user.clinicId))!
    const depts = (await clinicDepartments(ctx, c._id)).filter((d) => d.active).sort((a, b) => a.name.localeCompare(b.name))
    return {
      clinic: { id: c._id, name: c.name, type: c.type, billingType: c.billingType, status: c.status, graceMinutes: c.graceMinutes },
      departments: depts.map((d) => ({ id: d._id, name: d.name, slotMinutes: d.slotMinutes, opensAt: d.opensAt, closesAt: d.closesAt })),
    }
  },
})

// Today's booked and walk-in patients, per department in queue order.
export const staffToday = query({
  args: { ...tokenArg, date: v.optional(v.string()), departmentId: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const user = await requireStaff(ctx, a.token)
    const date = a.date ?? todayLagos()
    const c = (await ctx.db.get(user.clinicId))!
    const names = new Map((await clinicDepartments(ctx, c._id)).map((d) => [d._id as string, d.name]))
    const rows = (await ctx.db.query('appointments').withIndex('by_clinic_date', (q) => q.eq('clinicId', c._id).eq('date', date)).collect())
      .filter((x) => !a.departmentId || x.departmentId === a.departmentId)
      .sort((x, y) => (names.get(x.departmentId) ?? '').localeCompare(names.get(y.departmentId) ?? '') || queueCompare(x, y))
    return { date, appointments: rows.map((x) => staffJson(x, names.get(x.departmentId) ?? '', c.graceMinutes)) }
  },
})

// Daily numbers: patients seen, average wait, no-show rate, walk-in vs booked.
export const staffStats = query({
  args: { ...tokenArg, date: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const user = await requireStaff(ctx, a.token)
    const date = a.date ?? todayLagos()
    const depts = (await clinicDepartments(ctx, user.clinicId)).sort((x, y) => x.name.localeCompare(y.name))
    const all = await ctx.db.query('appointments').withIndex('by_clinic_date', (q) => q.eq('clinicId', user.clinicId).eq('date', date)).collect()
    const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((s, n) => s + n, 0) / xs.length) * 10) / 10 : null)
    const summary = (rows: Doc<'appointments'>[]) => {
      const booked = rows.filter((r) => r.type === 'booked' && r.status !== 'cancelled').length
      const bookedNoShows = rows.filter((r) => r.type === 'booked' && r.status === 'no_show').length
      return {
        patientsSeen: rows.filter((r) => r.status === 'seen').length,
        noShows: rows.filter((r) => r.status === 'no_show').length,
        cancelled: rows.filter((r) => r.status === 'cancelled').length,
        booked,
        walkIns: rows.filter((r) => r.type === 'walk_in' && r.status !== 'cancelled').length,
        // Share of booked slots (not cancelled) that ended as a verified no-show.
        noShowRate: booked > 0 ? Math.round((bookedNoShows / booked) * 1000) / 10 : null,
        averageWaitMinutes: avg(rows.filter((r) => r.calledAt && r.arrivedAt).map((r) => (r.calledAt! - r.arrivedAt!) / 60_000)),
        averageVisitMinutes: avg(rows.filter((r) => r.status === 'seen' && r.finishedAt && r.calledAt).map((r) => (r.finishedAt! - r.calledAt!) / 60_000)),
      }
    }
    return {
      date,
      totals: summary(all),
      byDepartment: depts.map((d) => ({ departmentId: d._id, departmentName: d.name, ...summary(all.filter((x) => x.departmentId === d._id)) })),
    }
  },
})

// The action log for a day, newest first. It cannot be edited.
export const staffLog = query({
  args: { ...tokenArg, date: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const user = await requireStaff(ctx, a.token)
    const date = a.date ?? todayLagos()
    const from = dayStartMs(date)
    const rows = await ctx.db.query('actionLog')
      .withIndex('by_clinic', (q) => q.eq('clinicId', user.clinicId).gte('_creationTime', from).lt('_creationTime', from + 86_400_000))
      .order('desc').take(300)
    return {
      date,
      entries: rows.map((l) => ({
        id: l._id, action: l.action, staffName: l.actorName, patientName: l.patientName ? firstName(l.patientName) : null,
        reason: l.reason ?? null, details: l.details ?? null, createdAt: new Date(l._creationTime).toISOString(),
      })),
    }
  },
})

// School clinics: each student's no-show count and any active booking block.
export const staffNoShows = query({
  args: tokenArg,
  handler: async (ctx, { token }) => {
    const user = await requireStaff(ctx, token)
    const rows = await ctx.db.query('noshowTracking').withIndex('by_clinic', (q) => q.eq('clinicId', user.clinicId)).collect()
    const students = []
    for (const t of rows) {
      const blocked = (t.blockedUntil ?? 0) > Date.now()
      if (t.missCount > 0 || blocked) {
        const u = await ctx.db.get(t.userId)
        students.push({ name: u?.name ?? '', missCount: t.missCount, blockedUntil: blocked ? iso(t.blockedUntil) : null })
      }
    }
    return { students: students.sort((a, b) => a.name.localeCompare(b.name)) }
  },
})

// ---------- front desk: queue actions ----------
// Runs one action on one appointment after checking it belongs to this clinic. Trying to
// touch another clinic's appointment is refused (and, since this aborts, not logged here).
async function deskAppointment(ctx: MutationCtx, token: string | undefined, rawId: string) {
  const user = await requireStaff(ctx, token)
  const id = ctx.db.normalizeId('appointments', rawId)
  const appt = id && (await ctx.db.get(id))
  if (!appt) return fail('not_found')
  if (appt.clinicId !== user.clinicId) return fail('not_authorised_for_clinic')
  return { user, appt }
}
const needStatus = (appt: Doc<'appointments'>, ...allowed: Doc<'appointments'>['status'][]) => {
  if (!allowed.includes(appt.status)) fail('invalid_status', { status: appt.status })
}
const apptArgs = { ...tokenArg, id: v.string() }

export const checkIn = mutation({
  args: apptArgs,
  handler: async (ctx, a) => {
    const { user, appt } = await deskAppointment(ctx, a.token, a.id)
    needStatus(appt, 'booked')
    await ctx.db.patch(appt._id, { status: 'checked_in', arrivedAt: Date.now() })
    await logAction(ctx, { clinicId: user.clinicId, actor: user, action: 'check_in', appt })
    await queueChanged(ctx, appt.clinicId, appt.departmentId)
    return { status: 'checked_in' }
  },
})

// Call a specific patient (for example a booked patient who has not been checked in).
export const call = mutation({
  args: apptArgs,
  handler: async (ctx, a) => {
    const { user, appt } = await deskAppointment(ctx, a.token, a.id)
    needStatus(appt, 'booked', 'checked_in')
    await ctx.db.patch(appt._id, { status: 'called', calledAt: Date.now() })
    await logAction(ctx, { clinicId: user.clinicId, actor: user, action: 'call', appt })
    await queueChanged(ctx, appt.clinicId, appt.departmentId)
    return { status: 'called' }
  },
})

// "Call next": the next arrived patient in the department's queue becomes "Now serving".
export const callNext = mutation({
  args: { ...tokenArg, departmentId: v.string() },
  handler: async (ctx, a) => {
    const user = await requireStaff(ctx, a.token)
    const id = ctx.db.normalizeId('departments', a.departmentId)
    const dept = id && (await ctx.db.get(id))
    if (!dept || dept.clinicId !== user.clinicId) return fail('not_found')
    const next = (await dayAppointments(ctx, dept._id, todayLagos())).filter((x) => x.status === 'checked_in').sort(queueCompare)[0]
    if (!next) return fail('nobody_waiting')
    await ctx.db.patch(next._id, { status: 'called', calledAt: Date.now() })
    await logAction(ctx, { clinicId: user.clinicId, actor: user, action: 'call', appt: next })
    await queueChanged(ctx, next.clinicId, next.departmentId)
    return { id: next._id, queueNumber: next.queueNumber, firstName: firstName(next.patientName) }
  },
})

// Seen = a completed, billable visit. A held deposit is credited against the fee, or returned
// to Kolo when the clinic visit is free.
export const seen = mutation({
  args: apptArgs,
  handler: async (ctx, a) => {
    const { user, appt } = await deskAppointment(ctx, a.token, a.id)
    needStatus(appt, 'called')
    const dept = (await ctx.db.get(appt.departmentId))!
    const depositStatus = await settleDeposit(ctx, appt, dept.consultationFee === 0 ? 'returned' : 'deducted')
    await ctx.db.patch(appt._id, { status: 'seen', finishedAt: Date.now(), depositStatus })
    await logAction(ctx, { clinicId: user.clinicId, actor: user, action: 'seen', appt, details: { depositStatus } })
    await queueChanged(ctx, appt.clinicId, appt.departmentId)
    return { status: 'seen', depositStatus }
  },
})

// A verified no-show: only after the grace period that follows the patient being called.
export const noShow = mutation({
  args: apptArgs,
  handler: async (ctx, a) => {
    const { user, appt } = await deskAppointment(ctx, a.token, a.id)
    needStatus(appt, 'called')
    const clinic = (await ctx.db.get(appt.clinicId))!
    const graceEndsAt = (appt.calledAt ?? 0) + clinic.graceMinutes * 60_000
    if (graceEndsAt > Date.now()) fail('grace_not_ended', { graceEndsAt: iso(graceEndsAt) })
    const depositStatus = await settleDeposit(ctx, appt, 'forfeited') // the deposit goes to the hospital
    await ctx.db.patch(appt._id, { status: 'no_show', finishedAt: Date.now(), depositStatus })
    const rule = clinic.billingType === 'covered' ? await recordSchoolNoShow(ctx, appt) : null
    await logAction(ctx, { clinicId: user.clinicId, actor: user, action: 'no_show', appt, details: { depositStatus, rule } })
    await queueChanged(ctx, appt.clinicId, appt.departmentId)
    return { status: 'no_show', depositStatus, studentRule: rule }
  },
})

// Emergency or very sick patient: move anyone to the front. Always logged with a reason.
export const moveToFront = mutation({
  args: { ...apptArgs, reason: v.string() },
  handler: async (ctx, a) => {
    const reason = text(a.reason, 2, 200, 'reason')
    const { user, appt } = await deskAppointment(ctx, a.token, a.id)
    needStatus(appt, 'booked', 'checked_in', 'called')
    const rank = await frontOfQueueRank(ctx, appt)
    await ctx.db.patch(appt._id, { frontRank: rank })
    await logAction(ctx, { clinicId: user.clinicId, actor: user, action: 'move_to_front', appt, reason })
    await queueChanged(ctx, appt.clinicId, appt.departmentId)
    return { frontRank: rank }
  },
})

// A patient who arrives after being called (or marked no-show) goes next in line, same day.
export const requeue = mutation({
  args: apptArgs,
  handler: async (ctx, a) => {
    const { user, appt } = await deskAppointment(ctx, a.token, a.id)
    needStatus(appt, 'called', 'no_show')
    if (appt.date !== todayLagos()) fail('invalid_status', { status: appt.status })
    const rank = await frontOfQueueRank(ctx, appt)
    await ctx.db.patch(appt._id, { status: 'checked_in', calledAt: undefined, finishedAt: undefined, arrivedAt: Date.now(), frontRank: rank })
    await logAction(ctx, { clinicId: user.clinicId, actor: user, action: 'late_arrival_requeued', appt })
    await queueChanged(ctx, appt.clinicId, appt.departmentId)
    return { status: 'checked_in' }
  },
})

// Walk-ins: name only. They take a free time in the same schedule as online bookings and get
// the next queue number to match a numbered card.
export const walkIn = mutation({
  args: { ...tokenArg, departmentId: v.string(), name: v.string(), phone: v.optional(v.string()), time: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const user = await requireStaff(ctx, a.token)
    const name = text(a.name, 2, 100, 'name')
    const phone = a.phone ? normalizePhone(a.phone) : null
    if (a.phone && !phone) fail('invalid_phone')
    const id = ctx.db.normalizeId('departments', a.departmentId)
    const dept = id && (await ctx.db.get(id))
    if (!dept || dept.clinicId !== user.clinicId || !dept.active) return fail('not_found')

    const date = todayLagos()
    const now = nowMinutesLagos()
    const all = await dayAppointments(ctx, dept._id, date)
    const taken = takenTimes(all)
    // A time is usable while its slot has not finished yet.
    const open = generateSlots(dept.opensAt, dept.closesAt, dept.slotMinutes).filter((t) => toMinutes(t) + dept.slotMinutes > now)
    let time = a.time
    if (time) {
      if (!HHMM.test(time) || !open.includes(time)) fail('invalid_slot')
      if (taken.has(time)) fail('slot_taken')
    } else {
      time = open.find((t) => !taken.has(t))
      if (!time) return fail('day_full') // no waiting list, nothing carries over
    }

    // A walk-in whose phone number has a ỌMA account can follow their place online.
    let bookedBy: Id<'users'> | undefined
    let familyMemberId: Id<'familyMembers'> | undefined
    if (phone) {
      const owner = await ctx.db.query('users').withIndex('by_phone', (q) => q.eq('phone', phone)).first()
      if (owner?.role === 'patient') {
        const self = (await ctx.db.query('familyMembers').withIndex('by_owner', (q) => q.eq('ownerId', owner._id)).collect()).find((m) => m.isSelf)
        if (self && all.some((x) => x.status !== 'cancelled' && x.familyMemberId === self._id)) fail('already_booked')
        bookedBy = owner._id
        familyMemberId = self?._id
      }
    }
    const apptId = await ctx.db.insert('appointments', {
      clinicId: user.clinicId, departmentId: dept._id, familyMemberId, bookedBy, patientName: name,
      patientPhone: phone ?? undefined, type: 'walk_in', date, time, queueNumber: await nextQueueNumber(ctx, dept._id, date),
      status: 'checked_in', depositNaira: 0, depositStatus: 'none', frontRank: 0, alertAhead: 3, arrivedAt: Date.now(),
    })
    const appt = (await ctx.db.get(apptId))!
    await logAction(ctx, { clinicId: user.clinicId, actor: user, action: 'walk_in_registered', appt })
    await queueChanged(ctx, appt.clinicId, appt.departmentId)
    const clinic = (await ctx.db.get(user.clinicId))!
    return { appointment: staffJson(appt, dept.name, clinic.graceMinutes) }
  },
})

// Doctor left early or the clinic closes: cancel the rest of today. Deposits go back to Kolo.
export const cancelDay = mutation({
  args: { ...tokenArg, departmentId: v.optional(v.string()), reason: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const user = await requireStaff(ctx, a.token)
    const reason = a.reason ? text(a.reason, 2, 200, 'reason') : 'Clinic closed'
    const rows = (await ctx.db.query('appointments').withIndex('by_clinic_date', (q) => q.eq('clinicId', user.clinicId).eq('date', todayLagos())).collect())
      .filter((x) => ['booked', 'checked_in', 'called'].includes(x.status) && (!a.departmentId || x.departmentId === a.departmentId))
    const touched = new Set<Id<'departments'>>()
    for (const appt of rows) {
      const depositStatus = await settleDeposit(ctx, appt, 'returned')
      await ctx.db.patch(appt._id, { status: 'cancelled', cancelledAt: Date.now(), cancelledBy: 'clinic', depositStatus })
      await logAction(ctx, { clinicId: user.clinicId, actor: user, action: 'cancelled_by_clinic', appt, reason })
      touched.add(appt.departmentId)
    }
    await logAction(ctx, { clinicId: user.clinicId, actor: user, action: 'day_cancelled', reason, details: { count: rows.length } })
    for (const d of touched) await queueChanged(ctx, user.clinicId, d)
    return { cancelled: rows.length }
  },
})

// Staff may adjust a department's slot length at any time (the change is logged).
export const setSlotLength = mutation({
  args: { ...tokenArg, departmentId: v.string(), slotMinutes: v.number() },
  handler: async (ctx, a) => {
    const user = await requireStaff(ctx, a.token)
    const slotMinutes = int(a.slotMinutes, 5, 120, 'slotMinutes')
    const id = ctx.db.normalizeId('departments', a.departmentId)
    const dept = id && (await ctx.db.get(id))
    if (!dept || dept.clinicId !== user.clinicId) return fail('not_found')
    await ctx.db.patch(dept._id, { slotMinutes })
    await logAction(ctx, { clinicId: user.clinicId, actor: user, action: 'slot_length_changed', details: { departmentId: dept._id, slotMinutes } })
    return { slotMinutes }
  },
})

// ---------- manager ----------
const requireManager = async (ctx: QueryCtx, token: string | undefined) => {
  const user = await requireStaff(ctx, token)
  if (user.role !== 'manager') fail('forbidden')
  return user
}
const departmentJson = (d: Doc<'departments'>) => ({
  id: d._id, name: d.name, consultationFee: d.consultationFee, opensAt: d.opensAt, closesAt: d.closesAt,
  slotMinutes: d.slotMinutes, avgVisitMinutes: d.avgVisitMinutes, active: d.active,
})

export const managerClinic = query({
  args: tokenArg,
  handler: async (ctx, { token }) => {
    const user = await requireManager(ctx, token)
    const c = (await ctx.db.get(user.clinicId))!
    const depts = (await clinicDepartments(ctx, c._id)).sort((a, b) => a.name.localeCompare(b.name))
    const staff = (await ctx.db.query('users').withIndex('by_clinic', (q) => q.eq('clinicId', c._id)).collect())
      .sort((a, b) => a.role.localeCompare(b.role) || a.name.localeCompare(b.name))
    return {
      clinic: {
        id: c._id, name: c.name, type: c.type, billingType: c.billingType, paymentOption: c.paymentOption, status: c.status,
        state: c.state ?? null, area: c.area ?? null, address: c.address ?? null, latitude: c.latitude ?? null, longitude: c.longitude ?? null,
        graceMinutes: c.graceMinutes, cancelWindowMinutes: c.cancelWindowMinutes, depositNaira: c.depositNaira,
      },
      departments: depts.map(departmentJson),
      staff: staff.map((s) => ({ id: s._id, name: s.name, email: s.email ?? null, role: s.role, active: s.active })),
    }
  },
})

// Clinic type and billing type are set at registration; only a ỌMA admin can change them.
export const updateClinic = mutation({
  args: {
    ...tokenArg, name: v.optional(v.string()), state: v.optional(v.string()), area: v.optional(v.string()), address: v.optional(v.string()),
    latitude: v.optional(v.union(v.number(), v.null())), longitude: v.optional(v.union(v.number(), v.null())),
    graceMinutes: v.optional(v.number()), cancelWindowMinutes: v.optional(v.number()),
  },
  handler: async (ctx, a) => {
    const user = await requireManager(ctx, a.token)
    const { token: _t, ...d } = a
    void _t
    const patch: Partial<Doc<'clinics'>> = {}
    if (d.name !== undefined) patch.name = text(d.name, 2, 120, 'name')
    if (d.state !== undefined) patch.state = text(d.state, 2, 60, 'state')
    if (d.area !== undefined) patch.area = text(d.area, 2, 60, 'area')
    if (d.address !== undefined) patch.address = text(d.address, 3, 200, 'address')
    if (d.graceMinutes !== undefined) patch.graceMinutes = int(d.graceMinutes, 0, 120, 'graceMinutes')
    if (d.cancelWindowMinutes !== undefined) patch.cancelWindowMinutes = int(d.cancelWindowMinutes, 0, 1440, 'cancelWindowMinutes')
    if (d.latitude !== undefined || d.longitude !== undefined) {
      patch.latitude = d.latitude ?? undefined
      patch.longitude = d.longitude ?? undefined
    }
    await ctx.db.patch(user.clinicId, patch)
    await logAction(ctx, { clinicId: user.clinicId, actor: user, action: 'clinic_settings_changed', details: d })
    return { ok: true }
  },
})

function checkDept(d: { name?: string; consultationFee?: number | null; opensAt?: string; closesAt?: string; slotMinutes?: number; avgVisitMinutes?: number }) {
  const out: Partial<Doc<'departments'>> = {}
  if (d.name !== undefined) out.name = text(d.name, 2, 80, 'name')
  if (d.consultationFee !== undefined) out.consultationFee = d.consultationFee === null ? null : int(d.consultationFee, 0, 10_000_000, 'consultationFee')
  if (d.opensAt !== undefined) { if (!HHMM.test(d.opensAt)) fail('invalid_input', { field: 'opensAt' }); out.opensAt = d.opensAt }
  if (d.closesAt !== undefined) { if (!HHMM.test(d.closesAt)) fail('invalid_input', { field: 'closesAt' }); out.closesAt = d.closesAt }
  if (d.slotMinutes !== undefined) out.slotMinutes = int(d.slotMinutes, 5, 120, 'slotMinutes')
  if (d.avgVisitMinutes !== undefined) out.avgVisitMinutes = int(d.avgVisitMinutes, 1, 240, 'avgVisitMinutes')
  return out
}
const deptFields = {
  name: v.optional(v.string()), consultationFee: v.optional(v.union(v.number(), v.null())), opensAt: v.optional(v.string()),
  closesAt: v.optional(v.string()), slotMinutes: v.optional(v.number()), avgVisitMinutes: v.optional(v.number()),
}
async function nameTaken(ctx: QueryCtx, clinicId: Id<'clinics'>, name: string, except?: Id<'departments'>) {
  return (await clinicDepartments(ctx, clinicId)).some((x) => x._id !== except && x.name.toLowerCase() === name.toLowerCase())
}

export const addDepartment = mutation({
  args: { ...tokenArg, ...deptFields },
  handler: async (ctx, a) => {
    const user = await requireManager(ctx, a.token)
    const d = checkDept(a)
    if (!d.name || !d.opensAt || !d.closesAt || d.slotMinutes == null || d.avgVisitMinutes == null || d.consultationFee === undefined) fail('invalid_input')
    if (toMinutes(d.closesAt!) <= toMinutes(d.opensAt!)) fail('invalid_input', { field: 'closesAt' })
    if (await nameTaken(ctx, user.clinicId, d.name!)) fail('department_exists')
    const id = await ctx.db.insert('departments', {
      clinicId: user.clinicId, name: d.name!, consultationFee: d.consultationFee!, opensAt: d.opensAt!, closesAt: d.closesAt!,
      slotMinutes: d.slotMinutes!, avgVisitMinutes: d.avgVisitMinutes!, active: true,
    })
    await logAction(ctx, { clinicId: user.clinicId, actor: user, action: 'department_created', details: { name: d.name } })
    return { department: departmentJson((await ctx.db.get(id))!) }
  },
})

export const updateDepartment = mutation({
  args: { ...tokenArg, id: v.string(), ...deptFields, active: v.optional(v.boolean()) },
  handler: async (ctx, a) => {
    const user = await requireManager(ctx, a.token)
    const id = ctx.db.normalizeId('departments', a.id)
    const dept = id && (await ctx.db.get(id))
    if (!dept || dept.clinicId !== user.clinicId) return fail('not_found')
    const patch = { ...checkDept(a), ...(a.active !== undefined ? { active: a.active } : {}) }
    if (toMinutes(patch.closesAt ?? dept.closesAt) <= toMinutes(patch.opensAt ?? dept.opensAt)) fail('invalid_input', { field: 'closesAt' })
    if (patch.name && (await nameTaken(ctx, user.clinicId, patch.name, dept._id))) fail('department_exists')
    await ctx.db.patch(dept._id, patch)
    const { token: _t, ...details } = a
    void _t
    await logAction(ctx, { clinicId: user.clinicId, actor: user, action: 'department_updated', details })
    return { department: departmentJson((await ctx.db.get(dept._id))!) }
  },
})

// Front-desk staff logins for this clinic (managers are created at registration).
export const addStaff = mutation({
  args: { ...tokenArg, name: v.string(), email: v.string(), password: v.string() },
  handler: async (ctx, a) => {
    const user = await requireManager(ctx, a.token)
    const name = text(a.name, 2, 100, 'name')
    const email = cleanEmail(a.email)
    if (a.password.length < 8 || a.password.length > 72) fail('invalid_input', { field: 'password' })
    if ((await ctx.db.query('users').withIndex('by_email', (q) => q.eq('email', email)).collect()).some((u) => u.role !== 'patient')) fail('email_taken')
    const id = await ctx.db.insert('users', {
      role: 'staff', name, email, secretHash: await hashSecret(a.password), language: 'en', alertAhead: 3,
      clinicId: user.clinicId, active: true, consentAt: Date.now(), failedAttempts: 0,
    })
    await logAction(ctx, { clinicId: user.clinicId, actor: user, action: 'staff_created', details: { name } })
    return { staff: { id, name, email, role: 'staff', active: true } }
  },
})

export const setStaffActive = mutation({
  args: { ...tokenArg, id: v.string(), active: v.boolean() },
  handler: async (ctx, a) => {
    const user = await requireManager(ctx, a.token)
    const id = ctx.db.normalizeId('users', a.id)
    const s = id && (await ctx.db.get(id))
    if (!s || s.clinicId !== user.clinicId || s.role !== 'staff') return fail('not_found')
    await ctx.db.patch(s._id, { active: a.active })
    if (!a.active) for (const x of await ctx.db.query('sessions').withIndex('by_user', (q) => q.eq('userId', s._id)).collect()) await ctx.db.delete(x._id)
    await logAction(ctx, { clinicId: user.clinicId, actor: user, action: a.active ? 'staff_enabled' : 'staff_disabled', details: { name: s.name } })
    return { staff: { id: s._id, name: s.name, email: s.email ?? null, role: s.role, active: a.active } }
  },
})

// ---------- ỌMA admin ----------
const adminClinicJson = (c: Doc<'clinics'>) => ({
  id: c._id, name: c.name, type: c.type, billingType: c.billingType, paymentOption: c.paymentOption,
  state: c.state ?? null, area: c.area ?? null, address: c.address ?? null, landmark: c.landmark ?? null,
  email: c.email ?? null, status: c.status, active: c.active, createdAt: new Date(c._creationTime).toISOString(),
})

export const adminClinics = query({
  args: { ...tokenArg, status: v.optional(v.string()) },
  handler: async (ctx, a) => {
    await requireRole(ctx, a.token, 'admin')
    const rows = a.status === 'pending' || a.status === 'approved'
      ? await ctx.db.query('clinics').withIndex('by_status', (q) => q.eq('status', a.status as 'pending' | 'approved')).collect()
      : await ctx.db.query('clinics').collect()
    return { clinics: rows.sort((x, y) => y._creationTime - x._creationTime).map(adminClinicJson) }
  },
})

export const approveClinic = mutation({
  args: { ...tokenArg, id: v.string() },
  handler: async (ctx, a) => {
    const admin = await requireRole(ctx, a.token, 'admin')
    const id = ctx.db.normalizeId('clinics', a.id)
    const c = id && (await ctx.db.get(id))
    if (!c) return fail('not_found')
    await ctx.db.patch(c._id, { status: 'approved' })
    await logAction(ctx, { clinicId: c._id, actor: { id: admin._id, name: 'ỌMA admin' }, action: 'clinic_approved' })
    return { clinic: adminClinicJson((await ctx.db.get(c._id))!) }
  },
})

// Only a ỌMA admin can change a clinic's type or payment option. 'school' turns the deposit off
// and the miss-2-bookings rule on; other types take the deposit.
export const adminUpdateClinic = mutation({
  args: { ...tokenArg, id: v.string(), type: v.optional(v.string()), paymentOption: v.optional(v.string()), active: v.optional(v.boolean()) },
  handler: async (ctx, a) => {
    const admin = await requireRole(ctx, a.token, 'admin')
    const id = ctx.db.normalizeId('clinics', a.id)
    const c = id && (await ctx.db.get(id))
    if (!c) return fail('not_found')
    const patch: Partial<Doc<'clinics'>> = {}
    if (a.type !== undefined) {
      if (!['public', 'mission', 'private', 'school'].includes(a.type)) fail('invalid_input', { field: 'type' })
      patch.type = a.type as Doc<'clinics'>['type']
      patch.billingType = billingTypeFor(a.type)
    }
    if (a.paymentOption !== undefined) {
      if (a.paymentOption !== 'per_patient' && a.paymentOption !== 'monthly') fail('invalid_input', { field: 'paymentOption' })
      patch.paymentOption = a.paymentOption as Doc<'clinics'>['paymentOption']
    }
    if (a.active !== undefined) patch.active = a.active
    await ctx.db.patch(c._id, patch)
    const { token: _t, ...details } = a
    void _t
    await logAction(ctx, { clinicId: c._id, actor: { id: admin._id, name: 'ỌMA admin' }, action: 'clinic_updated_by_admin', details })
    return { clinic: adminClinicJson((await ctx.db.get(c._id))!) }
  },
})

// ---------- public "Now serving" screen ----------
// Privacy: only first names and queue numbers, nothing else about the patient.
export const nowServing = query({
  args: { clinicId: v.string() },
  handler: async (ctx, a) => {
    const id = ctx.db.normalizeId('clinics', a.clinicId)
    const c = id && (await ctx.db.get(id))
    if (!c || c.status !== 'approved' || !c.active) return fail('not_found')
    const date = todayLagos()
    const depts = (await clinicDepartments(ctx, c._id)).filter((d) => d.active).sort((x, y) => x.name.localeCompare(y.name))
    const person = (r: Doc<'appointments'>) => ({ queueNumber: r.queueNumber, firstName: firstName(r.patientName) })
    const departments = []
    for (const d of depts) {
      const all = await dayAppointments(ctx, d._id, date)
      const serving = all.filter((x) => x.status === 'called').sort((x, y) => (y.calledAt ?? 0) - (x.calledAt ?? 0))[0]
      const next = all.filter((x) => x.status === 'checked_in').sort(queueCompare).slice(0, 3)
      departments.push({ departmentId: d._id, departmentName: d.name, nowServing: serving ? person(serving) : null, next: next.map(person) })
    }
    return { clinic: { id: c._id, name: c.name }, departments }
  },
})

// ---------- live ----------
// Screens subscribe to this; it changes whenever the clinic's or department's queue does.
// Only a number goes out, so it needs no sign-in.
export const version = query({
  args: { clinicId: v.optional(v.string()), departmentId: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const key = a.clinicId ? `clinic:${a.clinicId}` : a.departmentId ? `dept:${a.departmentId}` : null
    if (!key) return 0
    return (await ctx.db.query('queueVersions').withIndex('by_key', (q) => q.eq('key', key)).first())?.version ?? 0
  },
})
