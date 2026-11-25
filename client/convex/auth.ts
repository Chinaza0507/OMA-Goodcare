// Sign-up, sign-in, profile, PIN/password changes, forgot PIN and account deletion.
// Failed sign-ins must still record the failed attempt, and a thrown error would undo
// that write, so those functions return { error } instead of throwing.
import { v } from 'convex/values'
import { mutation, query } from './_generated/server'
import type { Doc } from './_generated/dataModel'
import {
  cleanEmail, createSession, fail, getUser, hashSecret, int, normalizePhone, publicUser, queueChanged,
  randomHex, randomInt, sha256, text, verifySecret,
} from './lib/core'
import { cancelAppointment } from './lib/rules'

const LANGUAGES = ['en', 'pcm', 'yo', 'ig', 'ha']
const MAX_FAILED_ATTEMPTS = 5
const LOCK_MINUTES = 15
const tokenArg = { token: v.optional(v.string()) }

const phoneOrFail = (p: string) => normalizePhone(p) ?? fail('invalid_phone')

export const register = mutation({
  args: { name: v.string(), phone: v.string(), email: v.optional(v.string()), pin: v.string(), language: v.optional(v.string()), consent: v.boolean() },
  handler: async (ctx, a) => {
    const name = text(a.name, 2, 100, 'name')
    const phone = phoneOrFail(a.phone)
    if (!/^\d{4}$/.test(a.pin)) fail('invalid_input', { field: 'pin' })
    if (a.consent !== true) fail('invalid_input', { field: 'consent' }) // NDPA consent is required at sign-up
    const language = a.language && LANGUAGES.includes(a.language) ? a.language : 'en'
    const email = a.email ? cleanEmail(a.email) : undefined
    if (await ctx.db.query('users').withIndex('by_phone', (q) => q.eq('phone', phone)).first()) fail('phone_taken')

    const id = await ctx.db.insert('users', {
      role: 'patient', name, phone, email, secretHash: await hashSecret(a.pin), language,
      alertAhead: 2, active: true, consentAt: Date.now(), failedAttempts: 0,
    })
    // Everyone starts as their own "family member", so booking for yourself and for family work the same way.
    await ctx.db.insert('familyMembers', { ownerId: id, name, isSelf: true })
    const user = (await ctx.db.get(id))!
    return { token: await createSession(ctx, id), user: publicUser(user) }
  },
})

// Shared by both sign-ins: lockout after repeated failures, and the same error whether or not
// the account exists, so accounts cannot be probed.
async function signIn(ctx: Parameters<typeof createSession>[0], user: Doc<'users'> | null, secret: string) {
  if (user && !user.active) return { error: 'account_disabled' }
  if (user?.lockedUntil && user.lockedUntil > Date.now()) return { error: 'account_locked', until: new Date(user.lockedUntil).toISOString() }

  const ok = user ? await verifySecret(secret, user.secretHash) : (await hashSecret(secret), false)
  if (!user || !ok) {
    if (user) {
      const attempts = user.failedAttempts + 1
      const lock = attempts >= MAX_FAILED_ATTEMPTS
      await ctx.db.patch(user._id, { failedAttempts: lock ? 0 : attempts, ...(lock ? { lockedUntil: Date.now() + LOCK_MINUTES * 60_000 } : {}) })
    }
    return { error: 'bad_credentials' }
  }
  if (user.failedAttempts > 0 || user.lockedUntil) await ctx.db.patch(user._id, { failedAttempts: 0, lockedUntil: undefined })
  return { token: await createSession(ctx, user._id), user: publicUser(user) }
}

// Patients: phone number + 4-digit PIN.
export const login = mutation({
  args: { phone: v.string(), secret: v.string() },
  handler: async (ctx, a) => {
    const phone = normalizePhone(a.phone)
    if (!phone) return { error: 'invalid_phone' }
    const user = await ctx.db.query('users').withIndex('by_phone', (q) => q.eq('phone', phone)).first()
    return signIn(ctx, user?.role === 'patient' ? user : null, a.secret.slice(0, 72))
  },
})

