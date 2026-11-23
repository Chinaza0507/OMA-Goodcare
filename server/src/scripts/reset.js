// Development only: drops every Oma table so the schema can be re-created.
import 'dotenv/config'
import { pool } from '../db.js'

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to reset a production database.')
  process.exit(1)
}

await pool.query(`
  DROP TABLE IF EXISTS action_log, noshow_tracking, kolo_transactions, appointments,
    kolo_wallets, family_members, users, departments, clinics CASCADE;
  DROP FUNCTION IF EXISTS forbid_change() CASCADE;
`)
console.log('All Oma tables dropped. Run: npm run migrate')
await pool.end()
