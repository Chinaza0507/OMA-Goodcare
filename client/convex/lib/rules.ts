// Kolo money movements, booking, cancelling, queue order and the school no-show rule.
// Each Convex mutation is one transaction, so balances, history rows and bookings
// always change together or not at all.
import type { MutationCtx, QueryCtx } from '../_generated/server'
import type { Doc, Id } from '../_generated/dataModel'
import { fail, nowMinutesLagos, slotInstant, toMinutes, todayLagos, fromMinutes } from './core'

// ---------- Kolo ----------
type TxType = Doc<'koloTransactions'>['type']
async function apply(
  ctx: MutationCtx, userId: Id<'users'>, type: TxType, amount: number,
  appointmentId: Id<'appointments'> | undefined, dAvailable: number, dReserved: number,
) {
  let wallet = await ctx.db.query('koloWallets').withIndex('by_user', (q) => q.eq('userId', userId)).first()
  if (!wallet) {
    const id = await ctx.db.insert('koloWallets', { userId, available: 0, reserved: 0 })
    wallet = (await ctx.db.get(id))!
  }
  const available = wallet.available + dAvailable
  const reserved = wallet.reserved + dReserved
  if (available < 0) fail('kolo_low', { needed: amount, available: wallet.available })
  if (reserved < 0) throw new Error('Kolo reserved balance would go negative')
  await ctx.db.patch(wallet._id, { available, reserved })
  await ctx.db.insert('koloTransactions', { userId, type, amount, appointmentId, availableAfter: available, reservedAfter: reserved })
  return { available, reserved }
}
export const topUp = (ctx: MutationCtx, userId: Id<'users'>, amount: number) => apply(ctx, userId, 'topup', amount, undefined, amount, 0)
const hold = (ctx: MutationCtx, userId: Id<'users'>, amount: number, id: Id<'appointments'>) => apply(ctx, userId, 'hold', amount, id, -amount, amount)

export async function getBalances(ctx: QueryCtx, userId: Id<'users'>) {
  const w = await ctx.db.query('koloWallets').withIndex('by_user', (q) => q.eq('userId', userId)).first()
  return { available: w?.available ?? 0, reserved: w?.reserved ?? 0 }
}

// Settle a held deposit. Used by every path that ends an appointment.
export async function settleDeposit(ctx: MutationCtx, appt: Doc<'appointments'>, outcome: 'returned' | 'deducted' | 'forfeited') {
  if (appt.depositStatus !== 'held') return appt.depositStatus
  const amt = appt.depositNaira
  if (outcome === 'returned') await apply(ctx, appt.bookedBy, 'refund', amt, appt._id, amt, -amt)
  else if (outcome === 'deducted') await apply(ctx, appt.bookedBy, 'deduct', amt, appt._id, 0, -amt)
  else await apply(ctx, appt.bookedBy, 'forfeit', amt, appt._id, 0, -amt)
  return outcome
}

// ---------- queue ----------
export const ACTIVE = ['booked', 'checked_in', 'called'] as const
export const isActive = (st: string) => (ACTIVE as readonly string[]).includes(st)

// Order of the booking line for a department and day: "move to front" first, then the booked
// time, then queue number. This is the ONE definition of "who is ahead".
export const queueCompare = (a: Doc<'appointments'>, b: Doc<'appointments'>) =>
  a.frontRank - b.frontRank || toMinutes(a.time) - toMinutes(b.time) || a.queueNumber - b.queueNumber

export const dayAppointments = (ctx: QueryCtx, departmentId: Id<'departments'>, date: string) =>
  ctx.db.query('appointments').withIndex('by_dept_date', (q) => q.eq('departmentId', departmentId).eq('date', date)).collect()

// Lowest rank in this department/day, minus one: puts someone at the very front.
export async function frontOfQueueRank(ctx: QueryCtx, appt: Doc<'appointments'>) {
  const all = await dayAppointments(ctx, appt.departmentId, appt.date)
  return all.reduce((m, a) => Math.min(m, a.frontRank), 0) - 1
}

