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

// 09:00 in Lagos (08:00 UTC) on a fixed day, so "today" and open slots are predictable.
const DAY = '2026-03-10'
const at = (hhmm: string) => new Date(`${DAY}T${hhmm}:00+01:00`)
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(at('09:00')) })
afterEach(() => vi.useRealTimers())

const code = async (p: Promise<unknown>) => {
  try { await p } catch (e) { if (e instanceof ConvexError) return (e.data as { code: string }).code; throw e }
  return 'no error'
}

async function setup(type: 'private' | 'school' = 'private') {
  const t = convexTest(schema, modules)
  await t.mutation(internal.setup.createAdmin, { name: 'Admin', email: 'admin@test.ng', password: 'admin-pass-1' })
  const admin = await t.mutation(api.auth.workLogin, { email: 'admin@test.ng', password: 'admin-pass-1' }) as { token: string }
  const h = await t.mutation(api.patient.registerHospital, {
    hospitalName: 'Test Hospital', type, state: 'Lagos', area: 'Yaba', address: '1 Test Road', email: 'desk@test.ng', password: 'desk-pass-1',
  })
  await t.mutation(api.hospital.approveClinic, { token: admin.token, id: h.clinic.id })
  const dept = (await t.mutation(api.hospital.addDepartment, {
    token: h.token, name: 'GOPD', consultationFee: 2000, opensAt: '08:00', closesAt: '16:00', slotMinutes: 15, avgVisitMinutes: 10,
  })).department
  const desk = h.token
  return { t, admin: admin.token, desk, clinicId: h.clinic.id, deptId: dept.id }
}

async function patient(t: ReturnType<typeof convexTest>, phone: string, topUp = 1000) {
  const r = await t.mutation(api.auth.register, { name: `Ada ${phone.slice(-2)}`, phone, pin: '1234', consent: true })
  if (topUp) await t.mutation(api.patient.koloTopUp, { token: r.token, amount: topUp })
  const self = (await t.query(api.patient.familyList, { token: r.token })).members[0]
  return { token: r.token, selfId: self.id }
}
const book = (t: ReturnType<typeof convexTest>, p: { token: string; selfId: string }, deptId: string, time: string) =>
  t.mutation(api.patient.book, { token: p.token, familyMemberId: p.selfId, departmentId: deptId, date: DAY, time })

describe('sign-in', () => {
  test('wrong PIN is refused, and 5 failures lock the account', async () => {
    const { t } = await setup()
    await patient(t, '08031111111', 0)
    for (let i = 0; i < 5; i++) expect(await t.mutation(api.auth.login, { phone: '08031111111', secret: '9999' })).toEqual({ error: 'bad_credentials' })
    const locked = await t.mutation(api.auth.login, { phone: '08031111111', secret: '1234' }) as { error: string }
    expect(locked.error).toBe('account_locked')
  })

  test('unknown number gives the same answer as a wrong PIN', async () => {
    const { t } = await setup()
    expect(await t.mutation(api.auth.login, { phone: '08039999999', secret: '1234' })).toEqual({ error: 'bad_credentials' })
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
    const wrong = await t.mutation(api.auth.resetPin, { phone: '08032222222', code: r.practiceCode === '111111' ? '222222' : '111111', pin: '5678' }) as { error: string; triesLeft: number }
    expect(wrong).toEqual({ error: 'bad_code', triesLeft: 4 })
    expect(await t.mutation(api.auth.resetPin, { phone: '08032222222', code: r.practiceCode!, pin: '5678' })).toEqual({ ok: true })
    expect(await t.mutation(api.auth.resetPin, { phone: '08032222222', code: r.practiceCode!, pin: '5678' })).toEqual({ error: 'code_expired' })
    expect(await t.mutation(api.auth.login, { phone: '08032222222', secret: '5678' })).toHaveProperty('token')
  })
})

