import { showLive, showNotification } from '../lib/notify.js'
import { playAlert, stopAlert } from '../lib/sounds.js'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { connectSocket, pollEvery } from '../lib/socket.js'
import { gsap } from 'gsap'
import { useGSAP } from '@gsap/react'
import PatientShell, { Icon } from '../components/PatientShell.jsx'
import NotificationsBell from '../components/NotificationsBell.jsx'
import NearbyHospitals from '../components/NearbyHospitals.jsx'
import VisitSheet from '../components/VisitSheet.jsx'
import { api } from '../api.js'
import { useAuth } from '../auth.jsx'
import { useT } from '../i18n/index.jsx'

gsap.registerPlugin(useGSAP)

const LAGOS = 'Africa/Lagos'
const lagosHour = () => Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: LAGOS }).format(new Date()))
const naira = (n) => `₦${Number(n || 0).toLocaleString('en-NG')}`
const ordinal = (n) => {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`
}
// "14:30" -> "2:30 pm"
const clock = (hhmm) => {
  if (!hhmm) return ''
  const [h, m] = hhmm.split(':').map(Number)
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`
}
const dayLabel = (iso, lang) =>
  new Intl.DateTimeFormat(lang === 'pcm' ? 'en-NG' : 'en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`))
const initials = (name) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('')

// Today's date and the current time in Lagos, ticking every minute.
function TodayClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    // Line up with the start of the next minute, then tick each minute.
    let id
    const first = setTimeout(() => { setNow(new Date()); id = setInterval(() => setNow(new Date()), 60_000) }, 60_000 - (Date.now() % 60_000))
    return () => { clearTimeout(first); clearInterval(id) }
  }, [])
  const date = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: LAGOS }).format(now)
  const time = new Intl.DateTimeFormat('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: LAGOS }).format(now).replace(' ', '\u00a0')
  return (
    <p className="m-0 mt-1.5 flex flex-wrap items-center gap-x-2 text-[14px] font-medium text-muted">
      <span>{date}</span>
      <span aria-hidden="true" className="h-1 w-1 rounded-full bg-[#cdb9c6]" />
      <time dateTime={now.toISOString()} className="font-semibold text-ink">{time}</time>
    </p>
  )
}

// How many people were ahead when this ticket was first seen, so the bar can show progress.
const startKey = (id) => `oma_start_${id}`
function rememberStart(appts) {
  for (const a of appts) {
    if (!a.queue) continue
    try {
      const prev = Number(localStorage.getItem(startKey(a.id)))
      if (!prev || a.queue.ahead > prev) localStorage.setItem(startKey(a.id), String(a.queue.ahead))
    } catch { /* private mode */ }
  }
}
const startAhead = (a) => { try { return Math.max(Number(localStorage.getItem(startKey(a.id))) || 0, a.queue.ahead) } catch { return a.queue.ahead } }
const fill = (s, vars) => Object.entries(vars).reduce((out, [k, v]) => out.replaceAll(`{${k}}`, v), s)

// Counts up (or down) to a number; jumps straight there when motion is reduced.
function CountUp({ value, format = (n) => n }) {
  const ref = useRef(null)
  const last = useRef(0)
  useGSAP(() => {
    const el = ref.current
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const obj = { n: last.current }
    last.current = value
    if (reduce) { el.textContent = format(value); return }
    gsap.to(obj, { n: value, duration: 0.9, ease: 'power2.out', onUpdate: () => { el.textContent = format(Math.round(obj.n)) } })
  }, { dependencies: [value] })
  return <span ref={ref}>{format(value)}</span>
}

// A short chime + vibration for the "turn is close" alert (where the device allows it).
function nudge() {
  // Browsers only allow vibration after the person has tapped the page.
  try { if (navigator.userActivation?.hasBeenActive) navigator.vibrate?.([200, 100, 200]) } catch { /* not supported */ }
  playAlert() // plays for 30 seconds; "Stop sound" on the banner ends it early
}

