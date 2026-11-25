/// <reference types="vite/client" />
// End-to-end rules tests for the Convex backend (run: npm test).
import { convexTest } from 'convex-test'
import { ConvexError } from 'convex/values'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import schema from './schema'
import { api, internal } from './_generated/api'

const modules = import.meta.glob('./**/*.ts')
process.env.PIN_PEPPER = 'test-pepper-test-pepper-test-pepper-0123456789'
process.env.OMA_PRACTICE_CODES = 'on'

// Tuesday 10 March 2026, 09:00 in Lagos, so "today" and open times are predictable.
const DAY = '2026-03-10'
const at = (hhmm: string, day = DAY) => new Date(`${day}T${hhmm}:00+01:00`)
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(at('09:00')) })
afterEach(() => vi.useRealTimers())

const code = async (p: Promise<unknown>) => {
  try { await p } catch (e) { if (e instanceof ConvexError) return (e.data as { code: string }).code; throw e }
  return 'no error'
}
type T = ReturnType<typeof convexTest>
const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6]

async function setup(type: 'private' | 'school' | 'dental' = 'private', bookingDays = EVERY_DAY) {
  const t = convexTest(schema, modules)
  await t.mutation(internal.setup.createAdmin, { name: 'Admin', email: 'admin@test.ng', password: 'admin-pass-1' })
  const admin = await t.mutation(api.auth.workLogin, { email: 'admin@test.ng', password: 'admin-pass-1' }) as { token: string }
  const h = await t.mutation(api.patient.registerHospital, {
    hospitalName: 'Test Hospital', type, state: 'Lagos', area: 'Yaba', address: '1 Test Road', email: 'desk@test.ng', password: 'desk-pass-1',
  })
  await t.mutation(api.hospital.approveClinic, { token: admin.token, id: h.clinic.id })
  const desk = h.token
  const deptId = (await t.mutation(api.hospital.addDepartment, { token: desk, name: 'Dental', bookingDays, opensAt: '08:00', closesAt: '16:00' })).department.id
  await t.mutation(api.hospital.addService, { token: desk, departmentId: deptId, name: 'Cleaning', minutes: 30, price: 5000 })
  await t.mutation(api.hospital.addService, { token: desk, departmentId: deptId, name: 'Check-up', minutes: 30, price: 0 })
  const services = (await t.query(api.hospital.managerClinic, { token: desk })).departments[0].services
  const svc = (name: string) => services.find((s) => s.name === name)!.id
  return { t, admin: admin.token, desk, clinicId: h.clinic.id, deptId, cleaning: svc('Cleaning'), checkup: svc('Check-up') }
}

async function patient(t: T, phone: string, topUp = 1000) {
  const r = await t.mutation(api.auth.register, { name: `Ada ${phone.slice(-2)}`, phone, pin: '1234', consent: true })
  if (topUp) await t.mutation(api.patient.koloTopUp, { token: r.token, amount: topUp })
  const self = (await t.query(api.patient.familyList, { token: r.token })).members[0]
  return { token: r.token, selfId: self.id }
}
const book = (t: T, p: { token: string; selfId: string }, serviceId: string, time: string, date = DAY) =>
  t.mutation(api.patient.book, { token: p.token, familyMemberId: p.selfId, serviceId, date, time })