describe('booking and Kolo', () => {
  test('booking holds ₦300; the same slot cannot be taken twice', async () => {
    const { t, deptId } = await setup()
    const a = await patient(t, '08033333333')
    const b = await patient(t, '08034444444')
    const r = await book(t, a, deptId, '10:00')
    expect(r.appointment.queueNumber).toBe(1)
    expect(await t.query(api.patient.kolo, { token: a.token })).toMatchObject({ available: 700, reserved: 300 })
    expect(await code(book(t, b, deptId, '10:00'))).toBe('slot_taken')
    expect(await code(book(t, a, deptId, '10:15'))).toBe('already_booked')
  })

  test('only today can be booked, and not a time that has passed', async () => {
    const { t, deptId } = await setup()
    const a = await patient(t, '08035555555')
    expect(await code(t.mutation(api.patient.book, { token: a.token, familyMemberId: a.selfId, departmentId: deptId, date: '2026-03-11', time: '10:00' }))).toBe('invalid_date')
    expect(await code(book(t, a, deptId, '08:30'))).toBe('slot_past')
  })

  test('not enough Kolo: the booking is refused and nothing is kept', async () => {
    const { t, deptId } = await setup()
    const a = await patient(t, '08036666666', 0)
    expect(await code(book(t, a, deptId, '10:00'))).toBe('kolo_low')
    expect((await t.query(api.patient.visits, { token: a.token })).appointments).toHaveLength(0)
  })

  test('early cancel returns the deposit; late cancel needs confirmation and forfeits it', async () => {
    const { t, deptId } = await setup()
    const a = await patient(t, '08037777777')
    const early = await book(t, a, deptId, '14:00')
    expect((await t.mutation(api.patient.cancelVisit, { token: a.token, id: early.appointment.id })).depositStatus).toBe('returned')
    const late = await book(t, a, deptId, '10:00')
    expect(await code(t.mutation(api.patient.cancelVisit, { token: a.token, id: late.appointment.id }))).toBe('needs_confirmation')
    expect((await t.mutation(api.patient.cancelVisit, { token: a.token, id: late.appointment.id, confirm: true })).depositStatus).toBe('forfeited')
    expect(await t.query(api.patient.kolo, { token: a.token })).toMatchObject({ available: 700, reserved: 0 })
  })
})

