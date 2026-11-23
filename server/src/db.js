import pg from 'pg'

// Return DATE columns as plain 'YYYY-MM-DD' strings (not JS Dates, which shift with timezones).
pg.types.setTypeParser(1082, (value) => value)

// Connection pool for the hosted PostgreSQL database (Neon / Supabase).
// DATABASE_URL comes from server/.env and should include ?sslmode=require.
export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.PG_POOL_MAX) || 10,
})

export const query = (text, params) => pool.query(text, params)

// Runs fn(client) inside one transaction. Inside fn, use ONLY the client, never pool.query.
export async function withTx(fn) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

export async function checkDb() {
  if (!process.env.DATABASE_URL) return 'not configured'
  try {
    await pool.query('SELECT 1')
    return 'connected'
  } catch {
    return 'error'
  }
}
