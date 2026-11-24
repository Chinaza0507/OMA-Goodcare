// Patient side: family members, Kolo wallet, finding hospitals, booking and visits.
// Also hospital self-registration (it creates the hospital's front-desk sign-in).
import { v } from 'convex/values'
import { mutation, query, type QueryCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import {
  cleanEmail, createSession, fail, generateSlots, hashSecret, int, logAction, nowMinutesLagos,
  publicUser, queueChanged, requirePatient, slotInstant, text, todayLagos, toMinutes, HHMM,
} from './lib/core'
import {
  bookAppointment, cancelAppointment, getBalances, isActive, queueInfo, takenTimes, topUp, dayAppointments,
} from './lib/rules'

const tokenArg = { token: v.optional(v.string()) }
const CLINIC_TYPES = ['public', 'mission', 'private', 'school'] as const
export const billingTypeFor = (type: string) => (type === 'school' ? 'covered' : 'paid') as 'covered' | 'paid'

// ---------- hospital registration ----------
// Creates the clinic (pending until a ỌMA admin approves it) and the hospital's own sign-in
// (official email + password), shared by whoever is at the front desk.
export const registerHospital = mutation({
  args: {
    hospitalName: v.string(), type: v.string(), state: v.string(), area: v.string(), address: v.string(),
    landmark: v.optional(v.string()), latitude: v.optional(v.number()), longitude: v.optional(v.number()),
    email: v.string(), password: v.string(), language: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    const name = text(a.hospitalName, 2, 120, 'hospitalName')
    if (!(CLINIC_TYPES as readonly string[]).includes(a.type)) fail('invalid_input', { field: 'type' })
    const type = a.type as (typeof CLINIC_TYPES)[number]
    const email = cleanEmail(a.email)
    if (a.password.length < 8 || a.password.length > 72) fail('invalid_input', { field: 'password' })
    if ((a.latitude == null) !== (a.longitude == null)) fail('invalid_input')
    if (a.latitude != null && (Math.abs(a.latitude) > 90 || Math.abs(a.longitude!) > 180)) fail('invalid_input')
    const existing = await ctx.db.query('users').withIndex('by_email', (q) => q.eq('email', email)).collect()
    if (existing.some((u) => u.role !== 'patient')) fail('email_taken')

    const clinicId = await ctx.db.insert('clinics', {
      name, type, billingType: billingTypeFor(type), paymentOption: 'per_patient',
      state: text(a.state, 2, 60, 'state'), area: text(a.area, 2, 60, 'area'), address: text(a.address, 3, 200, 'address'),
      landmark: a.landmark?.trim().slice(0, 200) || undefined, email,
      latitude: a.latitude, longitude: a.longitude, status: 'pending',
      graceMinutes: 10, cancelWindowMinutes: 120, depositNaira: 300, active: true,
    })
    const userId = await ctx.db.insert('users', {
      role: 'manager', name, email, secretHash: await hashSecret(a.password), language: a.language ?? 'en',
      alertAhead: 3, clinicId, active: true, consentAt: Date.now(), failedAttempts: 0,
    })
    await logAction(ctx, { clinicId, actor: { id: userId, name }, action: 'clinic_registered', details: { type } })
    const user = (await ctx.db.get(userId))!
    return { token: await createSession(ctx, userId), user: publicUser(user), clinic: { id: clinicId, name, type, status: 'pending' } }
  },
})

// ---------- family ----------
const MAX_MEMBERS = 12
const memberJson = (m: Doc<'familyMembers'>) => ({ id: m._id, name: m.name, age: m.age ?? null, isSelf: m.isSelf })
const members = (ctx: QueryCtx, ownerId: Id<'users'>) => ctx.db.query('familyMembers').withIndex('by_owner', (q) => q.eq('ownerId', ownerId)).collect()

export const familyList = query({
  args: tokenArg,
  handler: async (ctx, { token }) => {
    const user = await requirePatient(ctx, token)
    const all = await members(ctx, user._id)
    all.sort((a, b) => Number(b.isSelf) - Number(a.isSelf) || a._creationTime - b._creationTime)
    return { members: all.map(memberJson) }
  },
})

export const familyAdd = mutation({
  args: { ...tokenArg, name: v.string(), age: v.optional(v.number()) },
  handler: async (ctx, a) => {
    const user = await requirePatient(ctx, a.token)
    if ((await members(ctx, user._id)).length >= MAX_MEMBERS) fail('family_full')
    const id = await ctx.db.insert('familyMembers', {
      ownerId: user._id, name: text(a.name, 2, 100, 'name'), age: a.age == null ? undefined : int(a.age, 0, 120, 'age'), isSelf: false,
    })
    return { member: memberJson((await ctx.db.get(id))!) }
  },
})

export const familyUpdate = mutation({
  args: { ...tokenArg, id: v.string(), name: v.optional(v.string()), age: v.optional(v.number()) },
  handler: async (ctx, a) => {
    const user = await requirePatient(ctx, a.token)
    const id = ctx.db.normalizeId('familyMembers', a.id)
    const m = id && (await ctx.db.get(id))
    if (!m || m.ownerId !== user._id) return fail('not_found')
    await ctx.db.patch(m._id, {
      ...(a.name !== undefined ? { name: text(a.name, 2, 100, 'name') } : {}),
      ...(a.age !== undefined ? { age: int(a.age, 0, 120, 'age') } : {}),
    })
    return { member: memberJson((await ctx.db.get(m._id))!) }
  },
})

// Removing a family member cancels their upcoming visits under the normal rules.
export const familyRemove = mutation({
  args: { ...tokenArg, id: v.string() },
  handler: async (ctx, a) => {
    const user = await requirePatient(ctx, a.token)
    const id = ctx.db.normalizeId('familyMembers', a.id)
    const m = id && (await ctx.db.get(id))
    if (!m || m.ownerId !== user._id) return fail('not_found')
    if (m.isSelf) fail('cannot_remove_self')
    for (const appt of await ctx.db.query('appointments').withIndex('by_member', (q) => q.eq('familyMemberId', m._id)).collect()) {
      if (appt.status === 'booked') {
        const r = await cancelAppointment(ctx, { appointmentId: appt._id, userId: user._id, confirm: true })
        await queueChanged(ctx, r.clinicId, r.departmentId)
      }
      // Keep past visit records (they store the patient's name): detach, then delete.
      await ctx.db.patch(appt._id, { familyMemberId: undefined })
    }
    await ctx.db.delete(m._id)
    return null
  },
})

// ---------- Kolo ----------
export const kolo = query({
  args: tokenArg,
  handler: async (ctx, { token }) => {
    const user = await requirePatient(ctx, token)
    return { ...(await getBalances(ctx, user._id)), simulated: true }
  },
})

// Simulated top-up for the prototype. Real money needs a licensed financial partner (Phase 2).
export const koloTopUp = mutation({
  args: { ...tokenArg, amount: v.number() },
  handler: async (ctx, a) => {
    const user = await requirePatient(ctx, a.token)
    const b = await topUp(ctx, user._id, int(a.amount, 100, 100_000, 'amount'))
    return { ...b, simulated: true }
  },
})

export const koloTransactions = query({
  args: { ...tokenArg, limit: v.optional(v.number()) },
  handler: async (ctx, a) => {
    const user = await requirePatient(ctx, a.token)
    const limit = Math.min(Math.max(Math.floor(a.limit ?? 50), 1), 200)
    const rows = await ctx.db.query('koloTransactions').withIndex('by_user', (q) => q.eq('userId', user._id)).order('desc').take(limit)
    const transactions = []
    for (const t of rows) {
      const appt = t.appointmentId ? await ctx.db.get(t.appointmentId) : null
      const dept = appt ? await ctx.db.get(appt.departmentId) : null
      const clinic = appt ? await ctx.db.get(appt.clinicId) : null
      transactions.push({
        id: t._id, type: t.type, amount: t.amount, availableAfter: t.availableAfter, reservedAfter: t.reservedAfter,
        createdAt: new Date(t._creationTime).toISOString(),
        appointment: appt && {
          id: appt._id, clinicName: clinic?.name, departmentName: dept?.name, patientName: appt.patientName,
          date: appt.date, time: appt.time, status: appt.status, depositStatus: appt.depositStatus,
        },
      })
    }
    return { transactions }
  },
})

// ---------- hospitals ----------
const distanceKm = (lat1: number, lng1: number, lat2: number, lng2: number) => {
  const rad = (d: number) => (d * Math.PI) / 180
  const x = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2
  return 6371 * 2 * Math.asin(Math.sqrt(x))
}
const deptJson = (d: Doc<'departments'>) => ({
  id: d._id, name: d.name, consultationFee: d.consultationFee, opensAt: d.opensAt, closesAt: d.closesAt, slotMinutes: d.slotMinutes,
})
async function clinicJson(ctx: QueryCtx, c: Doc<'clinics'>) {
  const depts = (await ctx.db.query('departments').withIndex('by_clinic', (q) => q.eq('clinicId', c._id)).collect())
    .filter((d) => d.active).sort((a, b) => a.name.localeCompare(b.name))
  return {
    id: c._id, name: c.name, type: c.type, state: c.state ?? null, area: c.area ?? null, address: c.address ?? null,
    landmark: c.landmark ?? null, billingType: c.billingType, depositNaira: c.billingType === 'paid' ? c.depositNaira : 0,
    cancelWindowMinutes: c.cancelWindowMinutes, departments: depts.map(deptJson),
  }
}
const approved = async (ctx: QueryCtx) =>
  (await ctx.db.query('clinics').withIndex('by_status', (q) => q.eq('status', 'approved')).collect()).filter((c) => c.active)

// Patients see only approved, active hospitals. Pass lat+lng to sort nearest first.
export const clinics = query({
  args: { state: v.optional(v.string()), area: v.optional(v.string()), maxFee: v.optional(v.number()), lat: v.optional(v.number()), lng: v.optional(v.number()) },
  handler: async (ctx, f) => {
    const list = (await approved(ctx))
      .filter((c) => !f.state || c.state?.toLowerCase() === f.state.toLowerCase())
      .filter((c) => !f.area || c.area?.toLowerCase() === f.area.toLowerCase())
      .sort((a, b) => a.name.localeCompare(b.name))
    const near = f.lat != null && f.lng != null
    let result = []
    for (const c of list) {
      result.push({
        ...(await clinicJson(ctx, c)),
        distanceKm: near && c.latitude != null && c.longitude != null ? Math.round(distanceKm(f.lat!, f.lng!, c.latitude, c.longitude) * 10) / 10 : null,
      })
    }
    if (f.maxFee != null) result = result.filter((c) => c.departments.some((d) => d.consultationFee == null || d.consultationFee <= f.maxFee!))
    if (near) result.sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity))
    return { clinics: result }
  },
})

