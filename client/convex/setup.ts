// One-off setup run from the terminal (internal: the website cannot call it).
//   npx convex run setup:createAdmin '{"name":"Your Name","email":"you@example.com","password":"…"}'
import { v } from 'convex/values'
import { internalMutation } from './_generated/server'
import { cleanEmail, fail, fromMinutes, hashSecret, text, toMinutes, todayLagos, queueChanged } from './lib/core'

export const createAdmin = internalMutation({
  args: { name: v.string(), email: v.string(), password: v.string() },
  handler: async (ctx, a) => {
    const email = cleanEmail(a.email)
    if (a.password.length < 8) fail('invalid_input', { field: 'password' })
    if ((await ctx.db.query('users').withIndex('by_email', (q) => q.eq('email', email)).collect()).some((u) => u.role !== 'patient')) fail('email_taken')
    await ctx.db.insert('users', {
      role: 'admin', name: text(a.name, 2, 100, 'name'), email, secretHash: await hashSecret(a.password),
      language: 'en', alertAhead: 3, active: true, consentAt: Date.now(), failedAttempts: 0,
    })
    return `Created admin ${email}. Sign in at /admin.`
  },
})

// Fix an admin login's email (keeps the password).
//   npx convex run setup:changeAdminEmail '{"from":"old@example.com","to":"new@example.com"}'
export const changeAdminEmail = internalMutation({
  args: { from: v.string(), to: v.string() },
  handler: async (ctx, a) => {
    const from = a.from.trim().toLowerCase()
    const to = cleanEmail(a.to)
    const admin = (await ctx.db.query('users').withIndex('by_email', (q) => q.eq('email', from)).collect()).find((u) => u.role === 'admin')
    if (!admin) return fail('not_found')
    if ((await ctx.db.query('users').withIndex('by_email', (q) => q.eq('email', to)).collect()).some((u) => u.role !== 'patient')) fail('email_taken')
    await ctx.db.patch(admin._id, { email: to })
    return `Admin email changed to ${to}. Sign in at /admin.`
  },
})

// ---------- Demo hospitals (made-up names) ----------
// npx convex run setup:seedDemo '{"password":"…"}'   (each hospital's front-desk login uses this password)
// npx convex run setup:removeDemo                       (removes every demo hospital and its data)
type Svc = [name: string, minutes: number, price: number | null]
type Dept = { name: string; days: number[]; from: string; to: string; services: Svc[] }
const WEEKDAYS = [1, 2, 3, 4, 5]
const DEMO: { name: string; type: 'public' | 'mission' | 'private' | 'dental' | 'eye' | 'specialist'; area: string; address: string; landmark: string; email: string; lat: number; lng: number; depts: Dept[] }[] = [
  {
    name: 'Harmony General Hospital', type: 'public', area: 'Ikeja', address: '14 Obafemi Awolowo Way', landmark: 'Near Ikeja City Mall',
    email: 'desk@harmony-general.demo', lat: 6.6018, lng: 3.3515,
    depts: [
      { name: 'General Outpatient (GOPD)', days: WEEKDAYS, from: '09:00', to: '16:00', services: [['General consultation', 20, 2000], ['Blood pressure check', 15, 0], ['Malaria test', 20, 1500], ['Blood test', 15, 3000], ['Ultrasound scan', 30, 8000]] },
      { name: 'Children', days: [1, 3, 5], from: '09:00', to: '14:00', services: [['Child check-up', 25, 0], ['Immunisation', 15, 0]] },
    ],
  },
  {
    name: 'Pearl Dental Clinic', type: 'dental', area: 'Lekki', address: '22 Admiralty Way, Lekki Phase 1', landmark: 'Opposite the filling station',
    email: 'desk@pearl-dental.demo', lat: 6.4474, lng: 3.4723,
    depts: [
      { name: 'Dental', days: [1, 2, 3, 4, 5, 6], from: '09:00', to: '17:00', services: [['Teeth cleaning', 30, 8000], ['Tooth filling', 45, 15000], ['Tooth extraction', 30, 12000], ['Braces fitting', 60, null], ['Teeth whitening', 60, 40000]] },
    ],
  },
  {
    name: 'ClearView Eye Clinic', type: 'eye', area: 'Victoria Island', address: '5 Adeola Odeku Street', landmark: 'Beside the bank',
    email: 'desk@clearview-eye.demo', lat: 6.4281, lng: 3.4219,
    depts: [
      { name: 'Eye care', days: WEEKDAYS, from: '10:00', to: '16:00', services: [['Eye test', 30, 5000], ['Glasses fitting', 20, 3000], ['Contact lens fitting', 30, 7000], ['Eye pressure test', 20, 4000]] },
    ],
  },
  {
    name: 'St. Grace Mission Hospital', type: 'mission', area: 'Surulere', address: '8 Bode Thomas Street', landmark: 'Near the church',
    email: 'desk@stgrace-mission.demo', lat: 6.5, lng: 3.35,
    depts: [
      { name: 'General Outpatient (GOPD)', days: [1, 2, 3, 4, 5, 6], from: '08:00', to: '15:00', services: [['General consultation', 20, 2000], ['Check-up', 30, 3000]] },
      { name: 'Family planning', days: [3], from: '09:00', to: '13:00', services: [['Family planning', 30, 0]] },
      { name: 'Physiotherapy', days: [2, 4], from: '10:00', to: '15:00', services: [['Physiotherapy', 45, 6000]] },
    ],
  },
  {
    name: 'Sunrise Children & Specialist Clinic', type: 'specialist', area: 'Yaba', address: '31 Herbert Macaulay Way', landmark: 'Close to the tech hub',
    email: 'desk@sunrise-specialist.demo', lat: 6.5095, lng: 3.3711,
    depts: [
      { name: 'Paediatrics', days: WEEKDAYS, from: '09:00', to: '15:00', services: [['Child check-up', 25, 3000], ['Immunisation', 15, 0]] },
      { name: 'Skin clinic', days: [3], from: '10:00', to: '14:00', services: [['Dermatology (skin)', 30, 10000]] },
      { name: 'ENT', days: [4], from: '10:00', to: '14:00', services: [['ENT (ear, nose, throat)', 30, 10000]] },
    ],
  },
]