// Live position for one booking, from the real length of every service ahead of it and how
// far the doctor has actually got. If the doctor runs late, everyone's estimate moves.
export async function queueInfo(ctx: QueryCtx, appt: Doc<'appointments'>) {
  if (!isActive(appt.status) || appt.date !== todayLagos()) return null
  const now = nowMinutesLagos()
  const nowMs = Date.now()
  // Someone who hasn't arrived 10+ minutes after their booked time is treated as late: they no
  // longer hold others up (if they turn up, the desk puts them back in line).
  const LATE_AFTER = 10
  const line = (await dayAppointments(ctx, appt.departmentId, appt.date))
    .filter((a) => isActive(a.status))
    .filter((a) => a._id === appt._id || a.status !== 'booked' || toMinutes(a.time) + LATE_AFTER > now)
    .sort(queueCompare)
  const ahead = line.findIndex((a) => a._id === appt._id)

  // Whoever is with the doctor finishes at the later of "now" and their call time + service length.
  let cursor = now
  for (const a of line) {
    if (a.status !== 'called' || !a.calledAt) continue
    const endMs = Math.max(nowMs, a.calledAt + a.minutes * 60_000)
    cursor = Math.max(cursor, now + Math.round((endMs - nowMs) / 60_000))
  }
  let start = now
  for (const a of line) {
    if (a.status === 'called') { if (a._id === appt._id) start = now; continue }
    start = Math.max(cursor, toMinutes(a.time))
    if (a._id === appt._id) break
    cursor = start + a.minutes
  }
  if (appt.status === 'called') start = now
  // Booked but never arrived, 10+ minutes past their time: they missed it. The desk can put them
  // back in line when they turn up; until then, no "doctor running late" message.
  const missed = appt.status === 'booked' && toMinutes(appt.time) + LATE_AFTER <= now
  const delayMinutes = missed ? 0 : Math.max(0, start - toMinutes(appt.time))
  return {
    ahead: Math.max(0, ahead),
    waitMinutes: Math.max(0, start - now),
    delayMinutes,
    averageVisitMinutes: appt.minutes,
    estimatedFrom: fromMinutes(Math.min(start, 1439)),
    estimatedTo: fromMinutes(Math.min(start + appt.minutes, 1439)),
    alertNow: !missed && ahead <= appt.alertAhead,
    missed,
  }
}