// Values for the state/area filter dropdowns.
export const locations = query({
  args: {},
  handler: async (ctx) => {
    const seen = new Map<string, { state: string; area: string | null }>()
    for (const c of await approved(ctx)) if (c.state) seen.set(`${c.state}|${c.area ?? ''}`, { state: c.state, area: c.area ?? null })
    return { locations: [...seen.values()].sort((a, b) => a.state.localeCompare(b.state) || (a.area ?? '').localeCompare(b.area ?? '')) }
  },
})

export const clinic = query({
  args: { id: v.string() },
  handler: async (ctx, a) => {
    const id = ctx.db.normalizeId('clinics', a.id)
    const c = id && (await ctx.db.get(id))
    if (!c || c.status !== 'approved' || !c.active) return fail('not_found')
    return { clinic: await clinicJson(ctx, c) }
  },
})

// Free and taken times for a department today (same-day booking only).
export const slots = query({
  args: { departmentId: v.string(), date: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const today = todayLagos()
    const date = a.date ?? today
    if (date !== today) fail('invalid_date')
    const id = ctx.db.normalizeId('departments', a.departmentId)
    const dept = id && (await ctx.db.get(id))
    const clinic = dept && (await ctx.db.get(dept.clinicId))
    if (!dept || !dept.active || !clinic || !clinic.active || clinic.status !== 'approved') return fail('not_found')
    const taken = takenTimes(await dayAppointments(ctx, dept._id, date))
    const now = nowMinutesLagos()
    return {
      date, slotMinutes: dept.slotMinutes,
      slots: generateSlots(dept.opensAt, dept.closesAt, dept.slotMinutes).map((time) => ({ time, available: !taken.has(time) && toMinutes(time) >= now })),
    }
  },
})

