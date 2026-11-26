// The website's one door to the backend (Convex). Pages call api('/path', { method, body })
// exactly as they did with the old Express server; this file maps each call to a Convex
// function and turns Convex errors back into ApiError codes the screens already understand.
import { ConvexClient } from 'convex/browser'
import { ConvexError } from 'convex/values'
import { api as fns } from '../convex/_generated/api.js'

export class ApiError extends Error {
  constructor(code, status, extra = {}) {
    super(code)
    this.code = code
    this.status = status
    this.extra = extra
  }
}

const url = import.meta.env.VITE_CONVEX_URL
export const convex = url ? new ConvexClient(url) : null

export const getToken = () => {
  try { return localStorage.getItem('oma_token') } catch { return null }
}
export const setToken = (token) => {
  try {
    if (token) localStorage.setItem('oma_token', token)
    else {
      const old = localStorage.getItem('oma_token')
      localStorage.removeItem('oma_token')
      if (old && convex) convex.mutation(fns.auth.logout, { token: old }).catch(() => {})
    }
  } catch { /* ignore */ }
}

// HTTP-style status for each error code (a few screens look at e.status).
const STATUS = {
  not_found: 404, invalid_input: 400, invalid_phone: 400, invalid_date: 400, invalid_slot: 400, bad_code: 400, code_expired: 400,
  auth_required: 401, session_expired: 401, bad_credentials: 401, wrong_secret: 401, kolo_low: 402,
  forbidden: 403, account_disabled: 403, booking_blocked: 403, not_authorised_for_clinic: 403,
  too_many_requests: 429, account_locked: 429, reset_unavailable: 503,
}
const toApiError = (code, extra = {}) => new ApiError(code, STATUS[code] ?? 409, extra)

const num = (v) => (v == null || v === '' ? undefined : Number(v))
const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined))

