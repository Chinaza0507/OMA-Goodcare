import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

// ỌMA data. Money is whole naira. Dates are 'YYYY-MM-DD' and times 'HH:MM' in Nigerian
// time (Africa/Lagos, UTC+1 all year). Instants (arrivedAt, calledAt…) are milliseconds.
export const role = v.union(v.literal('patient'), v.literal('staff'), v.literal('manager'), v.literal('admin'))
export const CLINIC_TYPES = ['public', 'mission', 'private', 'school', 'dental', 'eye', 'specialist'] as const
export const clinicType = v.union(
  v.literal('public'), v.literal('mission'), v.literal('private'), v.literal('school'),
  v.literal('dental'), v.literal('eye'), v.literal('specialist'),
)
export const apptStatus = v.union(
  v.literal('booked'), v.literal('checked_in'), v.literal('called'),
  v.literal('seen'), v.literal('cancelled'), v.literal('no_show'),
)
export const depositStatus = v.union(
  v.literal('none'), v.literal('held'), v.literal('deducted'), v.literal('returned'), v.literal('forfeited'),
)

export default defineSchema({
  clinics: defineTable({
    name: v.string(),
    state: v.optional(v.string()),
    area: v.optional(v.string()),
    address: v.optional(v.string()),
    landmark: v.optional(v.string()),
    email: v.optional(v.string()),
    latitude: v.optional(v.number()),
    longitude: v.optional(v.number()),
    // New hospitals stay hidden from patients until a ỌMA admin approves them.
    status: v.union(v.literal('pending'), v.literal('approved')),
    type: clinicType,
    // paid: deposit is taken. covered: school clinic, no deposit, booking rule instead.
    billingType: v.union(v.literal('paid'), v.literal('covered')),
    paymentOption: v.union(v.literal('per_patient'), v.literal('monthly')),
    graceMinutes: v.number(),
    cancelWindowMinutes: v.number(),
    depositNaira: v.number(),
    active: v.boolean(),
    demo: v.optional(v.boolean()), // demo hospitals, removable in one go
  }).index('by_status', ['status']),

  // A department has ONE booking line: on its booking days and hours, one doctor sees the
  // online bookings in order. Walk-ins are seen separately and only logged (walkIns table).
  departments: defineTable({
    clinicId: v.id('clinics'),
    name: v.string(),
    bookingDays: v.array(v.number()), // 0 = Sunday … 6 = Saturday
    opensAt: v.string(), // booking hours, 'HH:MM'
    closesAt: v.string(),
    active: v.boolean(),
  }).index('by_clinic', ['clinicId']),

  // What a patient can book in a department, how long it takes and (optionally) what it costs.
  services: defineTable({
    clinicId: v.id('clinics'),
    departmentId: v.id('departments'),
    name: v.string(),
    minutes: v.number(),
    price: v.union(v.number(), v.null()), // null = price at hospital
    active: v.boolean(),
  }).index('by_department', ['departmentId']).index('by_clinic', ['clinicId']),

  // Walk-ins: logged by the front desk so the day's numbers are complete. They are seen by
  // another doctor and never enter the online booking line.
  walkIns: defineTable({
    clinicId: v.id('clinics'),
    departmentId: v.id('departments'),
    date: v.string(),
    number: v.number(),
    name: v.string(),
    phone: v.optional(v.string()),
    note: v.optional(v.string()),
    status: v.union(v.literal('waiting'), v.literal('seen'), v.literal('left')),
    finishedAt: v.optional(v.number()),
  }).index('by_clinic_date', ['clinicId', 'date']).index('by_dept_date', ['departmentId', 'date']),

  users: defineTable({
    role,
    name: v.string(),
    phone: v.optional(v.string()), // patients: +234XXXXXXXXXX
    email: v.optional(v.string()), // lower-case; hospital, staff and admin sign-in
    secretHash: v.string(), // patients: 4-digit PIN; others: password
    language: v.string(),
    alertAhead: v.number(),
    clinicId: v.optional(v.id('clinics')),
    active: v.boolean(),
    consentAt: v.optional(v.number()),
    failedAttempts: v.number(),
    lockedUntil: v.optional(v.number()),
  })
    .index('by_phone', ['phone'])
    .index('by_email', ['email'])
    .index('by_clinic', ['clinicId']),

  // Sign-in sessions. Only a hash of the token is stored.
  sessions: defineTable({
    userId: v.id('users'),
    tokenHash: v.string(),
    expiresAt: v.number(),
  }).index('by_token', ['tokenHash']).index('by_user', ['userId']),

  familyMembers: defineTable({
    ownerId: v.id('users'),
    name: v.string(),
    age: v.optional(v.number()),
    isSelf: v.boolean(),
  }).index('by_owner', ['ownerId']),

  koloWallets: defineTable({
    userId: v.id('users'),
    available: v.number(),
    reserved: v.number(),
  }).index('by_user', ['userId']),

  // Append-only: nothing in the code edits or deletes these rows.
  koloTransactions: defineTable({
    userId: v.id('users'),
    type: v.union(v.literal('topup'), v.literal('hold'), v.literal('deduct'), v.literal('refund'), v.literal('forfeit')),
    amount: v.number(),
    appointmentId: v.optional(v.id('appointments')),
    availableAfter: v.number(),
    reservedAfter: v.number(),
  }).index('by_user', ['userId']),

  // An online booking. Its length comes from the service chosen.
  appointments: defineTable({
    clinicId: v.id('clinics'),
    departmentId: v.id('departments'),
    serviceId: v.id('services'),
    serviceName: v.string(),
    minutes: v.number(),
    familyMemberId: v.optional(v.id('familyMembers')),
    bookedBy: v.id('users'),
    patientName: v.string(),
    date: v.string(),
    time: v.string(), // start of the booked slot, 'HH:MM'
    queueNumber: v.number(),
    status: apptStatus,
    depositNaira: v.number(),
    depositStatus,
    frontRank: v.number(), // lower goes first; "move to front" lowers it
    alertAhead: v.number(),
    arrivedAt: v.optional(v.number()),
    calledAt: v.optional(v.number()),
    finishedAt: v.optional(v.number()),
    cancelledAt: v.optional(v.number()),
    cancelledBy: v.optional(v.union(v.literal('patient'), v.literal('clinic'))),
  })
    .index('by_dept_date', ['departmentId', 'date'])
    .index('by_clinic_date', ['clinicId', 'date'])
    .index('by_booked_by', ['bookedBy'])
    .index('by_member', ['familyMemberId']),

  // School clinics: first no-show warns, second blocks booking for 7 days.
  noshowTracking: defineTable({
    userId: v.id('users'),
    clinicId: v.id('clinics'),
    missCount: v.number(),
    blockedUntil: v.optional(v.number()),
  }).index('by_user_clinic', ['userId', 'clinicId']).index('by_clinic', ['clinicId']),

  // Append-only action log.
  actionLog: defineTable({
    clinicId: v.id('clinics'),
    actorId: v.optional(v.id('users')),
    actorName: v.string(),
    action: v.string(),
    appointmentId: v.optional(v.id('appointments')),
    patientName: v.optional(v.string()),
    reason: v.optional(v.string()),
    details: v.optional(v.any()),
  }).index('by_clinic', ['clinicId']),

  // "Forgot PIN" codes: stored hashed, 10 minutes, 5 tries, single use.
  pinResets: defineTable({
    userId: v.id('users'),
    codeHash: v.string(),
    expiresAt: v.number(),
    attempts: v.number(),
    usedAt: v.optional(v.number()),
  }).index('by_user', ['userId']),

  // Bumped whenever a queue changes, so live screens know to refresh.
  queueVersions: defineTable({
    key: v.string(), // 'clinic:<id>' or 'dept:<id>'
    version: v.number(),
  }).index('by_key', ['key']),
})
