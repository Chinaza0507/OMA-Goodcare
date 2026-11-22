// Create an Oma admin account. Hospitals register themselves, managers create their own
// staff, and patients sign up in the app, so admins are the only accounts made here.
// Usage: NEW_USER_PASSWORD=... node src/scripts/create-admin.js "Full Name" 08012345678
// The password comes from an environment variable so it never appears in your shell history.
import 'dotenv/config'
import { pool } from '../db.js'
import { hashSecret } from '../lib/secret.js'
import { normalizePhone } from '../lib/phone.js'

const [name, rawPhone] = process.argv.slice(2)
const password = process.env.NEW_USER_PASSWORD
const phone = normalizePhone(rawPhone)

if (!name || !phone || !password || password.length < 8 || !process.env.PIN_PEPPER) {
  console.error('Usage: NEW_USER_PASSWORD=<8+ chars> node src/scripts/create-admin.js "Full Name" 080XXXXXXXX')
  console.error('PIN_PEPPER must also be set in server/.env.')
  process.exit(1)
}

await pool.query(
  `INSERT INTO users (role, name, phone, secret_hash, consent_at) VALUES ('admin', $1, $2, $3, now())`,
  [name, phone, await hashSecret(password)],
)
console.log(`Created admin: ${name} (${phone})`)
await pool.end()