// ---------- visits ----------
async function visitJson(ctx: QueryCtx, a: Doc<'appointments'>) {
  const d = (await ctx.db.get(a.departmentId))!
  const c = (await ctx.db.get(a.clinicId))!
  return {
    id: a._id, clinicId: a.clinicId, clinicName: c.name, departmentId: a.departmentId, departmentName: d.name,
    patientName: a.patientName, familyMemberId: a.familyMemberId ?? null, type: a.type, date: a.date,
    time: a.time, // an arrival time, not a guaranteed consultation time
    queueNumber: a.queueNumber, status: a.status,
    deposit: { amount: a.depositNaira, status: a.depositStatus }, alertAhead: a.alertAhead,
    canCancel: a.status === 'booked',
    cancelRefundsDeposit: slotInstant(a.date, a.time) - Date.now() >= c.cancelWindowMinutes * 60_000,
    queue: await queueInfo(ctx, a, d.avgVisitMinutes),
  }
}

export const book = mutation({
  args: { ...tokenArg, familyMemberId: v.string(), departmentId: v.string(), date: v.string(), time: v.string(), alertAhead: v.optional(v.number()) },
  handler: async (ctx, a) => {
    const user = await requirePatient(ctx, a.token)
    const familyMemberId = ctx.db.normalizeId('familyMembers', a.familyMemberId) ?? fail('not_found')
    const departmentId = ctx.db.normalizeId('departments', a.departmentId) ?? fail('not_found')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(a.date) || !HHMM.test(a.time)) fail('invalid_input')
    const { appt } = await bookAppointment(ctx, {
      user, familyMemberId, departmentId, date: a.date, time: a.time,
      alertAhead: a.alertAhead == null ? undefined : int(a.alertAhead, 1, 10, 'alertAhead'),
    })
    await queueChanged(ctx, appt.clinicId, appt.departmentId)
    return { appointment: await visitJson(ctx, appt) }
  },
})