export const seedDemo = internalMutation({
  args: { password: v.string() },
  handler: async (ctx, a) => {
    if (a.password.length < 8) fail('invalid_input', { field: 'password' })
    const made: string[] = []
    for (const h of DEMO) {
      const taken = (await ctx.db.query('users').withIndex('by_email', (q) => q.eq('email', h.email)).collect()).some((u) => u.role !== 'patient')
      if (taken) continue // already there: running it twice is safe
      const clinicId = await ctx.db.insert('clinics', {
        name: h.name, type: h.type, billingType: 'paid', paymentOption: 'per_patient', state: 'Lagos', area: h.area,
        address: h.address, landmark: h.landmark, email: h.email, latitude: h.lat, longitude: h.lng, status: 'approved',
        graceMinutes: 10, cancelWindowMinutes: 120, depositNaira: 300, active: true, demo: true,
      })
      await ctx.db.insert('users', {
        role: 'manager', name: h.name, email: h.email, secretHash: await hashSecret(a.password), language: 'en',
        alertAhead: 3, clinicId, active: true, consentAt: Date.now(), failedAttempts: 0,
      })
      for (const d of h.depts) {
        const departmentId = await ctx.db.insert('departments', { clinicId, name: d.name, bookingDays: d.days, opensAt: d.from, closesAt: d.to, active: true })
        for (const [name, minutes, price] of d.services) await ctx.db.insert('services', { clinicId, departmentId, name, minutes, price, active: true })
      }
      made.push(h.name)
    }
    return made.length ? `Added: ${made.join(', ')}` : 'Demo hospitals were already there.'
  },
})

export const removeDemo = internalMutation({
  args: {},
  handler: async (ctx) => {
    const demos = (await ctx.db.query('clinics').collect()).filter((c) => c.demo)
    for (const c of demos) {
      for (const a of await ctx.db.query('appointments').withIndex('by_clinic_date', (q) => q.eq('clinicId', c._id)).collect()) {
        // Give back any held deposit before removing the visit.
        if (a.depositStatus === 'held') {
          const w = await ctx.db.query('koloWallets').withIndex('by_user', (q) => q.eq('userId', a.bookedBy)).first()
          if (w) await ctx.db.patch(w._id, { available: w.available + a.depositNaira, reserved: Math.max(0, w.reserved - a.depositNaira) })
        }
        await ctx.db.delete(a._id)
      }
      for (const t of ['services', 'departments'] as const) {
        for (const row of await ctx.db.query(t).withIndex(t === 'services' ? 'by_clinic' : 'by_clinic', (q) => q.eq('clinicId', c._id)).collect()) await ctx.db.delete(row._id)
      }
      for (const w of await ctx.db.query('walkIns').withIndex('by_clinic_date', (q) => q.eq('clinicId', c._id)).collect()) await ctx.db.delete(w._id)
      for (const u of await ctx.db.query('users').withIndex('by_clinic', (q) => q.eq('clinicId', c._id)).collect()) {
        for (const s of await ctx.db.query('sessions').withIndex('by_user', (q) => q.eq('userId', u._id)).collect()) await ctx.db.delete(s._id)
        await ctx.db.delete(u._id)
      }
      await ctx.db.delete(c._id)
    }
    return `Removed ${demos.length} demo hospital(s).`
  },
})

