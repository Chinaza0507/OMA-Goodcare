// Shared helpers: errors, time (Nigeria), phone numbers, hashing, sessions, logging, live versions.
import { ConvexError } from 'convex/values'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import type { Doc, Id } from '../_generated/dataModel'

// ---------- errors ----------
// A stable machine code; the website translates it into the user's language.
export const fail = (code: string, extra: Record<string, unknown> = {}): never => {
  throw new ConvexError({ code, ...extra })
}

// ---------- time ----------
// Nigeria is on WAT (UTC+1) all year with no daylight saving.
const LAGOS_OFFSET = 60 * 60_000
const lagos = (ms = Date.now()) => new Date(ms + LAGOS_OFFSET)
export const todayLagos = (ms = Date.now()) => lagos(ms).toISOString().slice(0, 10)
export const nowMinutesLagos = (ms = Date.now()) => {
  const d = lagos(ms)
  return d.getUTCHours() * 60 + d.getUTCMinutes()
}
export const toMinutes = (time: string) => {
  const [h, m] = time.split(':')
  return Number(h) * 60 + Number(m)
}
export const fromMinutes = (n: number) =>
  `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`
// The exact moment a date + local slot time happens.
export const slotInstant = (date: string, time: string) => Date.parse(`${date}T${time.slice(0, 5)}:00+01:00`)
export const dayStartMs = (date: string) => Date.parse(`${date}T00:00:00+01:00`)
export function generateSlots(opensAt: string, closesAt: string, slotMinutes: number) {
  const slots: string[] = []
  const close = toMinutes(closesAt)
  for (let t = toMinutes(opensAt); t + slotMinutes <= close; t += slotMinutes) slots.push(fromMinutes(t))
  return slots
}
export const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/

// ---------- phone / names ----------
// Accepts 080..., +23480..., 23480... and returns +23480XXXXXXXX, or null if invalid.
export function normalizePhone(input: unknown) {
  let s = String(input ?? '').replace(/[\s\-()]/g, '')
  if (s.startsWith('+')) s = s.slice(1)
  if (s.startsWith('234')) s = s.slice(3)
  else if (s.startsWith('0')) s = s.slice(1)
  return /^[789]\d{9}$/.test(s) ? `+234${s}` : null
}
export const firstName = (name: string) => String(name).trim().split(/\s+/)[0]
export const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
export const cleanEmail = (e: string) => {
  const x = e.trim().toLowerCase()
  if (!EMAIL.test(x) || x.length > 200) fail('invalid_input', { field: 'email' })
  return x
}
export const text = (s: string, min: number, max: number, field = 'text') => {
  const x = s.trim()
  if (x.length < min || x.length > max) fail('invalid_input', { field })
  return x
}
export const int = (n: number, min: number, max: number, field = 'number') => {
  if (!Number.isInteger(n) || n < min || n > max) fail('invalid_input', { field })
  return n
}

// ---------- hashing ----------
// A 4-digit PIN has only 10,000 possibilities, so a server-side pepper (kept in the Convex
// environment, not the database) is mixed in: a leaked database alone is not enough.
const enc = new TextEncoder()
const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
const unhex = (s: string) => new Uint8Array(s.match(/../g)!.map((h) => parseInt(h, 16)))
const ITERATIONS = 100_000

function pepper() {
  const p = process.env.PIN_PEPPER
  if (!p || p.length < 32) throw new Error('PIN_PEPPER must be set in the Convex environment (32+ characters).')
  return p
}
async function derive(secret: string, salt: Uint8Array, iterations: number) {
  const key = await crypto.subtle.importKey('raw', enc.encode(`${pepper()}:${secret}`), 'PBKDF2', false, ['deriveBits'])
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256))
}
export const randomHex = (bytes: number) => {
  const b = new Uint8Array(bytes)
  crypto.getRandomValues(b)
  return hex(b.buffer)
}
export async function hashSecret(secret: string) {
  const salt = unhex(randomHex(16))
  return `pbkdf2$${ITERATIONS}$${hex(salt.buffer as ArrayBuffer)}$${await derive(secret, salt, ITERATIONS)}`
}
export async function verifySecret(secret: string, stored: string) {
  const [, it, salt, want] = stored.split('$')
  const got = await derive(secret, unhex(salt), Number(it))
  let diff = got.length ^ want.length
  for (let i = 0; i < got.length && i < want.length; i++) diff |= got.charCodeAt(i) ^ want.charCodeAt(i)
  return diff === 0
}
export const sha256 = async (s: string) => hex(await crypto.subtle.digest('SHA-256', enc.encode(s)))
export const randomInt = (min: number, max: number) => {
  const b = new Uint32Array(1)
  crypto.getRandomValues(b)
  return min + (b[0] % (max - min))
}