// ---------- booking ----------
// Patients book a booking day up to MAX_DAYS_AHEAD days ahead (today counts as day 0).
export const MAX_DAYS_AHEAD = 2
export const addDays = (date: string, days: number) => {
  const d = new Date(`${date}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
export const weekdayOf = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay()

export function bookingDates(dept: Doc<'departments'>, today = todayLagos()) {
  const out: string[] = []
  for (let i = 0; i <= MAX_DAYS_AHEAD; i++) {
    const d = addDays(today, i)
    if (dept.bookingDays.includes(weekdayOf(d))) out.push(d)
  }
  return out
}

// The booking day is a chain of standard 35-minute blocks from the department's booking hours:
// 7:00, 7:35, 8:10… A booking holds its block, or longer if the service is longer — braces (60 min)
// booked at 7:00 holds 7:00–8:00, and every block after it shifts: 8:00, 8:35, 9:10…
// A patient can start where the chain lands and their service (at least one block) fits before the
// next booking or closing time.
export const STANDARD_MINUTES = 35
const holds = (minutes: number) => Math.max(minutes, STANDARD_MINUTES)

export function freeTimes(dept: Doc<'departments'>, minutes: number, date: string, booked: Doc<'appointments'>[]) {
  const busy = booked
    .filter((a) => a.status !== 'cancelled')
    .map((a) => [toMinutes(a.time), toMinutes(a.time) + holds(a.minutes)])
    .sort((x, y) => x[0] - y[0])
  const close = toMinutes(dept.closesAt)
  const earliest = date === todayLagos() ? nowMinutesLagos() : 0
  const need = holds(minutes)
  const out: string[] = []
  let t = toMinutes(dept.opensAt)
  while (t < close) {
    const inside = busy.find(([s, e]) => s <= t && t < e)
    if (inside) { t = inside[1]; continue } // a booking is running: the chain resumes when it ends
    const next = busy.find(([s]) => s > t)
    const limit = next ? next[0] : close
    if (t + need <= limit && t + minutes <= close && t >= earliest) out.push(fromMinutes(t))
    // Step one block; if that would run into the next booking, jump to the booking.
    t = next && t + STANDARD_MINUTES > next[0] ? next[0] : t + STANDARD_MINUTES
  }
  return out
}

export async function loadBookableService(ctx: QueryCtx, serviceId: Id<'services'>) {
  const service = await ctx.db.get(serviceId)
  const dept = service && (await ctx.db.get(service.departmentId))
  const clinic = dept && (await ctx.db.get(dept.clinicId))
  if (!service || !service.active || !dept || !dept.active || !clinic || !clinic.active || clinic.status !== 'approved') return fail('not_found')
  return { service, dept, clinic }
}

export async function bookAppointment(
  ctx: MutationCtx,
  a: { user: Doc<'users'>; familyMemberId: Id<'familyMembers'>; serviceId: Id<'services'>; date: string; time: string; alertAhead?: number },
) {
  const member = await ctx.db.get(a.familyMemberId)
  if (!member || member.ownerId !== a.user._id) return fail('not_found')
  const { service, dept, clinic } = await loadBookableService(ctx, a.serviceId)
  if (!bookingDates(dept).includes(a.date)) fail('invalid_date')

  // School clinics: students who missed two bookings cannot book for 7 days.
  if (clinic.billingType === 'covered') {
    const t = await ctx.db.query('noshowTracking').withIndex('by_user_clinic', (q) => q.eq('userId', a.user._id).eq('clinicId', clinic._id)).first()
    if (t?.blockedUntil && t.blockedUntil > Date.now()) fail('booking_blocked', { until: new Date(t.blockedUntil).toISOString() })
  }

  const all = await dayAppointments(ctx, dept._id, a.date)
  if (all.some((x) => x.status !== 'cancelled' && x.familyMemberId === member._id)) fail('already_booked')
  if (!freeTimes(dept, service.minutes, a.date, all).includes(a.time)) {
    fail(a.date === todayLagos() && toMinutes(a.time) < nowMinutesLagos() ? 'slot_past' : 'slot_taken')
  }

  const deposit = clinic.billingType === 'paid' ? clinic.depositNaira : 0
  const id = await ctx.db.insert('appointments', {
    clinicId: clinic._id,
    departmentId: dept._id,
    serviceId: service._id,
    serviceName: service.name,
    minutes: service.minutes,
    familyMemberId: member._id,
    bookedBy: a.user._id,
    patientName: member.name,
    date: a.date,
    time: a.time,
    queueNumber: all.reduce((m, x) => Math.max(m, x.queueNumber), 0) + 1,
    status: 'booked',
    depositNaira: deposit,
    depositStatus: deposit > 0 ? 'held' : 'none',
    frontRank: 0,
    alertAhead: a.alertAhead ?? a.user.alertAhead,
  })
  // Reserve the deposit. If the balance is too low this throws and the whole booking is undone.
  if (deposit > 0) await hold(ctx, a.user._id, deposit, id)
  return { appt: (await ctx.db.get(id))!, dept, clinic }
}

// Patient cancels a booked visit. Early cancel (2+ hours, set per clinic) returns the deposit;
// later cancellation forfeits it, and the patient must confirm first.
export async function cancelAppointment(ctx: MutationCtx, a: { appointmentId: Id<'appointments'>; userId: Id<'users'>; confirm: boolean }) {
  const appt = await ctx.db.get(a.appointmentId)
  if (!appt || appt.bookedBy !== a.userId) return fail('not_found')
  if (appt.status !== 'booked') fail('cannot_cancel')

  let depositStatus = appt.depositStatus
  if (appt.depositStatus === 'held') {
    const clinic = (await ctx.db.get(appt.clinicId))!
    const early = slotInstant(appt.date, appt.time) - Date.now() >= clinic.cancelWindowMinutes * 60_000
    if (!early && !a.confirm) fail('needs_confirmation', { depositForfeited: true, amount: appt.depositNaira })
    depositStatus = await settleDeposit(ctx, appt, early ? 'returned' : 'forfeited')
  }
  await ctx.db.patch(appt._id, { status: 'cancelled', cancelledAt: Date.now(), cancelledBy: 'patient', depositStatus })
  return { clinicId: appt.clinicId, departmentId: appt.departmentId, depositStatus }
}

// School-clinic rule: a first no-show is a warning, the second blocks booking for 7 days.
export async function recordSchoolNoShow(ctx: MutationCtx, appt: Doc<'appointments'>) {
  const t = await ctx.db.query('noshowTracking').withIndex('by_user_clinic', (q) => q.eq('userId', appt.bookedBy).eq('clinicId', appt.clinicId)).first()
  const count = (t?.missCount ?? 0) + 1
  if (count < 2) {
    if (t) await ctx.db.patch(t._id, { missCount: count })
    else await ctx.db.insert('noshowTracking', { userId: appt.bookedBy, clinicId: appt.clinicId, missCount: 1 })
    return { missCount: count, blockedUntil: null }
  }
  const blockedUntil = Date.now() + 7 * 86_400_000
  await ctx.db.patch(t!._id, { missCount: 0, blockedUntil })
  return { missCount: 2, blockedUntil: new Date(blockedUntil).toISOString() }
}
