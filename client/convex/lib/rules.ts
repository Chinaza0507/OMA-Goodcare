// Kolo money movements, booking, cancelling, queue order and the school no-show rule.
// Each Convex mutation is one transaction, so balances, history rows and bookings
// always change together or not at all.
import type { MutationCtx, QueryCtx } from '../_generated/server'
import type { Doc, Id } from '../_generated/dataModel'
import {
  fail, generateSlots, nowMinutesLagos, slotInstant, toMinutes, todayLagos, fromMinutes,
} from './core'

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
  if (appt.depositStatus !== 'held' || !appt.bookedBy) return appt.depositStatus
  const amt = appt.depositNaira
  if (outcome === 'returned') await apply(ctx, appt.bookedBy, 'refund', amt, appt._id, amt, -amt)
  else if (outcome === 'deducted') await apply(ctx, appt.bookedBy, 'deduct', amt, appt._id, 0, -amt)
  else await apply(ctx, appt.bookedBy, 'forfeit', amt, appt._id, 0, -amt)
  return outcome
}

// ---------- queue ----------
export const ACTIVE = ['booked', 'checked_in', 'called'] as const
export const isActive = (s: string) => (ACTIVE as readonly string[]).includes(s)

// Queue order within a department and day: front-of-queue moves first, then the
// slot time, then queue number. This is the ONE definition of "who is ahead".
export const queueCompare = (a: Doc<'appointments'>, b: Doc<'appointments'>) =>
  a.frontRank - b.frontRank || toMinutes(a.time) - toMinutes(b.time) || a.queueNumber - b.queueNumber

export const dayAppointments = (ctx: QueryCtx, departmentId: Id<'departments'>, date: string) =>
  ctx.db.query('appointments').withIndex('by_dept_date', (q) => q.eq('departmentId', departmentId).eq('date', date)).collect()

export async function nextQueueNumber(ctx: QueryCtx, departmentId: Id<'departments'>, date: string) {
  const all = await dayAppointments(ctx, departmentId, date)
  return all.reduce((m, a) => Math.max(m, a.queueNumber), 0) + 1
}

// Lowest rank in this department/day, minus one: puts someone at the very front.
export async function frontOfQueueRank(ctx: QueryCtx, appt: Doc<'appointments'>) {
  const all = await dayAppointments(ctx, appt.departmentId, appt.date)
  return all.reduce((m, a) => Math.min(m, a.frontRank), 0) - 1
}

// Average consultation length today: the last 10 patients seen, or the department's set
// average until 10 have been seen.
function averageVisit(all: Doc<'appointments'>[], fallback: number) {
  const seen = all
    .filter((a) => a.status === 'seen' && a.finishedAt && a.calledAt)
    .sort((a, b) => b.finishedAt! - a.finishedAt!)
    .slice(0, 10)
  if (seen.length < 10) return fallback
  const avg = seen.reduce((s, a) => s + (a.finishedAt! - a.calledAt!) / 60_000, 0) / seen.length
  return avg > 0 ? avg : fallback
}

// Live position for one appointment: people ahead and the estimated wait.
export async function queueInfo(ctx: QueryCtx, appt: Doc<'appointments'>, avgVisitMinutes: number) {
  if (!isActive(appt.status) || appt.date !== todayLagos()) return null
  const all = await dayAppointments(ctx, appt.departmentId, appt.date)
  const ahead = all.filter((o) => o._id !== appt._id && isActive(o.status) && queueCompare(o, appt) < 0).length
  const avg = averageVisit(all, avgVisitMinutes)
  const waitMinutes = Math.round(ahead * avg)
  const start = Math.max(nowMinutesLagos() + waitMinutes, toMinutes(appt.time))
  return {
    ahead,
    waitMinutes,
    averageVisitMinutes: Math.round(avg),
    estimatedFrom: fromMinutes(start % 1440),
    estimatedTo: fromMinutes((start + Math.round(avg)) % 1440),
    alertNow: ahead <= appt.alertAhead,
  }
}

// A slot is taken by any appointment that is not cancelled.
export const takenTimes = (all: Doc<'appointments'>[]) => new Set(all.filter((a) => a.status !== 'cancelled').map((a) => a.time))

// ---------- booking ----------
// Same-day booking only: patients book a time for today, the day they are going.
export async function loadBookableDepartment(ctx: QueryCtx, departmentId: Id<'departments'>) {
  const dept = await ctx.db.get(departmentId)
  const clinic = dept && (await ctx.db.get(dept.clinicId))
  if (!dept || !dept.active || !clinic || !clinic.active || clinic.status !== 'approved') return fail('not_found')
  return { dept, clinic }
}

export async function bookAppointment(
  ctx: MutationCtx,
  a: { user: Doc<'users'>; familyMemberId: Id<'familyMembers'>; departmentId: Id<'departments'>; date: string; time: string; alertAhead?: number },
) {
  const today = todayLagos()
  if (a.date !== today) fail('invalid_date')
  const member = await ctx.db.get(a.familyMemberId)
  if (!member || member.ownerId !== a.user._id) fail('not_found')
  const { dept, clinic } = await loadBookableDepartment(ctx, a.departmentId)

  if (!generateSlots(dept.opensAt, dept.closesAt, dept.slotMinutes).includes(a.time)) fail('invalid_slot')
  if (toMinutes(a.time) < nowMinutesLagos()) fail('slot_past')

  // School clinics: students who missed two bookings cannot book for 7 days (walk-ins still allowed).
  if (clinic.billingType === 'covered') {
    const t = await ctx.db.query('noshowTracking').withIndex('by_user_clinic', (q) => q.eq('userId', a.user._id).eq('clinicId', clinic._id)).first()
    if (t?.blockedUntil && t.blockedUntil > Date.now()) fail('booking_blocked', { until: new Date(t.blockedUntil).toISOString() })
  }

  const all = await dayAppointments(ctx, dept._id, a.date)
  if (all.some((x) => x.status !== 'cancelled' && x.familyMemberId === member!._id)) fail('already_booked')
  if (takenTimes(all).has(a.time)) fail('slot_taken')

  const deposit = clinic.billingType === 'paid' ? clinic.depositNaira : 0
  const id = await ctx.db.insert('appointments', {
    clinicId: clinic._id,
    departmentId: dept._id,
    familyMemberId: member!._id,
    bookedBy: a.user._id,
    patientName: member!.name,
    type: 'booked',
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
  if (!appt.bookedBy) return null
  const t = await ctx.db.query('noshowTracking').withIndex('by_user_clinic', (q) => q.eq('userId', appt.bookedBy!).eq('clinicId', appt.clinicId)).first()
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
