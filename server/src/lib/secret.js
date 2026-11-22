import crypto from 'node:crypto'
import bcrypt from 'bcryptjs'

// A 4-digit PIN has only 10,000 possibilities, so a leaked database would let someone
// crack every PIN instantly. Mixing in a server-side pepper (kept in .env, not the
// database) means a leaked database alone is not enough.
const prehash = (secret) =>
  crypto.createHmac('sha256', process.env.PIN_PEPPER).update(secret).digest('hex')

export const hashSecret = (secret) => bcrypt.hash(prehash(secret), 12)
export const verifySecret = (secret, hash) => bcrypt.compare(prehash(secret), hash)