describe('sign-in', () => {
  test('wrong PIN is refused, and 5 failures lock the account', async () => {
    const { t } = await setup()
    await patient(t, '08031111111', 0)
    for (let i = 0; i < 5; i++) expect(await t.mutation(api.auth.login, { phone: '08031111111', secret: '9999' })).toEqual({ error: 'bad_credentials' })
    const locked = await t.mutation(api.auth.login, { phone: '08031111111', secret: '1234' }) as { error: string }
    expect(locked.error).toBe('account_locked')
  })

  test('a disabled staff member loses access at once', async () => {
    const { t, desk } = await setup()
    const s = await t.mutation(api.hospital.addStaff, { token: desk, name: 'Nurse Joy', email: 'joy@test.ng', password: 'joy-pass-12' })
    const joy = await t.mutation(api.auth.workLogin, { email: 'joy@test.ng', password: 'joy-pass-12' }) as { token: string }
    await t.query(api.hospital.staffToday, { token: joy.token })
    await t.mutation(api.hospital.setStaffActive, { token: desk, id: s.staff.id, active: false })
    expect(await code(t.query(api.hospital.staffToday, { token: joy.token }))).toMatch(/session_expired|account_disabled/)
  })

  test('forgot PIN: code works once, wrong codes count down', async () => {
    const { t } = await setup()
    await patient(t, '08032222222', 0)
    const r = await t.mutation(api.auth.forgotPin, { phone: '08032222222' })
    const wrong = await t.mutation(api.auth.resetPin, { phone: '08032222222', code: r.practiceCode === '111111' ? '222222' : '111111', pin: '5678' })
    expect(wrong).toEqual({ error: 'bad_code', triesLeft: 4 })
    expect(await t.mutation(api.auth.resetPin, { phone: '08032222222', code: r.practiceCode!, pin: '5678' })).toEqual({ ok: true })
    expect(await t.mutation(api.auth.resetPin, { phone: '08032222222', code: r.practiceCode!, pin: '5678' })).toEqual({ error: 'code_expired' })
  })
})

describe('services and booking days', () => {
  test('hospitals show only departments with services; a dental clinic can register', async () => {
    const { t, clinicId } = await setup('dental')
    const c = (await t.query(api.patient.clinic, { id: clinicId })).clinic
    expect(c.type).toBe('dental')
    expect(c.departments[0].services.map((s) => s.name)).toEqual(['Check-up', 'Cleaning'])
  })

  test('a service fills its full length: overlapping times are not offered', async () => {
    const { t, cleaning, desk, deptId } = await setup()
    const a = await patient(t, '08033333333')
    await book(t, a, cleaning, '10:00')
    const day = (await t.query(api.patient.availability, { serviceId: cleaning })).days.find((d) => d.date === DAY)!
    expect(day.times).not.toContain('10:00')
    expect(day.times).toContain('10:30')
    expect(day.times.every((x) => x.endsWith(':00') || x.endsWith(':30'))).toBe(true) // 30-minute steps
    const b = await patient(t, '08034444444')
    expect(await code(book(t, b, cleaning, '10:15'))).toBe('slot_taken')
    // A 60-minute service holds the whole hour: after braces at 12:00, 12:30 is not free.
    await t.mutation(api.hospital.addService, { token: desk, departmentId: deptId, name: 'Braces', minutes: 60, price: null })
    const braces = (await t.query(api.hospital.managerClinic, { token: desk })).departments[0].services.find((x) => x.name === 'Braces')!.id
    await book(t, b, braces, '12:00')
    const after = (await t.query(api.patient.availability, { serviceId: cleaning })).days.find((d) => d.date === DAY)!.times
    expect(after).not.toContain('12:00')
    expect(after).not.toContain('12:30')
    expect(after).toContain('13:00')
    // A 75-minute booking from 14:00 ends at 15:15: that exact time is offered next.
    await t.mutation(api.hospital.addService, { token: desk, departmentId: deptId, name: 'Long braces', minutes: 75, price: null })
    const long = (await t.query(api.hospital.managerClinic, { token: desk })).departments[0].services.find((x) => x.name === 'Long braces')!.id
    const c = await patient(t, '08034444445')
    await book(t, c, long, '14:00')
    const later = (await t.query(api.patient.availability, { serviceId: cleaning })).days.find((d) => d.date === DAY)!.times
    expect(later).not.toContain('15:00')
    expect(later).toContain('15:15')
  })

  test('book up to 2 days ahead, and only on booking days', async () => {
    const { t, cleaning } = await setup('private', [2, 4]) // Tuesday and Thursday
    const a = await patient(t, '08035555555', 2000)
    const days = (await t.query(api.patient.availability, { serviceId: cleaning })).days.map((d) => d.date)
    expect(days).toEqual(['2026-03-10', '2026-03-12']) // Tue (today) and Thu; Wed is not a booking day
    expect((await book(t, a, cleaning, '11:00', '2026-03-12')).appointment.date).toBe('2026-03-12')
    expect(await code(book(t, a, cleaning, '11:00', '2026-03-11'))).toBe('invalid_date') // Wednesday
    expect(await code(book(t, a, cleaning, '11:00', '2026-03-17'))).toBe('invalid_date') // too far ahead
  })

  test('booking holds ₦300; not enough Kolo keeps nothing', async () => {
    const { t, cleaning } = await setup()
    const a = await patient(t, '08036666666')
    await book(t, a, cleaning, '10:00')
    expect(await t.query(api.patient.kolo, { token: a.token })).toMatchObject({ available: 700, reserved: 300 })
    const broke = await patient(t, '08036666667', 0)
    expect(await code(book(t, broke, cleaning, '11:00'))).toBe('kolo_low')
    expect((await t.query(api.patient.visits, { token: broke.token })).appointments).toHaveLength(0)
  })

  test('early cancel returns the deposit; late cancel needs confirmation and forfeits it', async () => {
    const { t, cleaning } = await setup()
    const a = await patient(t, '08037777777')
    const early = await book(t, a, cleaning, '14:00')
    expect((await t.mutation(api.patient.cancelVisit, { token: a.token, id: early.appointment.id })).depositStatus).toBe('returned')
    const late = await book(t, a, cleaning, '10:00')
    expect(await code(t.mutation(api.patient.cancelVisit, { token: a.token, id: late.appointment.id }))).toBe('needs_confirmation')
    expect((await t.mutation(api.patient.cancelVisit, { token: a.token, id: late.appointment.id, confirm: true })).depositStatus).toBe('forfeited')
  })
})