// Hospitals (front desk), staff and ỌMA admins: official email + password.
export const workLogin = mutation({
  args: { email: v.string(), password: v.string() },
  handler: async (ctx, a) => {
    const email = a.email.trim().toLowerCase()
    const user = (await ctx.db.query('users').withIndex('by_email', (q) => q.eq('email', email)).collect()).find((u) => u.role !== 'patient') ?? null
    const result = await signIn(ctx, user, a.password.slice(0, 72))
    if ('error' in result) return result
    const clinic = user?.clinicId ? await ctx.db.get(user.clinicId) : null
    return { ...result, clinic: clinic ? { id: clinic._id, name: clinic.name, status: clinic.status } : null }
  },
})

export const logout = mutation({
  args: tokenArg,
  handler: async (ctx, { token }) => {
    if (!token) return { ok: true }
    const tokenHash = await sha256(token)
    const s = await ctx.db.query('sessions').withIndex('by_token', (q) => q.eq('tokenHash', tokenHash)).first()
    if (s) await ctx.db.delete(s._id)
    return { ok: true }
  },
})

export const me = query({
  args: tokenArg,
  handler: async (ctx, { token }) => {
    const user = await getUser(ctx, token)
    // School-clinic booking rule: surfaces the first-miss warning and any active block.
    const tracking = []
    if (user.role === 'patient') {
      const rows = await ctx.db.query('noshowTracking').withIndex('by_user_clinic', (q) => q.eq('userId', user._id)).collect()
      for (const t of rows) {
        if (t.missCount > 0 || (t.blockedUntil ?? 0) > Date.now()) {
          const c = await ctx.db.get(t.clinicId)
          tracking.push({
            clinicId: t.clinicId, clinicName: c?.name ?? '', missCount: t.missCount,
            blockedUntil: t.blockedUntil && t.blockedUntil > Date.now() ? new Date(t.blockedUntil).toISOString() : null,
          })
        }
      }
    }
    const clinic = user.clinicId ? await ctx.db.get(user.clinicId) : null
    return { user: publicUser(user), clinic: clinic ? { id: clinic._id, name: clinic.name, status: clinic.status } : null, noShowStatus: tracking }
  },
})

export const updateMe = mutation({
  args: { ...tokenArg, name: v.optional(v.string()), language: v.optional(v.string()), alertAhead: v.optional(v.number()), email: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const user = await getUser(ctx, a.token)
    const patch: Partial<Doc<'users'>> = {}
    if (a.name !== undefined) patch.name = text(a.name, 2, 100, 'name')
    if (a.language !== undefined) {
      if (!LANGUAGES.includes(a.language)) fail('invalid_input', { field: 'language' })
      patch.language = a.language
    }
    if (a.alertAhead !== undefined) patch.alertAhead = int(a.alertAhead, 1, 10, 'alertAhead')
    // Patients may add, change or clear their email (''). Hospital/staff emails are their log-in.
    if (a.email !== undefined) {
      if (user.role !== 'patient') fail('forbidden')
      patch.email = a.email === '' ? undefined : cleanEmail(a.email)
    }
    await ctx.db.patch(user._id, patch)
    // Keep the "self" family member's name in step, so new bookings use the new name.
    if (patch.name) {
      const self = (await ctx.db.query('familyMembers').withIndex('by_owner', (q) => q.eq('ownerId', user._id)).collect()).find((m) => m.isSelf)
      if (self) await ctx.db.patch(self._id, { name: patch.name })
    }
    return { user: publicUser((await ctx.db.get(user._id))!) }
  },
})

// Change PIN (patients: 4 digits) or password (staff/hospital/admin: 8+ characters).
export const changeSecret = mutation({
  args: { ...tokenArg, current: v.string(), next: v.string() },
  handler: async (ctx, a) => {
    const user = await getUser(ctx, a.token)
    const valid = user.role === 'patient' ? /^\d{4}$/.test(a.next) : a.next.length >= 8 && a.next.length <= 72
    if (!valid) fail('invalid_input')
    if (!(await verifySecret(a.current, user.secretHash))) fail('wrong_secret')
    await ctx.db.patch(user._id, { secretHash: await hashSecret(a.next) })
    return { ok: true }
  },
})

// ----- Forgot PIN (patients) -----
// No SMS provider is connected yet. With OMA_PRACTICE_CODES=on (practice deployments only)
// the code is shown on screen; otherwise the request is refused until SMS is connected.
const RESET_MINUTES = 10
const RESET_TRIES = 5
const practiceCodes = () => process.env.OMA_PRACTICE_CODES === 'on'

