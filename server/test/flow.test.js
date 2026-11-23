// End-to-end test of the whole backend against a THROWAWAY database.
//   TEST_DATABASE_URL=postgresql://...localhost.../testdb npm test
// It drops and recreates every Oma table, so it refuses to run unless the database is local
// or its name contains "test".
import { test, before, after, describe } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { readFile } from 'node:fs/promises'

const url = process.env.TEST_DATABASE_URL
if (!url) throw new Error('Set TEST_DATABASE_URL to a throwaway database (see top of this file).')
const parsed = new URL(url)
const safe = ['localhost', '127.0.0.1'].includes(parsed.hostname) || /test/i.test(parsed.pathname)
if (!safe) throw new Error('TEST_DATABASE_URL must be a local database or have "test" in its name.')

Object.assign(process.env, {
  DATABASE_URL: url,
  JWT_SECRET: 'test-jwt-secret-test-jwt-secret-1234567890',
  PIN_PEPPER: 'test-pepper-test-pepper-test-pepper-1234567890',
  AUTH_RATE_LIMIT: '1000',
  NODE_ENV: 'test',
})

const { default: app } = await import('../src/app.js')
const { pool } = await import('../src/db.js')
const { hashSecret } = await import('../src/lib/secret.js')
const { todayLagos, addDays } = await import('../src/lib/time.js')

let server
let base
const S = {} // shared state across the ordered tests

async function api(method, path, body, token) {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : null }
}
const expectOk = (r, status = 200) => assert.equal(r.status, status, JSON.stringify(r.body))
const expectErr = (r, status, code) => {
  assert.equal(r.status, status, JSON.stringify(r.body))
  assert.equal(r.body.error, code)
}

const today = todayLagos()
const tomorrow = addDays(today, 1)
const hospital = (over = {}) => ({
  hospitalName: 'Test General Hospital', type: 'private', state: 'Lagos', area: 'Yaba',
  address: '1 Test Road', landmark: 'Opposite the market', email: 'frontdesk@testgeneral.example.com', password: 'managerpass1', ...over,
})
const register = (name, phone, pin = '1234') => api('POST', '/api/auth/register', { name, phone, pin, consent: true })
const freeSlots = async (deptId, date = today) =>
  (await api('GET', `/api/clinics/departments/${deptId}/slots?date=${date}`)).body.slots.filter((s) => s.available).map((s) => s.time)

before(async () => {
  await pool.query(`
    DROP TABLE IF EXISTS action_log, noshow_tracking, kolo_transactions, appointments,
      kolo_wallets, family_members, users, departments, clinics CASCADE;
    DROP FUNCTION IF EXISTS forbid_change() CASCADE;`)
  await pool.query(await readFile(new URL('../db/schema.sql', import.meta.url), 'utf8'))
  server = http.createServer(app)
  await new Promise((r) => server.listen(0, r))
  base = `http://127.0.0.1:${server.address().port}`
})
after(async () => {
  server?.close()
  await pool.end()
})