// Progress along today's queue: from "Now serving" to your number.
function QueueProgress({ a, serving, t }) {
  const start = startAhead(a)
  const ahead = a.queue.ahead
  const pct = start > 0 ? 0.08 + 0.84 * ((start - ahead) / start) : 0.92
  const bar = useRef(null)
  useGSAP(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    gsap.to(bar.current, { width: `${Math.round(pct * 100)}%`, duration: reduce ? 0 : 0.9, ease: 'power3.out' })
  }, { dependencies: [pct] })
  return (
    <div className="relative mt-6">
      <div className="mb-2 flex items-end justify-between gap-3 text-[13px]">
        <span className="text-rose-tint">{t('dash.nowServing')} <b className="font-display text-[15px] text-white">{serving ? `#${serving}` : '—'}</b></span>
        <span className="text-rose-tint">{t('dash.yourNumber')} <b className="font-display text-[15px] text-white">#{a.queueNumber}</b></span>
      </div>
      <div className="relative h-3 rounded-full bg-white/20" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct * 100)}
        aria-label={fill(t('dash.aheadOfYou'), { n: ahead })}>
        <div ref={bar} className="relative h-full w-[8%] rounded-full bg-white">
          <span className="absolute -right-1.5 top-1/2 h-5 w-5 -translate-y-1/2 rounded-full border-[3px] border-rose bg-white shadow-[0_0_0_4px_rgba(255,255,255,0.25)]" />
        </div>
      </div>
      {ahead > 0 && <div className="mt-2 text-[13px] text-rose-tint">{fill(t('dash.aheadOfYou'), { n: ahead })}</div>}
    </div>
  )
}

function Ticket({ a, serving, t, onDetails }) {
  const q = a.queue
  const called = a.status === 'called'
  const checkedIn = a.status === 'checked_in'
  return (
    <section aria-label={t('dash.liveQueue')} className="dash-in relative overflow-hidden rounded-[28px] bg-rose p-6 text-white shadow-[0_24px_50px_rgba(140,29,82,0.28)] sm:p-7">
      <div aria-hidden="true" className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-white/[0.06]" />
      <div aria-hidden="true" className="pointer-events-none absolute -bottom-24 right-24 h-48 w-48 rounded-full bg-white/[0.05]" />

      <div className="relative flex items-center justify-between">
        <span className="flex items-center gap-2 text-[13px] font-semibold uppercase tracking-[0.06em] text-rose-tint">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-60 motion-reduce:animate-none" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-white" />
          </span>
          {t('dash.liveQueue')}
        </span>
        <span className="rounded-full bg-white/[0.18] px-3 py-1 font-display text-sm font-bold">#{a.queueNumber}</span>
      </div>

      <div className="relative mt-4">
        <div className="text-lg font-bold">{a.patientName} · {a.serviceName}</div>
        <div className="mt-0.5 text-sm text-rose-tint">{a.departmentName}, {a.clinicName}</div>
      </div>

      {called ? (
        <div className="relative mt-6">
          <div className="font-display text-4xl font-extrabold leading-tight sm:text-5xl">{t('dash.yourTurn')}</div>
          <div className="mt-2 text-base text-rose-tint">{t('dash.yourTurnBody')}</div>
        </div>
      ) : (
        <div className="relative mt-6 flex items-end gap-8">
          <div>
            <div className="font-display text-5xl font-extrabold leading-none">
              {q.ahead === 0 ? t('dash.youreNext') : <CountUp value={q.ahead + 1} format={ordinal} />}
            </div>
            {q.ahead > 0 && <div className="mt-1.5 text-sm text-rose-tint">{t('dash.inLine')}</div>}
          </div>
          {q.ahead > 0 && (
            <div>
              <div className="font-display text-5xl font-extrabold leading-none">
                <CountUp value={q.waitMinutes} /><span className="ml-1 text-lg">{t('dash.min')}</span>
              </div>
              <div className="mt-1.5 text-sm text-rose-tint">{t('dash.about')}</div>
            </div>
          )}
        </div>
      )}

      {!called && <QueueProgress a={a} serving={serving} t={t} />}

      {!called && q.delayMinutes >= 10 && (
        <div role="status" className="relative mt-4 rounded-2xl bg-white/[0.14] px-4 py-3 text-[15px]">
          {fill(t('dash.runningLate'), { n: q.delayMinutes, time: clock(q.estimatedFrom) })}
        </div>
      )}

      {!called && (
        <div className="relative mt-6 grid gap-2.5 sm:grid-cols-2">
          <div className="flex items-center gap-2.5 rounded-2xl bg-white/[0.12] px-4 py-3 text-[15px]">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
            {checkedIn ? <strong>{t('dash.checkedIn')}</strong> : <span>{t('dash.beThereBy')} <strong>{clock(a.time)}</strong></span>}
          </div>
          <div className="rounded-2xl bg-white px-4 py-3 text-[15px] font-semibold text-plum-deep">
            {t('dash.estimated')} <span className="whitespace-nowrap">{clock(q.estimatedFrom)}–{clock(q.estimatedTo)}</span>
          </div>
        </div>
      )}
      <div className="relative mt-4 flex items-center justify-between gap-3">
        <span className="text-xs text-rose-tint">{t('dash.live')}</span>
        <button type="button" onClick={onDetails} className="cursor-pointer rounded-full border border-white/40 bg-white/10 px-3.5 py-1.5 text-[13px] font-semibold text-white hover:bg-white/20">{t('visit.title')}</button>
      </div>
    </section>
  )
}