// scope 'upcoming' (default) or 'previous'.
export const visits = query({
  args: { ...tokenArg, scope: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const user = await requirePatient(ctx, a.token)
    const today = todayLagos()
    const all = await ctx.db.query('appointments').withIndex('by_booked_by', (q) => q.eq('bookedBy', user._id)).collect()
    const upcoming = (x: Doc<'appointments'>) => x.date >= today && isActive(x.status)
    const key = (x: Doc<'appointments'>) => `${x.date} ${x.time}`
    const list = a.scope === 'previous'
      ? all.filter((x) => !upcoming(x)).sort((x, y) => key(y).localeCompare(key(x))).slice(0, 100)
      : all.filter(upcoming).sort((x, y) => key(x).localeCompare(key(y)))
    const appointments = []
    for (const x of list) appointments.push(await visitJson(ctx, x))
    return { appointments }
  },
})

async function ownVisit(ctx: QueryCtx, token: string | undefined, rawId: string) {
  const user = await requirePatient(ctx, token)
  const id = ctx.db.normalizeId('appointments', rawId)
  const appt = id && (await ctx.db.get(id))
  if (!appt || appt.bookedBy !== user._id) return fail('not_found')
  return { user, appt }
}

export const visit = query({
  args: { ...tokenArg, id: v.string() },
  handler: async (ctx, a) => ({ appointment: await visitJson(ctx, (await ownVisit(ctx, a.token, a.id)).appt) }),
})

// Within the clinic's cancellation window the deposit is forfeited, so the patient must send
// confirm: true after seeing the warning.
export const cancelVisit = mutation({
  args: { ...tokenArg, id: v.string(), confirm: v.optional(v.boolean()) },
  handler: async (ctx, a) => {
    const { user, appt } = await ownVisit(ctx, a.token, a.id)
    const r = await cancelAppointment(ctx, { appointmentId: appt._id, userId: user._id, confirm: a.confirm ?? false })
    await queueChanged(ctx, r.clinicId, r.departmentId)
    return { status: 'cancelled', depositStatus: r.depositStatus }
  },
})

// Change when the "turn is close" alert fires (1 to 10 people ahead).
export const setVisitAlert = mutation({
  args: { ...tokenArg, id: v.string(), alertAhead: v.number() },
  handler: async (ctx, a) => {
    const { appt } = await ownVisit(ctx, a.token, a.id)
    await ctx.db.patch(appt._id, { alertAhead: int(a.alertAhead, 1, 10, 'alertAhead') })
    return { appointment: await visitJson(ctx, (await ctx.db.get(appt._id))!) }
  },
})

