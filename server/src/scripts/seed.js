// Development only: adds two sample approved hospitals so you can try the app, plus an
// Oma admin. Random passwords are printed ONCE in this terminal; they are never stored in
// the code. Sample hospital names and prices are made up. Safe to re-run (skips what exists).
import 'dotenv/config'
import crypto from 'node:crypto'
import { pool } from '../db.js'
import { hashSecret } from '../lib/secret.js'

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to seed a production database.')
  process.exit(1)
}
if (!process.env.PIN_PEPPER) {
  console.error('Set PIN_PEPPER in server/.env first.')
  process.exit(1)
}

const randomPassword = () => crypto.randomBytes(9).toString('base64url')
const created = []

async function addUser({ role, name, phone, clinicId = null }) {
  const { rows: existing } = await pool.query('SELECT 1 FROM users WHERE phone = $1', [phone])
  if (existing.length) return
  const password = randomPassword()
  await pool.query(
    `INSERT INTO users (role, name, phone, secret_hash, clinic_id, consent_at) VALUES ($1, $2, $3, $4, $5, now())`,
    [role, name, phone, await hashSecret(password), clinicId],
  )
  created.push({ role, name, phone, password })
}

async function addClinic(c, departments) {
  const { rows: existing } = await pool.query('SELECT id FROM clinics WHERE name = $1', [c.name])
  if (existing[0]) return existing[0].id
  const { rows } = await pool.query(
    `INSERT INTO clinics (name, type, billing_type, state, area, address, latitude, longitude, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'approved') RETURNING id`,
    [c.name, c.type, c.type === 'school' ? 'covered' : 'paid', c.state, c.area, c.address, c.lat, c.lng],
  )
  for (const d of departments) {
    await pool.query(
      `INSERT INTO departments (clinic_id, name, consultation_fee_naira, opens_at, closes_at, slot_minutes, avg_visit_minutes)
       VALUES ($1, $2, $3, '08:00', '16:00', 20, 15)`,
      [rows[0].id, d.name, d.fee],
    )
  }
  return rows[0].id
}

const demoId = await addClinic(
  { name: 'Demo General Hospital', type: 'private', state: 'Lagos', area: 'Yaba', address: '1 Sample Road, Yaba', lat: 6.5158, lng: 3.3711 },
  [{ name: 'GOPD', fee: 5000 }, { name: 'Pediatrics', fee: 6000 }, { name: 'Dental', fee: 8000 }],
)
const schoolId = await addClinic(
  { name: 'Demo School Clinic', type: 'school', state: 'Lagos', area: 'Akoka', address: 'Sample University Campus, Akoka', lat: 6.5189, lng: 3.3986 },
  [{ name: 'GOPD', fee: null }],
)

await addUser({ role: 'manager', name: 'Demo Hospital Manager', phone: '+2348010000001', clinicId: demoId })
await addUser({ role: 'staff', name: 'Nurse Joy', phone: '+2348010000002', clinicId: demoId })
await addUser({ role: 'manager', name: 'Demo School Manager', phone: '+2348010000003', clinicId: schoolId })
await addUser({ role: 'admin', name: 'Oma Admin', phone: '+2348010000009' })

if (created.length) {
  console.log('\nSample accounts created. Passwords are shown only now - save them somewhere safe:\n')
  console.table(created)
} else {
  console.log('Sample data already exists; nothing new created.')
}
await pool.end()