// [method, path pattern, kind, function, args(match, body, query)]
const Q = 'query'
const M = 'mutation'
const ROUTES = [
  ['POST', /^\/auth\/register$/, M, fns.auth.register, (_, b) => b, false],
  ['POST', /^\/auth\/login$/, M, fns.auth.login, (_, b) => b, false],
  ['POST', /^\/auth\/work-login$/, M, fns.auth.workLogin, (_, b) => b, false],
  ['GET', /^\/auth\/me$/, Q, fns.auth.me, () => ({})],
  ['PATCH', /^\/auth\/me$/, M, fns.auth.updateMe, (_, b) => b],
  ['POST', /^\/auth\/change-secret$/, M, fns.auth.changeSecret, (_, b) => b],
  ['POST', /^\/auth\/forgot-pin$/, M, fns.auth.forgotPin, (_, b) => b, false],
  ['POST', /^\/auth\/reset-pin$/, M, fns.auth.resetPin, (_, b) => b, false],
  ['POST', /^\/auth\/delete-account$/, M, fns.auth.deleteAccount, (_, b) => b],
  ['POST', /^\/hospitals\/register$/, M, fns.patient.registerHospital, (_, b) => b, false],

  ['GET', /^\/family$/, Q, fns.patient.familyList, () => ({})],
  ['POST', /^\/family$/, M, fns.patient.familyAdd, (_, b) => b],
  ['PATCH', /^\/family\/([^/]+)$/, M, fns.patient.familyUpdate, (m, b) => ({ ...b, id: m[1] })],
  ['DELETE', /^\/family\/([^/]+)$/, M, fns.patient.familyRemove, (m) => ({ id: m[1] })],

  ['GET', /^\/kolo$/, Q, fns.patient.kolo, () => ({})],
  ['POST', /^\/kolo\/topup$/, M, fns.patient.koloTopUp, (_, b) => b],
  ['GET', /^\/kolo\/transactions$/, Q, fns.patient.koloTransactions, (_, __, q) => ({ limit: num(q.get('limit')) })],

  ['GET', /^\/clinics$/, Q, fns.patient.clinics, (_, __, q) => ({
    state: q.get('state') || undefined, area: q.get('area') || undefined,
    maxFee: num(q.get('maxFee')), lat: num(q.get('lat')), lng: num(q.get('lng')),
  }), false],
  ['GET', /^\/clinics\/locations$/, Q, fns.patient.locations, () => ({}), false],
  ['GET', /^\/services\/([^/]+)\/availability$/, Q, fns.patient.availability, (m) => ({ serviceId: m[1] }), false],
  ['GET', /^\/clinics\/([^/]+)$/, Q, fns.patient.clinic, (m) => ({ id: m[1] }), false],

  ['POST', /^\/appointments$/, M, fns.patient.book, (_, b) => b],
  ['GET', /^\/appointments$/, Q, fns.patient.visits, (_, __, q) => ({ scope: q.get('scope') || undefined })],
  ['GET', /^\/appointments\/([^/]+)$/, Q, fns.patient.visit, (m) => ({ id: m[1] })],
  ['POST', /^\/appointments\/([^/]+)\/cancel$/, M, fns.patient.cancelVisit, (m, b) => ({ id: m[1], confirm: b?.confirm })],
  ['PATCH', /^\/appointments\/([^/]+)\/alert$/, M, fns.patient.setVisitAlert, (m, b) => ({ id: m[1], alertAhead: b.alertAhead })],

  ['GET', /^\/staff\/clinic$/, Q, fns.hospital.staffClinic, () => ({})],
  ['GET', /^\/staff\/today$/, Q, fns.hospital.staffToday, (_, __, q) => ({ date: q.get('date') || undefined, departmentId: q.get('departmentId') || undefined })],
  ['GET', /^\/staff\/stats$/, Q, fns.hospital.staffStats, (_, __, q) => ({ date: q.get('date') || undefined })],
  ['GET', /^\/staff\/log$/, Q, fns.hospital.staffLog, (_, __, q) => ({ date: q.get('date') || undefined })],
  ['GET', /^\/staff\/noshows$/, Q, fns.hospital.staffNoShows, () => ({})],
  ['POST', /^\/staff\/appointments\/([^/]+)\/check-in$/, M, fns.hospital.checkIn, (m) => ({ id: m[1] })],
  ['POST', /^\/staff\/appointments\/([^/]+)\/call$/, M, fns.hospital.call, (m) => ({ id: m[1] })],
  ['POST', /^\/staff\/appointments\/([^/]+)\/seen$/, M, fns.hospital.seen, (m) => ({ id: m[1] })],
  ['POST', /^\/staff\/appointments\/([^/]+)\/no-show$/, M, fns.hospital.noShow, (m) => ({ id: m[1] })],
  ['POST', /^\/staff\/appointments\/([^/]+)\/move-to-front$/, M, fns.hospital.moveToFront, (m, b) => ({ id: m[1], reason: b.reason })],
  ['POST', /^\/staff\/appointments\/([^/]+)\/requeue$/, M, fns.hospital.requeue, (m) => ({ id: m[1] })],
  ['POST', /^\/staff\/departments\/([^/]+)\/call-next$/, M, fns.hospital.callNext, (m) => ({ departmentId: m[1] })],
  ['POST', /^\/staff\/walk-ins$/, M, fns.hospital.addWalkIn, (_, b) => b],
  ['PATCH', /^\/staff\/walk-ins\/([^/]+)$/, M, fns.hospital.setWalkInStatus, (m, b) => ({ id: m[1], status: b.status })],
  ['POST', /^\/staff\/cancel-day$/, M, fns.hospital.cancelDay, (_, b) => b ?? {}],

  ['GET', /^\/manager\/clinic$/, Q, fns.hospital.managerClinic, () => ({})],
  ['PATCH', /^\/manager\/clinic$/, M, fns.hospital.updateClinic, (_, b) => b],
  ['POST', /^\/manager\/departments$/, M, fns.hospital.addDepartment, (_, b) => b],
  ['PATCH', /^\/manager\/departments\/([^/]+)$/, M, fns.hospital.updateDepartment, (m, b) => ({ ...b, id: m[1] })],
  ['POST', /^\/manager\/departments\/([^/]+)\/services$/, M, fns.hospital.addService, (m, b) => ({ ...b, departmentId: m[1] })],
  ['PATCH', /^\/manager\/services\/([^/]+)$/, M, fns.hospital.updateService, (m, b) => ({ ...b, id: m[1] })],
  ['POST', /^\/manager\/staff$/, M, fns.hospital.addStaff, (_, b) => b],
  ['PATCH', /^\/manager\/staff\/([^/]+)$/, M, fns.hospital.setStaffActive, (m, b) => ({ id: m[1], active: b.active })],

  ['GET', /^\/admin\/clinics$/, Q, fns.hospital.adminClinics, (_, __, q) => ({ status: q.get('status') || undefined })],
  ['POST', /^\/admin\/clinics\/([^/]+)\/approve$/, M, fns.hospital.approveClinic, (m) => ({ id: m[1] })],
  ['PATCH', /^\/admin\/clinics\/([^/]+)$/, M, fns.hospital.adminUpdateClinic, (m, b) => ({ ...b, id: m[1] })],

  ['GET', /^\/public\/clinics\/([^/]+)\/now-serving$/, Q, fns.hospital.nowServing, (m) => ({ clinicId: m[1] }), false],
]

export async function api(path, { method = 'GET', body } = {}) {
  if (!convex) throw new ApiError('network', 0)
  const [p, qs] = path.split('?')
  const q = new URLSearchParams(qs ?? '')
  for (const [verb, re, kind, fn, toArgs, needsToken = true] of ROUTES) {
    const m = verb === method && p.match(re)
    if (!m) continue
    const args = clean({ ...toArgs(m, body ?? {}, q), ...(needsToken ? { token: getToken() ?? undefined } : {}) })
    let out
    try {
      out = kind === Q ? await convex.query(fn, args) : await convex.mutation(fn, args)
    } catch (e) {
      if (e instanceof ConvexError && e.data?.code) {
        const { code, ...extra } = e.data
        throw toApiError(code, extra)
      }
      throw new ApiError(navigator.onLine === false ? 'network' : 'server_error', 0)
    }
    // Sign-in style functions report failures as { error } so failed attempts are still recorded.
    if (out && typeof out === 'object' && typeof out.error === 'string') {
      const { error, ...extra } = out
      throw toApiError(error, extra)
    }
    return out ?? {}
  }
  throw new ApiError('not_found', 404)
}
