// One-off setup run from the terminal (internal: the website cannot call it).
//   npx convex run setup:createAdmin '{"name":"Your Name","email":"you@example.com","password":"…"}'
import { v } from 'convex/values'
import { internalMutation } from './_generated/server'
import { cleanEmail, fail, hashSecret, text } from './lib/core'

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