export default function Home() {
  const { t, lang } = useT()
  const { user, checking } = useAuth()
  const [data, setData] = useState(null) // { appts, kolo, family }
  const [error, setError] = useState(false)
  const scope = useRef(null)
  const alerted = useRef(new Set())
  const [openVisit, setOpenVisit] = useState(null)
  const [toast, setToast] = useState('')

  const load = useCallback(async () => {
    try {
      const [a, k, f, h] = await Promise.all([
        api('/appointments?scope=upcoming'), api('/kolo'), api('/family'), api('/kolo/transactions?limit=20'),
      ])
      rememberStart(a.appointments)
      const liveAppt = a.appointments.find((x) => x.queue)
      let serving = null
      if (liveAppt) {
        const ns = await api(`/public/clinics/${liveAppt.clinicId}/now-serving`).catch(() => null)
        serving = ns?.departments.find((d) => d.departmentId === liveAppt.departmentId)?.nowServing?.queueNumber ?? null
      }
      setData({ appts: a.appointments, kolo: k, family: f.members, history: h.transactions, serving })
      setError(false)
    } catch {
      setError(true)
    }
  }, [])

  const isPatient = user?.role === 'patient'
  useEffect(() => { if (isPatient) load() }, [isPatient, load])

  const live = data?.appts.find((a) => a.queue) ?? null
  const later = data ? data.appts.filter((a) => a !== live) : []

  // Live updates: join the department's room; refetch when the front desk moves the queue.
  // A slow poll is the safety net if the connection drops.
  const liveDept = live?.departmentId
  useEffect(() => {
    if (!liveDept) return
    const socket = connectSocket()
    socket.on('connect', () => socket.emit('join', { departmentId: liveDept }))
    socket.on('queue:changed', load)
    const poll = setInterval(load, pollEvery(30_000))
    return () => { socket.disconnect(); clearInterval(poll) }
  }, [liveDept, load])

  useEffect(() => () => stopAlert(), [])
  const [ringing, setRinging] = useState(false)
  const turnClose = live && live.queue.alertNow && live.status !== 'called'
  // Live queue updates (if turned on in Profile): keep one notification showing your place.
  const liveKey = live ? `${live.status}:${live.queue.ahead}:${live.queue.estimatedFrom}` : ''
  useEffect(() => {
    if (!live) return
    showLive(`${live.patientName} · #${live.queueNumber}`, live.status === 'called' ? t('notif.yourTurn')
      : fill(t('notif.liveBody'), { n: live.queue.ahead, time: clock(live.queue.estimatedFrom) }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveKey])
  useEffect(() => {
    if ((turnClose || live?.status === 'called') && !alerted.current.has(`${live.id}:${live.status}`)) {
      alerted.current.add(`${live.id}:${live.status}`)
      nudge()
      setRinging(true)
      setTimeout(() => setRinging(false), 31_000)
      if (live.status === 'called') showNotification(t('notif.yourTurn'), fill(t('notif.yourTurnBody'), { name: live.patientName }))
      else showNotification(t('notif.turnClose'), fill(t('notif.turnCloseBody'), { name: live.patientName, dept: live.departmentName }))
    }
  }, [turnClose, live, t])

  useGSAP(() => {
    // Skip when the tab is in the background (browsers pause animations there) so nothing stays hidden.
    if (!data || document.hidden) return
    const mm = gsap.matchMedia()
    mm.add('(prefers-reduced-motion: no-preference)', () => {
      gsap.from('.dash-in', { y: 22, opacity: 0, duration: 0.7, stagger: 0.08, ease: 'power3.out' })
    })
    // Safety net: if the browser throttles animations, make sure everything is visible anyway.
    const safety = setTimeout(() => {
      const els = scope.current?.querySelectorAll('.dash-in') ?? []
      gsap.killTweensOf(els)
      gsap.set(els, { clearProps: 'opacity,transform' })
    }, 2000)
    return () => { clearTimeout(safety); mm.revert() }
  }, { scope, dependencies: [!!data] })

  const notifications = []
  if (data) {
    if (live?.status === 'called') {
      notifications.push({ key: `${live.id}:called`, live: true, time: new Date(), kind: 'turn', title: t('notif.yourTurn'), body: fill(t('notif.yourTurnBody'), { name: live.patientName }) })
    } else if (turnClose) {
      notifications.push({ key: `${live.id}:close`, live: true, time: new Date(), kind: 'alert', title: t('notif.turnClose'), body: fill(t('notif.turnCloseBody'), { name: live.patientName, dept: live.departmentName }) })
    }
    for (const tx of data.history) {
      const v = tx.appointment
      const vars = v ? { name: v.patientName, dept: v.departmentName, clinic: v.clinicName } : {}
      const base = { key: tx.id, time: new Date(tx.createdAt) }
      if (tx.type === 'topup') notifications.push({ ...base, kind: 'money', title: fill(t('notif.topup'), { amount: naira(tx.amount) }) })
      else if (tx.type === 'hold') notifications.push({ ...base, kind: 'booked', title: t('notif.hold'), body: fill(t('notif.holdBody'), vars) })
      else if (tx.type === 'deduct') notifications.push({ ...base, kind: 'money', title: t('notif.deduct'), body: fill(t('notif.visitLine'), vars) })
      else if (tx.type === 'refund') notifications.push({ ...base, kind: 'returned', title: t('notif.refund'), body: v && fill(t('notif.visitLine'), vars) })
      else if (tx.type === 'forfeit') notifications.push({ ...base, kind: 'kept', title: t('notif.forfeit'), body: fill(t('notif.forfeitBody'), vars) })
    }
  }

  if (checking) return null
  if (!user) return <Navigate to="/login" replace />
  if (!isPatient) return <Navigate to={user.role === 'admin' ? '/admin' : '/hospital/home'} replace />

  const hour = lagosHour()
  const greeting = hour < 12 ? t('dash.morning') : hour < 17 ? t('dash.afternoon') : t('dash.evening')

  return (
    <PatientShell>
      <div ref={scope} className="flex flex-col gap-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="m-0 text-[15px] text-muted">{greeting}</p>
            <h1 className="m-0 mt-0.5 text-[30px] font-extrabold leading-tight sm:text-[34px]">{user.name.split(' ')[0]}</h1>
            <TodayClock />
          </div>
          <NotificationsBell items={notifications} t={t} />
        </div>

        {turnClose && (
          <div role="alert" className="dash-in flex items-center gap-3 rounded-2xl border border-rose-line bg-blush px-4 py-3.5 text-rose">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-rose text-white">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10 21a2 2 0 0 0 4 0" /></svg>
            </span>
            <span className="flex-1"><b className="block text-[16px]">{t('dash.turnClose')}</b><span className="text-sm text-ink">{t('dash.turnCloseBody')}</span></span>
            {ringing && (
              <button type="button" onClick={() => { stopAlert(); setRinging(false) }} className="min-h-10 shrink-0 cursor-pointer rounded-xl border-0 bg-rose px-3.5 text-sm font-bold text-white hover:bg-rose-dark">{t('dash.stopSound')}</button>
            )}
          </div>
        )}

        {error && !data && (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-white px-5 py-4">
            <span className="text-[15px] text-muted">{t('dash.loadError')}</span>
            <button type="button" onClick={load} className="min-h-11 cursor-pointer rounded-xl border-0 bg-plum px-5 font-bold text-white">{t('dash.retry')}</button>
          </div>
        )}

        {!data && !error && (
          <div aria-hidden="true" className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="h-[300px] animate-pulse rounded-[28px] bg-[#efe7ec]" />
            <div className="hidden h-[300px] animate-pulse rounded-[24px] bg-[#efe7ec] lg:block" />
          </div>
        )}

        {data && (
          <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
            {/* Main column */}
            <div className="flex flex-col gap-5">
              {live ? (
                <Ticket a={live} serving={data.serving} t={t} onDetails={() => setOpenVisit(live)} />
              ) : (
                <section className="dash-in rounded-[28px] border-[1.5px] border-dashed border-rose-line bg-white/60 px-6 py-8 text-center">
                  <h2 className="m-0 text-xl font-bold">{t('dash.noVisit')}</h2>
                  <p className="mx-auto mb-0 mt-1.5 max-w-sm text-[15px] text-muted">{t('dash.noVisitBody')}</p>
                </section>
              )}

              <div className="dash-in grid grid-cols-2 gap-3">
                <Link to="/book" className="flex min-h-14 items-center justify-center gap-2 rounded-2xl bg-plum text-base font-bold !text-white no-underline transition-transform hover:-translate-y-0.5 hover:bg-plum-dark">
                  <Icon name="book" size={20} />{t('dash.book')}
                </Link>
                <Link to="/family" className="flex min-h-14 items-center justify-center gap-2 rounded-2xl border-[1.5px] border-plum text-base font-bold text-plum no-underline transition-transform hover:-translate-y-0.5 hover:bg-blush">
                  <Icon name="family" size={20} />{t('dash.family')}
                </Link>
              </div>

              <NearbyHospitals t={t} />

              {later.length > 0 && (
                <section className="dash-in rounded-[24px] border border-line bg-white p-5">
                  <h2 className="m-0 mb-3 text-base font-bold">{live ? t('dash.upcoming') : t('dash.nextVisit')}</h2>
                  <ul className="m-0 flex list-none flex-col divide-y divide-line p-0">
                    {later.slice(0, 3).map((a) => (
                      <li key={a.id} className="py-3 first:pt-0 last:pb-0">
                        <button type="button" onClick={() => setOpenVisit(a)} className="flex w-full cursor-pointer items-center gap-4 rounded-xl border-0 bg-transparent p-0 text-left font-[inherit] text-ink hover:bg-plum-faint">
                        <span className="flex w-14 shrink-0 flex-col items-center rounded-xl bg-blush py-1.5 text-rose">
                          <span className="text-[11px] font-bold uppercase">{dayLabel(a.date, lang).split(' ')[0]}</span>
                          <span className="font-display text-lg font-extrabold leading-none">{a.date.slice(8)}</span>
                        </span>
                        <span className="min-w-0 flex-1">
                          <b className="block truncate text-[15px]">{a.patientName} · {a.serviceName}</b>
                          <span className="block truncate text-sm text-muted">{a.departmentName}, {a.clinicName}</span>
                        </span>
                        <span className="shrink-0 font-display text-[15px] font-bold">{clock(a.time)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              <a href="tel:112" className="dash-in flex min-h-[80px] items-center gap-4 rounded-[22px] bg-[#c8102e] px-6 py-4 text-[18px] font-bold !text-white no-underline shadow-[0_12px_28px_rgba(200,16,46,0.28)] hover:bg-[#a00c24]">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white/15">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 9v4M12 17h.01M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /></svg>
                </span>
                <span className="flex-1">{t('dash.emergency')}</span>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z" /></svg>
              </a>
            </div>

            {/* Side column */}
            <div className="flex flex-col gap-5">
              <section className="dash-in rounded-[24px] bg-white p-5 shadow-[0_12px_30px_rgba(90,45,176,0.07)] ring-1 ring-line">
                <div className="flex items-center justify-between">
                  <h2 className="m-0 text-sm font-semibold text-muted">{t('dash.koloTitle')}</h2>
                  <Icon name="kolo" size={20} className="text-plum" />
                </div>
                <div className="mt-2 font-display text-[34px] font-extrabold leading-none"><CountUp value={data.kolo.available} format={naira} /></div>
                <div className="mt-1 text-sm text-muted">{t('dash.available')}</div>
                {data.kolo.reserved > 0 && (
                  <div className="mt-3 flex items-center justify-between rounded-xl bg-plum-tint px-3 py-2 text-sm">
                    <span className="text-muted">{t('dash.reserved')}</span><b>{naira(data.kolo.reserved)}</b>
                  </div>
                )}
                <Link to="/kolo" className="mt-4 flex min-h-11 items-center justify-center rounded-xl bg-rose text-[15px] font-bold !text-white no-underline hover:bg-rose-dark">{t('dash.topUp')}</Link>
              </section>

              <section className="dash-in rounded-[24px] bg-white p-5 shadow-[0_12px_30px_rgba(90,45,176,0.07)] ring-1 ring-line">
                <h2 className="m-0 text-sm font-semibold text-muted">{t('dash.familyTitle')}</h2>
                <ul className="m-0 mt-3 flex list-none flex-col gap-2.5 p-0">
                  {data.family.map((m) => (
                    <li key={m.id} className="flex items-center gap-3">
                      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold ${m.isSelf ? 'bg-plum text-white' : 'bg-plum-soft text-plum-deep'}`}>{initials(m.name)}</span>
                      <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">{m.name}</span>
                      {m.isSelf && <span className="text-xs font-semibold text-muted">{t('dash.you')}</span>}
                    </li>
                  ))}
                </ul>
                <Link to="/family" className="mt-4 flex min-h-11 items-center justify-center rounded-xl border border-line text-[15px] font-semibold text-plum no-underline hover:bg-blush">+ {t('dash.addFamily')}</Link>
              </section>
            </div>
          </div>
        )}
      </div>
      {openVisit && (
        <VisitSheet a={openVisit} t={t} onClose={() => setOpenVisit(null)}
          onChanged={(text) => { setOpenVisit(null); setToast(text); setTimeout(() => setToast(''), 3500); load() }} />
      )}
      {toast && (
        <div role="status" className="fixed inset-x-0 bottom-24 z-50 mx-auto w-fit rounded-full bg-ink px-5 py-3 text-sm font-semibold text-white shadow-lg lg:bottom-8">{toast}</div>
      )}
    </PatientShell>
  )
}
