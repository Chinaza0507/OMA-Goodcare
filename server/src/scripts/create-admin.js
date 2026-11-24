// Create an Oma admin account (the people who approve hospitals). Hospitals register
// themselves and patients sign up in the app, so admins are the only accounts made here.
// Usage: NEW_USER_PASSWORD=... node src/scripts/create-admin.js "Full Name" you@example.com
// The password comes from an environment variable so it never appears in your shell history.
import 'dotenv/config'
import { pool } from '../db.js'
import { hashSecret } from '../lib/secret.js'

const [name, rawEmail] = process.argv.slice(2)
const password = process.env.NEW_USER_PASSWORD
const email = rawEmail?.trim().toLowerCase()

if (!name || !email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !password || password.length < 8 || !process.env.PIN_PEPPER) {
  console.error('Usage: NEW_USER_PASSWORD=<8+ chars> npm run create-admin -- "Full Name" you@example.com')
  console.error('PIN_PEPPER must also be set in server/.env.')
  process.exit(1)
}

try {
  await pool.query(
    `INSERT INTO users (role, name, email, secret_hash, consent_at) VALUES ('admin', $1, $2, $3, now())`,
    [name, email, await hashSecret(password)],
  )
  console.log(`Created admin: ${name} (${email}). Sign in at /admin.`)
} catch (err) {
  if (err.code === '23505') console.error('An account with that email already exists.')
  else throw err
} finally {
  await pool.end()
}