export const forgotPin = mutation({
  args: { phone: v.string() },
  handler: async (ctx, a) => {
    const phone = phoneOrFail(a.phone)
    if (!practiceCodes()) fail('reset_unavailable')
    const user = await ctx.db.query('users').withIndex('by_phone', (q) => q.eq('phone', phone)).first()
    let code: string | null = null
    if (user && user.role === 'patient' && user.active) {
      const open = await ctx.db.query('pinResets').withIndex('by_user', (q) => q.eq('userId', user._id)).collect()
      // At most 5 codes an hour per number.
      if (open.filter((r) => r._creationTime > Date.now() - 3_600_000).length >= 5) fail('too_many_requests')
      for (const r of open) if (!r.usedAt) await ctx.db.patch(r._id, { usedAt: Date.now() })
      code = String(randomInt(100000, 1000000))
      await ctx.db.insert('pinResets', { userId: user._id, codeHash: await hashSecret(code), expiresAt: Date.now() + RESET_MINUTES * 60_000, attempts: 0 })
    }
    // Same answer whether or not the number has an account, so numbers can't be probed.
    return { ok: true, minutes: RESET_MINUTES, ...(code ? { practiceCode: code } : {}) }
  },
})

export const resetPin = mutation({
  args: { phone: v.string(), code: v.string(), pin: v.string() },
  handler: async (ctx, a) => {
    const phone = normalizePhone(a.phone)
    if (!phone || !/^\d{6}$/.test(a.code) || !/^\d{4}$/.test(a.pin)) return { error: 'invalid_input' }
    const user = await ctx.db.query('users').withIndex('by_phone', (q) => q.eq('phone', phone)).first()
    const resets = user ? await ctx.db.query('pinResets').withIndex('by_user', (q) => q.eq('userId', user._id)).order('desc').take(1) : []
    const reset = resets[0]
    if (!user || user.role !== 'patient' || !user.active || !reset || reset.usedAt || reset.expiresAt < Date.now() || reset.attempts >= RESET_TRIES) {
      return { error: 'code_expired' }
    }
    if (!(await verifySecret(a.code, reset.codeHash))) {
      await ctx.db.patch(reset._id, { attempts: reset.attempts + 1 })
      return { error: 'bad_code', triesLeft: RESET_TRIES - reset.attempts - 1 }
    }
    await ctx.db.patch(reset._id, { usedAt: Date.now() })
    await ctx.db.patch(user._id, { secretHash: await hashSecret(a.pin), failedAttempts: 0, lockedUntil: undefined })
    return { ok: true }
  },
})

// Delete my account (patients). Upcoming visits are cancelled under the normal rules and the
// person's name, phone and email are erased. Hospital visit records stay, with the name replaced,
// because hospitals must keep attendance records. The Kolo history is append-only and stays.
export const deleteAccount = mutation({
  args: { ...tokenArg, secret: v.string() },
  handler: async (ctx, a) => {
    const user = await getUser(ctx, a.token)
    if (user.role !== 'patient') fail('forbidden')
    if (!(await verifySecret(a.secret, user.secretHash))) fail('wrong_secret')

    const visits = await ctx.db.query('appointments').withIndex('by_booked_by', (q) => q.eq('bookedBy', user._id)).collect()
    for (const v of visits) {
      if (v.status === 'booked') {
        const r = await cancelAppointment(ctx, { appointmentId: v._id, userId: user._id, confirm: true })
        await queueChanged(ctx, r.clinicId, r.departmentId)
      }
      await ctx.db.patch(v._id, { patientName: 'Deleted patient' })
    }
    for (const m of await ctx.db.query('familyMembers').withIndex('by_owner', (q) => q.eq('ownerId', user._id)).collect()) {
      await ctx.db.patch(m._id, { name: 'Deleted', age: undefined })
    }
    for (const s of await ctx.db.query('sessions').withIndex('by_user', (q) => q.eq('userId', user._id)).collect()) await ctx.db.delete(s._id)
    await ctx.db.patch(user._id, {
      name: 'Deleted account', phone: `deleted:${user._id}`, email: undefined,
      secretHash: await hashSecret(randomHex(24)), active: false,
    })
    return { ok: true }
  },
})