describe('honest wait times', () => {
  test('if the doctor runs late, the next patient is told', async () => {
    const { t, desk, cleaning } = await setup()
    const a = await patient(t, '08038000001')
    const b = await patient(t, '08038000002')
    const first = await book(t, a, cleaning, '09:30')
    const second = await book(t, b, cleaning, '10:30')
    await t.mutation(api.hospital.checkIn, { token: desk, id: first.appointment.id })
    vi.setSystemTime(at('10:15'))
    await t.mutation(api.hospital.call, { token: desk, id: first.appointment.id }) // started 45 min late
    const q = (await t.query(api.patient.visit, { token: b.token, id: second.appointment.id })).appointment.queue!
    expect(q.estimatedFrom).toBe('10:45') // 10:15 + 30 min cleaning
    expect(q.delayMinutes).toBe(15)
  })
})

describe('wait estimate ignores no-shows in waiting', () => {
  test('someone 10+ min late who never arrived does not push others back', async () => {
    const { t, cleaning } = await setup()
    const a = await patient(t, '08038000011')
    const b = await patient(t, '08038000012')
    await book(t, a, cleaning, '09:30') // never arrives
    const second = await book(t, b, cleaning, '10:00')
    vi.setSystemTime(at('09:50'))
    const q = (await t.query(api.patient.visit, { token: b.token, id: second.appointment.id })).appointment.queue!
    expect(q.ahead).toBe(0)
    expect(q.estimatedFrom).toBe('10:00')
    expect(q.delayMinutes).toBe(0)
  })
})