// ---------- sessions ----------
const SESSION_DAYS = 7
export async function createSession(ctx: MutationCtx, userId: Id<'users'>) {
  const token = randomHex(32)
  await ctx.db.insert('sessions', { userId, tokenHash: await sha256(token), expiresAt: Date.now() + SESSION_DAYS * 86_400_000 })
  return token
}

// Every signed-in function takes the session token. Disabled accounts lose access at once.
export async function getUser(ctx: QueryCtx, token: string | undefined): Promise<Doc<'users'>> {
  if (!token || typeof token !== 'string') return fail('auth_required')
  const tokenHash = await sha256(token)
  const session = await ctx.db.query('sessions').withIndex('by_token', (q) => q.eq('tokenHash', tokenHash)).first()
  if (!session || session.expiresAt < Date.now()) return fail('session_expired')
  const user = await ctx.db.get(session.userId)
  if (!user) return fail('session_expired')
  if (!user.active) return fail('account_disabled')
  return user
}

export async function requireRole(ctx: QueryCtx, token: string | undefined, ...roles: Doc<'users'>['role'][]) {
  const user = await getUser(ctx, token)
  if (!roles.includes(user.role)) fail('forbidden')
  return user
}
export const requirePatient = (ctx: QueryCtx, token: string | undefined) => requireRole(ctx, token, 'patient')

// Front-desk staff and managers, always tied to one clinic.
export async function requireStaff(ctx: QueryCtx, token: string | undefined) {
  const user = await requireRole(ctx, token, 'staff', 'manager')
  if (!user.clinicId) fail('forbidden')
  return user as Doc<'users'> & { clinicId: Id<'clinics'> }
}

export const publicUser = (u: Doc<'users'>) => ({
  id: u._id,
  name: u.name,
  phone: u.phone ?? null,
  email: u.email ?? null,
  role: u.role,
  language: u.language,
  alertAhead: u.alertAhead,
  clinicId: u.clinicId ?? null,
})

// ---------- action log (append-only) ----------
export async function logAction(
  ctx: MutationCtx,
  a: {
    clinicId: Id<'clinics'>
    actor?: { _id?: Id<'users'>; id?: Id<'users'>; name: string } | null
    action: string
    appt?: Doc<'appointments'> | null
    reason?: string
    details?: unknown
  },
) {
  await ctx.db.insert('actionLog', {
    clinicId: a.clinicId,
    actorId: a.actor?._id ?? a.actor?.id,
    actorName: a.actor?.name ?? 'system',
    action: a.action,
    appointmentId: a.appt?._id,
    patientName: a.appt?.patientName,
    reason: a.reason,
    details: a.details ?? undefined,
  })
}

// ---------- live updates ----------
// Live screens subscribe to a version number; bumping it makes them refresh.
async function bump(ctx: MutationCtx, key: string) {
  const row = await ctx.db.query('queueVersions').withIndex('by_key', (q) => q.eq('key', key)).first()
  if (row) await ctx.db.patch(row._id, { version: row.version + 1 })
  else await ctx.db.insert('queueVersions', { key, version: 1 })
}
export async function queueChanged(ctx: MutationCtx, clinicId: Id<'clinics'>, departmentId: Id<'departments'>) {
  await bump(ctx, `clinic:${clinicId}`)
  await bump(ctx, `dept:${departmentId}`)
}