// Fills a demo hospital's queue with made-up patients so the front desk page can be shown busy.
//   npx convex run setup:seedDemoQueue '{"email":"desk@stgrace-mission.demo"}'
// Running it again replaces that day's made-up queue. Only works on demo hospitals.
const DEMO_NAMES = [
  'Adaeze Okafor', 'Tunde Bakare', 'Ngozi Eze', 'Ibrahim Musa', 'Funmi Adeyemi', 'Chinedu Obi',
  'Halima Bello', 'Segun Ajayi', 'Amaka Nwosu', 'Kemi Oladipo', 'Emeka Uche', 'Zainab Yusuf',
]
export const seedDemoQueue = internalMutation({
  args: { email: v.string(), date: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const manager = (await ctx.db.query('users').withIndex('by_email', (q) => q.eq('email', cleanEmail(a.email))).collect()).find((u) => u.role === 'manager')
    const clinic = manager?.clinicId ? await ctx.db.get(manager.clinicId) : null
    if (!manager || !clinic || !clinic.demo) fail('not_found')
    const date = a.date ?? todayLagos()
    for (const old of await ctx.db.query('appointments').withIndex('by_clinic_date', (q) => q.eq('clinicId', clinic!._id).eq('date', date)).collect()) await ctx.db.delete(old._id)
    for (const old of await ctx.db.query('walkIns').withIndex('by_clinic_date', (q) => q.eq('clinicId', clinic!._id).eq('date', date)).collect()) await ctx.db.delete(old._id)

    const now = Date.now()
    // seen, with the doctor, three waiting, four not arrived yet
    const plan = ['seen', 'seen', 'called', 'checked_in', 'checked_in', 'checked_in', 'booked', 'booked', 'booked', 'booked'] as const
    let n = 0
    for (const dept of await ctx.db.query('departments').withIndex('by_clinic', (q) => q.eq('clinicId', clinic!._id)).collect()) {
      const services = (await ctx.db.query('services').withIndex('by_clinic', (q) => q.eq('clinicId', clinic!._id)).collect()).filter((s) => s.departmentId === dept._id && s.active)
      if (!services.length) continue
      let t = toMinutes(dept.opensAt)
      for (let i = 0; i < plan.length && t < toMinutes(dept.closesAt); i++) {
        const sv = services[i % services.length]
        const status = plan[i]
        const ago = (plan.length - i) * 12 * 60_000
        await ctx.db.insert('appointments', {
          clinicId: clinic!._id, departmentId: dept._id, serviceId: sv._id, serviceName: sv.name, minutes: sv.minutes,
          bookedBy: manager!._id, patientName: DEMO_NAMES[n++ % DEMO_NAMES.length], date, time: fromMinutes(t),
          queueNumber: i + 1, status, depositNaira: 0, depositStatus: 'none', frontRank: 0, alertAhead: 2,
          ...(status !== 'booked' ? { arrivedAt: now - ago - 20 * 60_000 } : {}),
          ...(status === 'called' || status === 'seen' ? { calledAt: now - ago } : {}),
          ...(status === 'seen' ? { finishedAt: now - ago + sv.minutes * 60_000 } : {}),
        })
        t += Math.max(sv.minutes, 35)
      }
      const walk = [['Blessing Okon', 'seen'], ['Musa Danjuma', 'waiting'], ['Grace Effiong', 'waiting']] as const
      for (const [i, [name, status]] of walk.entries()) {
        await ctx.db.insert('walkIns', { clinicId: clinic!._id, departmentId: dept._id, date, number: i + 1, name, status, ...(status === 'seen' ? { finishedAt: now } : {}) })
      }
      await queueChanged(ctx, clinic!._id, dept._id)
    }
    return `Filled ${clinic!.name}'s queue for ${date}.`
  },
})