describe('front desk', () => {
  test('arrive, call next, seen: deposit goes to the fee', async () => {
    const { t, desk, deptId } = await setup()
    const a = await patient(t, '08038888888')
    const r = await book(t, a, deptId, '09:15')
    expect(await code(t.mutation(api.hospital.callNext, { token: desk, departmentId: deptId }))).toBe('nobody_waiting')
    await t.mutation(api.hospital.checkIn, { token: desk, id: r.appointment.id })
    expect((await t.mutation(api.hospital.callNext, { token: desk, departmentId: deptId })).queueNumber).toBe(1)
    expect((await t.mutation(api.hospital.seen, { token: desk, id: r.appointment.id })).depositStatus).toBe('deducted')
    expect(await t.query(api.patient.kolo, { token: a.token })).toMatchObject({ available: 700, reserved: 0 })
  })

  test('no-show only after the grace time; deposit goes to the hospital', async () => {
    const { t, desk, deptId } = await setup()
    const a = await patient(t, '08039000001')
    const r = await book(t, a, deptId, '09:15')
    await t.mutation(api.hospital.call, { token: desk, id: r.appointment.id })
    expect(await code(t.mutation(api.hospital.noShow, { token: desk, id: r.appointment.id }))).toBe('grace_not_ended')
    vi.setSystemTime(at('09:11'))
    expect((await t.mutation(api.hospital.noShow, { token: desk, id: r.appointment.id })).depositStatus).toBe('forfeited')
  })

  test('walk-ins get the next number; move to front changes the order', async () => {
    const { t, desk, deptId } = await setup()
    const w1 = (await t.mutation(api.hospital.walkIn, { token: desk, departmentId: deptId, name: 'Baba Musa' })).appointment
    const w2 = (await t.mutation(api.hospital.walkIn, { token: desk, departmentId: deptId, name: 'Chioma Eze' })).appointment
    expect([w1.queueNumber, w2.queueNumber]).toEqual([1, 2])
    await t.mutation(api.hospital.moveToFront, { token: desk, id: w2.id, reason: 'High fever' })
    expect((await t.mutation(api.hospital.callNext, { token: desk, departmentId: deptId })).firstName).toBe('Chioma')
    const screen = await t.query(api.hospital.nowServing, { clinicId: (await t.query(api.hospital.staffClinic, { token: desk })).clinic.id })
    expect(screen.departments[0].nowServing).toEqual({ queueNumber: 2, firstName: 'Chioma' })
  })

  test('cancel the rest of the day returns every deposit', async () => {
    const { t, desk, deptId } = await setup()
    const a = await patient(t, '08039000002')
    await book(t, a, deptId, '11:00')
    expect((await t.mutation(api.hospital.cancelDay, { token: desk, reason: 'Doctor called away' })).cancelled).toBe(1)
    expect(await t.query(api.patient.kolo, { token: a.token })).toMatchObject({ available: 1000, reserved: 0 })
  })

  test("a hospital cannot touch another hospital's patients", async () => {
    const { t, deptId } = await setup()
    const a = await patient(t, '08039000003')
    const r = await book(t, a, deptId, '11:00')
    const other = await t.mutation(api.patient.registerHospital, {
      hospitalName: 'Other Clinic', type: 'private', state: 'Lagos', area: 'Ikeja', address: '2 Road', email: 'other@test.ng', password: 'other-pass-1',
    })
    expect(await code(t.mutation(api.hospital.checkIn, { token: other.token, id: r.appointment.id }))).toBe('not_authorised_for_clinic')
  })

  test('live version number changes when the queue changes', async () => {
    const { t, desk, deptId, clinicId } = await setup()
    const before = await t.query(api.hospital.version, { clinicId })
    await t.mutation(api.hospital.walkIn, { token: desk, departmentId: deptId, name: 'Baba Musa' })
    expect(await t.query(api.hospital.version, { clinicId })).toBeGreaterThan(before)
  })
})

describe('school clinic rule', () => {
  test('no deposit; second no-show blocks booking for 7 days', async () => {
    const { t, desk, deptId } = await setup('school')
    const s = await patient(t, '08039000004', 0)
    const mk = async (name: string) => (await t.mutation(api.hospital.addDepartment, {
      token: desk, name, consultationFee: 0, opensAt: '08:00', closesAt: '16:00', slotMinutes: 15, avgVisitMinutes: 10,
    })).department.id
    const sickBay = await mk('Sick bay')
    const counselling = await mk('Counselling')
    for (const d of [deptId, sickBay]) {
      const r = await book(t, s, d, '09:30')
      expect(r.appointment.deposit.status).toBe('none')
      await t.mutation(api.hospital.call, { token: desk, id: r.appointment.id })
      vi.setSystemTime(new Date(Date.now() + 11 * 60_000))
      await t.mutation(api.hospital.noShow, { token: desk, id: r.appointment.id })
    }
    expect(await code(book(t, s, counselling, '11:00'))).toBe('booking_blocked')
  })
})

describe('accounts', () => {
  test('deleting an account cancels visits, refunds early ones and erases the name', async () => {
    const { t, desk, deptId } = await setup()
    const a = await patient(t, '08039000005')
    await book(t, a, deptId, '14:00')
    expect(await code(t.mutation(api.auth.deleteAccount, { token: a.token, secret: '0000' }))).toBe('wrong_secret')
    await t.mutation(api.auth.deleteAccount, { token: a.token, secret: '1234' })
    expect(await code(t.query(api.auth.me, { token: a.token }))).toBe('session_expired')
    const today = await t.query(api.hospital.staffToday, { token: desk })
    expect(today.appointments[0]).toMatchObject({ status: 'cancelled', firstName: 'Deleted' })
  })
})