describe('Oma backend', () => {
  test('health check', async () => {
    const r = await api('GET', '/api/health')
    assert.equal(r.body.database, 'connected')
  })

  test('hospital signs up and stays hidden until an admin approves', async () => {
    expectErr(await api('POST', '/api/hospitals/register', hospital({ type: 'clinic' })), 400, 'invalid_input')
    expectErr(await api('POST', '/api/hospitals/register', hospital({ email: 'not-an-email' })), 400, 'invalid_input')
    expectErr(await api('POST', '/api/hospitals/register', hospital({ password: 'short' })), 400, 'invalid_input')

    const r = await api('POST', '/api/hospitals/register', hospital({ latitude: 6.5158, longitude: 3.3711 }))
    expectOk(r, 201)
    assert.equal(r.body.clinic.status, 'pending')
    assert.equal(r.body.user.role, 'manager')
    S.clinicA = r.body.clinic.id
    S.managerA = r.body.user && r.body.token

    expectErr(await api('POST', '/api/hospitals/register', hospital({ email: 'FrontDesk@TestGeneral.example.com' })), 409, 'email_taken')

    // The hospital signs in with its official email; the patient sign-in does not accept it.
    const signIn = await api('POST', '/api/auth/work-login', { email: 'frontdesk@testgeneral.example.com', password: 'managerpass1' })
    expectOk(signIn)
    assert.equal(signIn.body.clinic.status, 'pending')
    expectErr(await api('POST', '/api/auth/work-login', { email: 'frontdesk@testgeneral.example.com', password: 'wrongpass1' }), 401, 'bad_credentials')
    assert.deepEqual((await api('GET', '/api/clinics')).body.clinics, []) // hidden while pending
    expectErr(await api('GET', `/api/clinics/${S.clinicA}`), 404, 'not_found')
  })

  test('only an Oma admin can approve, and the type sets the billing rule', async () => {
    await pool.query(
      `INSERT INTO users (role, name, email, secret_hash, consent_at) VALUES ('admin', 'Oma Admin', 'admin@oma.example.com', $1, now())`,
      [await hashSecret('adminpass123')],
    )
    const login = await api('POST', '/api/auth/work-login', { email: 'admin@oma.example.com', password: 'adminpass123' })
    expectOk(login)
    S.admin = login.body.token

    expectErr(await api('POST', `/api/admin/clinics/${S.clinicA}/approve`, {}, S.managerA), 403, 'forbidden')
    expectOk(await api('POST', `/api/admin/clinics/${S.clinicA}/approve`, {}, S.admin))
    const clinic = await api('GET', `/api/clinics/${S.clinicA}`)
    expectOk(clinic)
    assert.equal(clinic.body.clinic.billingType, 'paid')
    assert.equal(clinic.body.clinic.depositNaira, 300)
  })

  test('manager sets up departments and staff; a manager cannot change the clinic type', async () => {
    const dept = (over) => ({ name: 'GOPD', consultationFee: 5000, opensAt: '00:00', closesAt: '23:50', slotMinutes: 10, avgVisitMinutes: 10, ...over })
    expectErr(await api('POST', '/api/manager/departments', dept({ opensAt: '10:00', closesAt: '09:00' }), S.managerA), 400, 'invalid_input')
    const a = await api('POST', '/api/manager/departments', dept(), S.managerA)
    expectOk(a, 201)
    S.deptA = a.body.department.id
    expectErr(await api('POST', '/api/manager/departments', dept(), S.managerA), 409, 'department_exists')
    const free = await api('POST', '/api/manager/departments', dept({ name: 'Free clinic', consultationFee: 0 }), S.managerA)
    S.deptFree = free.body.department.id

    // 'type' is not an accepted manager field, so it is ignored and the type stays as registered.
    await api('PATCH', '/api/manager/clinic', { type: 'school', graceMinutes: 10 }, S.managerA)
    assert.equal((await api('GET', '/api/manager/clinic', undefined, S.managerA)).body.clinic.type, 'private')

    const staff = await api('POST', '/api/manager/staff', { name: 'Nurse Joy', email: 'joy@testgeneral.example.com', password: 'staffpass12' }, S.managerA)
    expectOk(staff, 201)
    S.staffId = staff.body.staff.id
    const login = await api('POST', '/api/auth/work-login', { email: 'joy@testgeneral.example.com', password: 'staffpass12' })
    expectOk(login)
    S.staffA = login.body.token
  })

  test('patient sign-up needs name, valid phone, 4-digit PIN and consent', async () => {
    expectErr(await register('Ada Obi', '12345'), 400, 'invalid_phone')
    expectErr(await register('Ada Obi', '08031110010', '12'), 400, 'invalid_input')
    expectErr(await api('POST', '/api/auth/register', { name: 'Ada Obi', phone: '08031110010', pin: '1234' }), 400, 'invalid_input')

    const r = await register('Ada Okafor', '0803 111 0010')
    expectOk(r, 201)
    S.ada = r.body.token
    assert.equal(r.body.user.phone, '+2348031110010')
    expectErr(await register('Ada Again', '+234 803 111 0010'), 409, 'phone_taken')

    const b = await register('Bola Adeyemi', '08031110011')
    S.bola = b.body.token
  })

  test('PIN login locks the account after 5 wrong tries', async () => {
    await register('Chidi Eze', '08031110012', '4321')
    for (let i = 0; i < 5; i++) {
      expectErr(await api('POST', '/api/auth/login', { phone: '08031110012', secret: '0000' }), 401, 'bad_credentials')
    }
    expectErr(await api('POST', '/api/auth/login', { phone: '08031110012', secret: '4321' }), 429, 'account_locked')
    expectErr(await api('POST', '/api/auth/login', { phone: '08039999999', secret: '0000' }), 401, 'bad_credentials')
  })

  test('language and alert preference are saved', async () => {
    const r = await api('PATCH', '/api/auth/me', { language: 'pcm', alertAhead: 5 }, S.ada)
    expectOk(r)
    assert.equal(r.body.user.language, 'pcm')
    assert.equal(r.body.user.alertAhead, 5)
    expectErr(await api('PATCH', '/api/auth/me', { language: 'fr' }, S.ada), 400, 'invalid_input')
  })

  test('family members: add, list, cannot remove yourself', async () => {
    const list = (await api('GET', '/api/family', undefined, S.ada)).body.members
    assert.equal(list.length, 1)
    assert.equal(list[0].isSelf, true)
    S.adaSelf = list[0].id
    const child = await api('POST', '/api/family', { name: 'Kemi Okafor', age: 6 }, S.ada)
    expectOk(child, 201)
    S.adaChild = child.body.member.id
    expectErr(await api('DELETE', `/api/family/${S.adaSelf}`, undefined, S.ada), 409, 'cannot_remove_self')
    S.bolaSelf = (await api('GET', '/api/family', undefined, S.bola)).body.members[0].id
  })

  test('hospital list: area filter and nearest-first', async () => {
    const all = await api('GET', '/api/clinics?area=yaba')
    assert.equal(all.body.clinics.length, 1)
    assert.equal((await api('GET', '/api/clinics?area=Nowhere')).body.clinics.length, 0)
    assert.equal((await api('GET', '/api/clinics?maxFee=100')).body.clinics.length, 1) // the free department qualifies
    const near = await api('GET', '/api/clinics?lat=6.52&lng=3.37')
    assert.equal(typeof near.body.clinics[0].distanceKm, 'number')
  })

  test('Kolo: top-up rules and balances', async () => {
    expectErr(await api('POST', '/api/kolo/topup', { amount: 50 }, S.ada), 400, 'invalid_input')
    expectOk(await api('POST', '/api/kolo/topup', { amount: 1000 }, S.ada), 201)
    const k = await api('GET', '/api/kolo', undefined, S.ada)
    assert.deepEqual([k.body.available, k.body.reserved], [1000, 0])
  })

  test('booking: low balance fails cleanly, then a booking holds the 300 naira deposit', async () => {
    S.slots = await freeSlots(S.deptA)
    assert.ok(S.slots.length >= 6, 'need free slots today (run the test earlier than 23:30 Lagos time)')
    const [s0] = S.slots
    const body = (member, time, date = today) => ({ familyMemberId: member, departmentId: S.deptA, date, time })

    const low = await api('POST', '/api/appointments', body(S.bolaSelf, s0), S.bola)
    expectErr(low, 402, 'kolo_low')
    assert.ok((await freeSlots(S.deptA)).includes(s0), 'a failed booking must not keep the slot')

    const ok = await api('POST', '/api/appointments', body(S.adaSelf, s0), S.ada)
    expectOk(ok, 201)
    S.apptAda = ok.body.appointment
    assert.equal(S.apptAda.queueNumber, 1)
    assert.deepEqual(S.apptAda.deposit, { amount: 300, status: 'held' })
    const k = await api('GET', '/api/kolo', undefined, S.ada)
    assert.deepEqual([k.body.available, k.body.reserved], [700, 300])

    expectErr(await api('POST', '/api/appointments', body(S.adaSelf, S.slots[1]), S.ada), 409, 'already_booked')
    await api('POST', '/api/kolo/topup', { amount: 1000 }, S.bola)
    expectErr(await api('POST', '/api/appointments', body(S.bolaSelf, s0), S.bola), 409, 'slot_taken')
    expectErr(await api('POST', '/api/appointments', body(S.bolaSelf, s0, addDays(today, 30)), S.bola), 400, 'invalid_date')
    expectErr(await api('POST', '/api/appointments', body(S.bolaSelf, '03:07'), S.bola), 400, 'invalid_slot')
  })

  test('walk-ins share the same schedule: no double booking across channels', async () => {
    // Explicit later time so the booked patient is reliably first in line.
    const walk = await api('POST', '/api/staff/walk-ins', { departmentId: S.deptA, name: 'Baba Musa', time: S.slots[2] }, S.staffA)
    expectOk(walk, 201)
    S.walkMusa = walk.body.appointment
    assert.equal(S.walkMusa.queueNumber, 2) // matches numbered card 2
    assert.equal(S.walkMusa.type, 'walk_in')
    expectErr(await api('POST', '/api/staff/walk-ins', { departmentId: S.deptA, name: 'Another', time: S.apptAda.time }, S.staffA), 409, 'slot_taken')
    expectErr(await api('POST', '/api/staff/walk-ins', { departmentId: S.deptA, name: 'Another', time: S.slots[2] }, S.staffA), 409, 'slot_taken')
    // ...and the walk-in's time disappears from online booking.
    assert.ok(!(await freeSlots(S.deptA)).includes(S.walkMusa.time))
  })

  test('patient sees place in queue: people ahead and estimated wait', async () => {
    const r = await api('GET', `/api/appointments/${S.apptAda.id}`, undefined, S.ada)
    assert.equal(r.body.appointment.queue.ahead, 0)
    const other = await api('GET', '/api/appointments?scope=upcoming', undefined, S.bola)
    assert.equal(other.body.appointments.length, 0) // patients never see each other's visits
    expectErr(await api('GET', `/api/appointments/${S.apptAda.id}`, undefined, S.bola), 404, 'not_found')
  })

  test('role separation', async () => {
    expectErr(await api('GET', '/api/staff/today', undefined, S.ada), 403, 'forbidden')
    expectErr(await api('GET', '/api/appointments', undefined, S.staffA), 403, 'forbidden')
    expectErr(await api('GET', '/api/staff/today'), 401, 'auth_required')
    expectErr(await api('GET', '/api/staff/today', undefined, 'garbage'), 401, 'session_expired')
  })

  test('front desk runs the queue: check in, call next, seen deducts the deposit', async () => {
    const today_ = await api('GET', '/api/staff/today', undefined, S.staffA)
    assert.equal(today_.body.appointments.length, 2)
    assert.equal(today_.body.appointments[0].firstName, 'Ada')

    expectErr(await api('POST', `/api/staff/appointments/${S.apptAda.id}/seen`, {}, S.staffA), 409, 'invalid_status')
    expectOk(await api('POST', `/api/staff/appointments/${S.apptAda.id}/check-in`, {}, S.staffA))
    const next = await api('POST', `/api/staff/departments/${S.deptA}/call-next`, {}, S.staffA)
    expectOk(next)
    assert.equal(next.body.queueNumber, 1)
    const seen = await api('POST', `/api/staff/appointments/${S.apptAda.id}/seen`, {}, S.staffA)
    expectOk(seen)
    assert.equal(seen.body.depositStatus, 'deducted')
    const k = await api('GET', '/api/kolo', undefined, S.ada)
    assert.deepEqual([k.body.available, k.body.reserved], [700, 0])
  })

  test('no-show needs the grace period; walk-in has no deposit', async () => {
    expectOk(await api('POST', `/api/staff/departments/${S.deptA}/call-next`, {}, S.staffA)) // Baba Musa
    expectErr(await api('POST', `/api/staff/appointments/${S.walkMusa.id}/no-show`, {}, S.staffA), 409, 'grace_not_ended')
    expectOk(await api('PATCH', '/api/manager/clinic', { graceMinutes: 0 }, S.managerA))
    const r = await api('POST', `/api/staff/appointments/${S.walkMusa.id}/no-show`, {}, S.staffA)
    expectOk(r)
    assert.equal(r.body.depositStatus, 'none')
    expectErr(await api('POST', `/api/staff/departments/${S.deptA}/call-next`, {}, S.staffA), 409, 'nobody_waiting')
  })

  test('cancelling: early returns the deposit, late asks first then forfeits', async () => {
    const book = (date, time) => api('POST', '/api/appointments', { familyMemberId: S.adaChild, departmentId: S.deptA, date, time }, S.ada)

    const early = await book(tomorrow, '12:00')
    expectOk(early, 201)
    assert.equal(early.body.appointment.cancelRefundsDeposit, true)
    const c1 = await api('POST', `/api/appointments/${early.body.appointment.id}/cancel`, {}, S.ada)
    assert.equal(c1.body.depositStatus, 'returned')
    assert.ok((await freeSlots(S.deptA, tomorrow)).includes('12:00'), 'a cancelled slot is released immediately')

    const late = await book(today, S.slots[3])
    expectOk(late, 201)
    const id = late.body.appointment.id
    const warn = await api('POST', `/api/appointments/${id}/cancel`, {}, S.ada)
    expectErr(warn, 409, 'needs_confirmation')
    assert.equal(warn.body.depositForfeited, true)
    const c2 = await api('POST', `/api/appointments/${id}/cancel`, { confirm: true }, S.ada)
    assert.equal(c2.body.depositStatus, 'forfeited')
    const k = await api('GET', '/api/kolo', undefined, S.ada)
    assert.deepEqual([k.body.available, k.body.reserved], [400, 0]) // 700 - 300 forfeited
    expectErr(await api('POST', `/api/appointments/${id}/cancel`, { confirm: true }, S.ada), 409, 'cannot_cancel')
  })

  test('Kolo history lists every movement and links to the visit', async () => {
    const r = await api('GET', '/api/kolo/transactions', undefined, S.ada)
    const types = r.body.transactions.map((t) => t.type)
    for (const t of ['topup', 'hold', 'deduct', 'refund', 'forfeit']) assert.ok(types.includes(t), `missing ${t}`)
    const deduct = r.body.transactions.find((t) => t.type === 'deduct')
    assert.equal(deduct.appointment.depositStatus, 'deducted')
  })

  test('emergency move to front is logged with a reason; late arrival goes next', async () => {
    const mk = async (name) =>
      (await api('POST', '/api/staff/walk-ins', { departmentId: S.deptA, name }, S.staffA)).body.appointment
    const w1 = await mk('Walker One')
    const w2 = await mk('Walker Two')
    const w3 = await mk('Walker Three')
    expectErr(await api('POST', `/api/staff/appointments/${w3.id}/move-to-front`, {}, S.staffA), 400, 'invalid_input')
    expectOk(await api('POST', `/api/staff/appointments/${w3.id}/move-to-front`, { reason: 'Severe pain' }, S.staffA))
    const first = await api('POST', `/api/staff/departments/${S.deptA}/call-next`, {}, S.staffA)
    assert.equal(first.body.firstName, 'Walker')
    assert.equal(first.body.id, w3.id)

    // Walker Three was called but turned up late: requeue puts them next in line.
    expectOk(await api('POST', `/api/staff/appointments/${w3.id}/requeue`, {}, S.staffA))
    const again = await api('POST', `/api/staff/departments/${S.deptA}/call-next`, {}, S.staffA)
    assert.equal(again.body.id, w3.id)
    const log = (await api('GET', '/api/staff/log', undefined, S.staffA)).body.entries
    assert.ok(log.some((l) => l.action === 'move_to_front' && l.reason === 'Severe pain'))
    assert.ok(log.every((l) => l.staffName))
    S.w1 = w1.id
    S.w2 = w2.id
  })

  test('public Now serving screen shows first names and numbers only', async () => {
    const r = await api('GET', `/api/public/clinics/${S.clinicA}/now-serving`)
    expectOk(r)
    const text = JSON.stringify(r.body)
    assert.ok(!text.includes('Okafor') && !text.includes('+234') && !text.includes('Three'))
    const gopd = r.body.departments.find((d) => d.departmentName === 'GOPD')
    assert.equal(gopd.nowServing.firstName, 'Walker')
  })

  test('cancelling the rest of the day returns deposits to Kolo', async () => {
    const before_ = (await api('GET', '/api/kolo', undefined, S.bola)).body
    const slot = (await freeSlots(S.deptA))[0]
    expectOk(await api('POST', '/api/appointments', { familyMemberId: S.bolaSelf, departmentId: S.deptA, date: today, time: slot }, S.bola), 201)
    assert.equal((await api('GET', '/api/kolo', undefined, S.bola)).body.reserved, 300)
    const r = await api('POST', '/api/staff/cancel-day', { reason: 'Doctor called away' }, S.staffA)
    assert.ok(r.body.cancelled >= 3)
    const after_ = (await api('GET', '/api/kolo', undefined, S.bola)).body
    assert.deepEqual([after_.available, after_.reserved], [before_.available, before_.reserved])
  })

  test('a free clinic visit returns the deposit instead of deducting it', async () => {
    const slot = (await freeSlots(S.deptFree))[0]
    const b = await api('POST', '/api/appointments', { familyMemberId: S.adaSelf, departmentId: S.deptFree, date: today, time: slot }, S.ada)
    expectOk(b, 201)
    const id = b.body.appointment.id
    await api('POST', `/api/staff/appointments/${id}/call`, {}, S.staffA)
    const seen = await api('POST', `/api/staff/appointments/${id}/seen`, {}, S.staffA)
    assert.equal(seen.body.depositStatus, 'returned')
  })

  test('daily statistics', async () => {
    const r = await api('GET', '/api/staff/stats', undefined, S.staffA)
    expectOk(r)
    assert.ok(r.body.totals.patientsSeen >= 2)
    assert.ok(r.body.totals.noShows >= 1)
    assert.ok(r.body.totals.walkIns >= 1)
    assert.equal(r.body.byDepartment.length, 2)
    assert.equal(typeof r.body.totals.averageVisitMinutes, 'number')
  })

  test('staff are limited to their own hospital and attempts are logged', async () => {
    const h2 = await api('POST', '/api/hospitals/register', hospital({ hospitalName: 'Other Clinic', email: 'desk@otherclinic.example.com' }))
    S.managerB = h2.body.token
    S.clinicB = h2.body.clinic.id
    expectErr(await api('POST', `/api/staff/appointments/${S.apptAda.id}/check-in`, {}, S.managerB), 403, 'not_authorised_for_clinic')
    const log = (await api('GET', '/api/staff/log', undefined, S.managerB)).body.entries
    assert.ok(log.some((l) => l.action === 'access_denied'))
    const mine = await api('GET', '/api/staff/today', undefined, S.managerB)
    assert.equal(mine.body.appointments.length, 0)
  })

  test('school clinic: no deposit, warning after 1st no-show, 7-day block after 2nd, walk-ins still allowed', async () => {
    await api('POST', '/api/hospitals/register', hospital({ hospitalName: 'Test School Clinic', type: 'school', area: 'Akoka', email: 'clinic@testschool.example.com' }))
    const mgr = (await api('POST', '/api/auth/work-login', { email: 'clinic@testschool.example.com', password: 'managerpass1' })).body
    const clinicId = mgr.user.clinicId
    expectOk(await api('POST', `/api/admin/clinics/${clinicId}/approve`, {}, S.admin))
    const d = await api('POST', '/api/manager/departments', { name: 'GOPD', consultationFee: null, opensAt: '00:00', closesAt: '23:50', slotMinutes: 10, avgVisitMinutes: 10 }, mgr.token)
    const deptId = d.body.department.id
    await api('PATCH', '/api/manager/clinic', { graceMinutes: 0 }, mgr.token)
    assert.equal((await api('GET', `/api/clinics/${clinicId}`)).body.clinic.depositNaira, 0)

    const stu = await register('Tunde Student', '08031110070')
    const self = (await api('GET', '/api/family', undefined, stu.body.token)).body.members[0].id
    const book = (date, time) => api('POST', '/api/appointments', { familyMemberId: self, departmentId: deptId, date, time }, stu.body.token)

    const b1 = await book(tomorrow, '10:00')
    expectOk(b1, 201)
    assert.equal(b1.body.appointment.deposit.status, 'none')
    assert.equal((await api('GET', '/api/kolo', undefined, stu.body.token)).body.available, 0)

    const miss = async (id) => {
      await api('POST', `/api/staff/appointments/${id}/call`, {}, mgr.token)
      return api('POST', `/api/staff/appointments/${id}/no-show`, {}, mgr.token)
    }
    const m1 = await miss(b1.body.appointment.id)
    assert.equal(m1.body.studentRule.missCount, 1)
    const me1 = await api('GET', '/api/auth/me', undefined, stu.body.token)
    assert.equal(me1.body.noShowStatus[0].missCount, 1)
    assert.equal(me1.body.noShowStatus[0].blockedUntil, null)

    const b2 = await book(addDays(today, 2), '10:00')
    expectOk(b2, 201)
    const m2 = await miss(b2.body.appointment.id)
    assert.ok(m2.body.studentRule.blockedUntil)
    const blocked = await book(addDays(today, 3), '10:00')
    expectErr(blocked, 403, 'booking_blocked')
    assert.ok(blocked.body.until)

    const walk = await api('POST', '/api/staff/walk-ins', { departmentId: deptId, name: 'Tunde Student', phone: '08031110070' }, mgr.token)
    expectOk(walk, 201)
    const students = await api('GET', '/api/staff/noshows', undefined, mgr.token)
    assert.equal(students.body.students[0].name, 'Tunde Student')
    assert.ok(students.body.students[0].blockedUntil)
  })

  test('a manager can disable staff and the change takes effect at once', async () => {
    expectOk(await api('GET', '/api/staff/today', undefined, S.staffA))
    expectOk(await api('PATCH', `/api/manager/staff/${S.staffId}`, { active: false }, S.managerA))
    expectErr(await api('GET', '/api/staff/today', undefined, S.staffA), 403, 'account_disabled')
    expectErr(await api('POST', '/api/auth/work-login', { email: 'joy@testgeneral.example.com', password: 'staffpass12' }), 403, 'account_disabled')
  })

  test('the Kolo history and action log cannot be edited or deleted', async () => {
    await assert.rejects(pool.query(`UPDATE kolo_transactions SET amount_naira = 1`), /append-only/)
    await assert.rejects(pool.query(`DELETE FROM kolo_transactions`), /append-only/)
    await assert.rejects(pool.query(`UPDATE action_log SET action = 'x'`), /append-only/)
    await assert.rejects(pool.query(`DELETE FROM action_log`), /append-only/)
  })

  test('removing a family member cancels their upcoming visits', async () => {
    const slot = (await freeSlots(S.deptA, tomorrow))[0]
    const b = await api('POST', '/api/appointments', { familyMemberId: S.adaChild, departmentId: S.deptA, date: tomorrow, time: slot }, S.ada)
    expectOk(b, 201)
    const before_ = (await api('GET', '/api/kolo', undefined, S.ada)).body
    expectOk(await api('DELETE', `/api/family/${S.adaChild}`, undefined, S.ada), 204)
    const after_ = (await api('GET', '/api/kolo', undefined, S.ada)).body
    assert.equal(after_.reserved, before_.reserved - 300)
    assert.equal((await api('GET', `/api/appointments/${b.body.appointment.id}`, undefined, S.ada)).body.appointment.status, 'cancelled')
  })
})