describe('front desk', () => {
  test('arrive, call next, seen: deposit goes to the fee; free service returns it', async () => {
    const { t, desk, deptId, cleaning, checkup } = await setup()
    const a = await patient(t, '08038888888')
    const r = await book(t, a, cleaning, '09:30')
    expect(await code(t.mutation(api.hospital.callNext, { token: desk, departmentId: deptId }))).toBe('nobody_waiting')
    await t.mutation(api.hospital.checkIn, { token: desk, id: r.appointment.id })
    expect((await t.mutation(api.hospital.callNext, { token: desk, departmentId: deptId })).queueNumber).toBe(1)
    expect((await t.mutation(api.hospital.seen, { token: desk, id: r.appointment.id })).depositStatus).toBe('deducted')
    const b = await patient(t, '08038888889')
    const free = await book(t, b, checkup, '10:00')
    await t.mutation(api.hospital.call, { token: desk, id: free.appointment.id })
    expect((await t.mutation(api.hospital.seen, { token: desk, id: free.appointment.id })).depositStatus).toBe('returned')
  })

  test('no-show only after the grace time', async () => {
    const { t, desk, cleaning } = await setup()
    const a = await patient(t, '08039000001')
    const r = await book(t, a, cleaning, '09:30')
    await t.mutation(api.hospital.call, { token: desk, id: r.appointment.id })
    expect(await code(t.mutation(api.hospital.noShow, { token: desk, id: r.appointment.id }))).toBe('grace_not_ended')
    vi.setSystemTime(at('09:11'))
    expect((await t.mutation(api.hospital.noShow, { token: desk, id: r.appointment.id })).depositStatus).toBe('forfeited')
  })

  test("walk-ins are logged for the day but never enter the booking line", async () => {
    const { t, desk, deptId, cleaning, clinicId } = await setup()
    const a = await patient(t, '08039000006')
    const r = await book(t, a, cleaning, '09:30')
    const w = (await t.mutation(api.hospital.addWalkIn, { token: desk, departmentId: deptId, name: 'Baba Musa' })).walkIn
    expect(w.number).toBe(1)
    await t.mutation(api.hospital.setWalkInStatus, { token: desk, id: w.id, status: 'seen' })
    const today = await t.query(api.hospital.staffToday, { token: desk })
    expect(today.walkIns).toHaveLength(1)
    expect(today.appointments).toHaveLength(1)
    expect((await t.query(api.patient.visit, { token: a.token, id: r.appointment.id })).appointment.queue!.ahead).toBe(0)
    expect((await t.query(api.hospital.staffStats, { token: desk })).totals).toMatchObject({ walkIns: 1, walkInsSeen: 1, booked: 1 })
    const screen = await t.query(api.hospital.nowServing, { clinicId })
    expect(screen.departments[0].next).toEqual([]) // walk-ins are not on the TV line
  })

  test('move to front changes the order of the booking line', async () => {
    const { t, desk, deptId, cleaning } = await setup()
    const a = await patient(t, '08039000002')
    const b = await patient(t, '08039000003')
    const r1 = await book(t, a, cleaning, '09:30')
    const r2 = await book(t, b, cleaning, '10:30')
    await t.mutation(api.hospital.checkIn, { token: desk, id: r1.appointment.id })
    await t.mutation(api.hospital.checkIn, { token: desk, id: r2.appointment.id })
    await t.mutation(api.hospital.moveToFront, { token: desk, id: r2.appointment.id, reason: 'High fever' })
    expect((await t.mutation(api.hospital.callNext, { token: desk, departmentId: deptId })).queueNumber).toBe(2)
  })

  test('cancel a day returns every deposit', async () => {
    const { t, desk, cleaning } = await setup()
    const a = await patient(t, '08039000004')
    await book(t, a, cleaning, '11:00', '2026-03-11')
    expect((await t.mutation(api.hospital.cancelDay, { token: desk, date: '2026-03-11', reason: 'Doctor away' })).cancelled).toBe(1)
    expect(await t.query(api.patient.kolo, { token: a.token })).toMatchObject({ available: 1000, reserved: 0 })
  })

  test("a hospital cannot touch another hospital's patients", async () => {
    const { t, cleaning } = await setup()
    const a = await patient(t, '08039000005')
    const r = await book(t, a, cleaning, '11:00')
    const other = await t.mutation(api.patient.registerHospital, {
      hospitalName: 'Other Clinic', type: 'eye', state: 'Lagos', area: 'Ikeja', address: '2 Road', email: 'other@test.ng', password: 'other-pass-1',
    })
    expect(await code(t.mutation(api.hospital.checkIn, { token: other.token, id: r.appointment.id }))).toBe('not_authorised_for_clinic')
  })
})

describe('school clinic rule', () => {
  test('no deposit; second no-show blocks booking for 7 days', async () => {
    const { t, desk, cleaning, checkup } = await setup('school')
    const s = await patient(t, '08039000009', 0)
    for (const day of [DAY, '2026-03-11']) {
      vi.setSystemTime(at('09:00', day))
      const r = await book(t, s, cleaning, '09:30', day)
      expect(r.appointment.deposit.status).toBe('none')
      await t.mutation(api.hospital.call, { token: desk, id: r.appointment.id })
      vi.setSystemTime(at('09:11', day))
      await t.mutation(api.hospital.noShow, { token: desk, id: r.appointment.id })
    }
    expect(await code(book(t, s, checkup, '13:00', '2026-03-12'))).toBe('booking_blocked')
  })
})
