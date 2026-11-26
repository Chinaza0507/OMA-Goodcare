import { useCallback, useEffect, useMemo, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { connectSocket, pollEvery } from '../lib/socket.js'
import HospitalShell from '../components/HospitalShell.jsx'
import { api } from '../api.js'
import { useAuth } from '../auth.jsx'

const clock = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number)
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`
}
const LAGOS = 'Africa/Lagos'
const toMin = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m }
const lagosMinutes = (ms) => toMin(new Intl.DateTimeFormat('en-GB', { timeZone: LAGOS, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(ms)))
const lagosWeekday = () => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(new Intl.DateTimeFormat('en-GB', { timeZone: LAGOS, weekday: 'short' }).format(new Date()))
const WEEKDAYS = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays']
const LATE_AFTER = 10
const minsAgo = (iso, now) => Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000))
const ERR = {
  nobody_waiting: 'Nobody has arrived yet. Mark a patient as arrived first.',
  grace_not_ended: 'Wait until the grace time ends before marking a no-show.',
  invalid_status: 'That patient’s status has changed. The list has been refreshed.',
  slot_taken: 'That time was just taken. Please try again.',
  already_booked: 'This person is already in this department’s queue today.',
  invalid_phone: 'That phone number is not valid.',
  not_today: 'This booking is for another day.',
  invalid_date: 'That day can’t be changed here.',
  slot_past: 'That time has already passed. Please try again.',
  not_found: 'That patient could not be found. The list has been refreshed.',
  invalid_input: 'Please check what you typed.',
  forbidden: 'You don’t have permission to do that.',
}
const errText = (e) => ERR[e.code] ?? 'Something went wrong. Please try again.'

const STATUS = {
  booked: ['Not arrived yet', 'bg-[#f1edf3] text-muted'],
  checked_in: ['Arrived', 'bg-[#e9f7ee] text-[#1d6b3a]'],
  called: ['With the doctor', 'bg-plum text-white'],
  seen: ['Seen', 'bg-[#efe8fc] text-[#46208c]'],
  no_show: ['No-show', 'bg-[#fde8ea] text-[#a00c24]'],
  cancelled: ['Cancelled', 'bg-[#f1edf3] text-muted'],
}

function Modal({ title, children, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-[#22121c]/45 p-4 sm:items-center" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div role="dialog" aria-modal="true" aria-label={title} className="w-full max-w-[440px] motion-safe:animate-[omaRise_.25s_ease-out] rounded-[26px] bg-white p-6 shadow-[0_30px_70px_rgba(34,18,28,0.3)]">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="m-0 text-xl font-extrabold">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border border-line bg-white text-muted hover:bg-cream">✕</button>
        </div>
        {children}
      </div>
    </div>
  )
}

const input = 'min-h-12 w-full rounded-[14px] border-[1.5px] border-line bg-white px-3.5 text-base text-ink'
const pinkBtn = 'min-h-12 cursor-pointer rounded-2xl border-0 bg-rose px-5 font-bold text-white hover:bg-rose-dark disabled:cursor-wait disabled:opacity-60'

export default function HospitalHome() {
  const { user, checking } = useAuth()
  const [info, setInfo] = useState(null) // { clinic, departments }
  const [appts, setAppts] = useState(null)
  const [dept, setDept] = useState(null)
  const [now, setNow] = useState(() => Date.now())
  const [busyId, setBusyId] = useState(null)
  const [toast, setToast] = useState(null) // { ok, text }
  const [walkIns, setWalkIns] = useState([])
  const [walkName, setWalkName] = useState('')
  const [day, setDay] = useState(null) // null = today
  const [moving, setMoving] = useState(null) // appointment to move to front
  const [cancelDay, setCancelDay] = useState(false)
  const [search, setSearch] = useState('')
  const isStaff = user && (user.role === 'manager' || user.role === 'staff')

  const flash = (ok, text) => { setToast({ ok, text }); setTimeout(() => setToast(null), 3500) }

  const load = useCallback(async () => {
    const [c, today] = await Promise.all([api('/staff/clinic'), api(`/staff/today${day ? `?date=${day}` : ''}`)])
    setInfo(c)
    setAppts(today.appointments)
    setWalkIns(today.walkIns)
    const wd = lagosWeekday()
    setDept((d) => d ?? (c.departments.find((x) => x.bookingDays?.includes(wd)) ?? c.departments[0])?.id ?? null)
  }, [day])

  useEffect(() => { if (isStaff) load().catch(() => flash(false, 'Could not load the queue. Check the connection.')) }, [isStaff, load])

  // Live: refetch when anything changes at this clinic; tick for grace countdowns.
  const clinicId = info?.clinic.id
  useEffect(() => {
    if (!clinicId) return
    const s = connectSocket()
    s.on('connect', () => s.emit('join', { clinicId }))
    s.on('queue:changed', () => load().catch(() => {}))
    const tick = setInterval(() => setNow(Date.now()), 15_000)
    const poll = setInterval(() => load().catch(() => {}), pollEvery(45_000))
    return () => { s.disconnect(); clearInterval(tick); clearInterval(poll) }
  }, [clinicId, load])

  async function act(id, path, body, okText) {
    setBusyId(id)
    try {
      await api(path, { method: 'POST', body: body ?? {} })
      await load()
      if (okText) flash(true, okText)
    } catch (e) {
      flash(false, errText(e))
      await load().catch(() => {})
    } finally {
      setBusyId(null)
    }
  }

  const list = useMemo(() => (appts ?? []).filter((a) => a.departmentId === dept), [appts, dept])
  const deptWalkIns = walkIns.filter((w) => w.departmentId === dept)
  const isToday = !day || day === info?.dates?.[0]
  const dayLabel = (d, i) => (i === 0 ? 'Today' : new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${d}T12:00:00Z`)))
  async function addWalkIn(e) {
    e.preventDefault()
    if (walkName.trim().length < 2) return flash(false, 'Please enter the patient’s name.')
    setBusyId('walkin')
    try {
      const d = await api('/staff/walk-ins', { method: 'POST', body: { departmentId: dept, name: walkName.trim() } })
      setWalkName('')
      await load()
      flash(true, `Walk-in W${d.walkIn.number} logged.`)
    } catch (err) { flash(false, errText(err)) } finally { setBusyId(null) }
  }
  async function walkStatus(w, status) {
    setBusyId(w.id)
    try { await api(`/staff/walk-ins/${w.id}`, { method: 'PATCH', body: { status } }); await load() } catch (err) { flash(false, errText(err)) } finally { setBusyId(null) }
  }
  const withDoctor = list.find((a) => a.status === 'called')
  const q = search.trim().toLowerCase().replace(/^#/, '')
  const matches = (a) => !q || (a.name ?? a.firstName).toLowerCase().includes(q) || String(a.queueNumber) === q
  const waitingAll = list.filter((a) => a.status === 'checked_in')
  const waiting = waitingAll.filter(matches)
  const expected = list.filter((a) => a.status === 'booked').filter(matches)
  const nowMin = lagosMinutes(now)
  const isLate = (a) => a.status === 'booked' && toMin(a.time) + LATE_AFTER <= nowMin
  // How far behind the booked times this line is running: when the next person can go in vs their booked time.
  const behind = (() => {
    const next = waitingAll[0]
    if (!next) return 0
    let free = nowMin
    if (withDoctor?.calledAt) free = Math.max(nowMin, lagosMinutes(new Date(withDoctor.calledAt).getTime()) + withDoctor.minutes)
    return Math.max(0, free - toMin(next.time))
  })()
  const done = list.filter((a) => ['seen', 'no_show', 'cancelled'].includes(a.status))

  if (checking) return null
  if (!isStaff) return <Navigate to="/hospital/login" replace />

  const deptName = info?.departments.find((d) => d.id === dept)?.name
  const counts = (id) => (appts ?? []).filter((a) => a.departmentId === id && a.status === (isToday ? 'checked_in' : 'booked')).length
  const deptInfo = info?.departments.find((d) => d.id === dept)
  const booksThisDay = (() => {
    if (!deptInfo?.bookingDays) return true
    const wd = day ? new Date(`${day}T12:00:00Z`).getUTCDay() : lagosWeekday()
    return deptInfo.bookingDays.includes(wd)
  })()
  const thisWeekday = day ? new Date(`${day}T12:00:00Z`).getUTCDay() : lagosWeekday()

  return (
    <HospitalShell>
      {!info && <div aria-hidden="true" className="h-64 animate-pulse rounded-[24px] bg-[#efe7ec]" />}

      {info && info.departments.length === 0 && user.role === 'manager' && <Navigate to="/hospital/settings?welcome=1" replace />}
      {info && info.departments.length === 0 && user.role !== 'manager' && (
        <div className="rounded-[24px] bg-white p-8 text-center ring-1 ring-line">
          <h1 className="m-0 text-2xl font-extrabold">Set up your first department</h1>
          <p className="mx-auto mb-0 mt-2 max-w-md text-muted">Add a department (like Dental), choose its booking days, and list its services with how long each takes. Then patients can book.</p>
          {user.role === 'manager'
            ? <a href="/hospital/settings" className="mt-5 inline-flex min-h-12 items-center rounded-2xl bg-rose px-6 font-bold !text-white no-underline">Go to settings</a>
            : <p className="mt-3 text-sm text-muted">Ask your manager to add departments.</p>}
        </div>
      )}

      {info && info.departments.length > 0 && (
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="m-0 text-sm text-muted">{new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Africa/Lagos' }).format(day ? new Date(`${day}T12:00:00Z`) : new Date())}</p>
              <h1 className="m-0 text-[28px] font-extrabold leading-tight">{isToday ? 'Today’s bookings' : 'Upcoming bookings'}</h1>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div role="tablist" aria-label="Day" className="flex rounded-2xl bg-white p-1 ring-1 ring-line">
                {(info.dates ?? []).map((d, i) => (
                  <button key={d} type="button" role="tab" aria-selected={(day ?? info.dates[0]) === d} onClick={() => setDay(i === 0 ? null : d)}
                    className={`min-h-9 cursor-pointer rounded-xl border-0 px-3 text-sm font-bold ${(day ?? info.dates[0]) === d ? 'bg-plum text-white' : 'bg-transparent text-ink hover:bg-plum-tint'}`}>{dayLabel(d, i)}</button>
                ))}
              </div>
            </div>
          </div>

          <div role="tablist" aria-label="Departments" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
            {info.departments.map((d) => (
              <button key={d.id} type="button" role="tab" aria-selected={dept === d.id} onClick={() => setDept(d.id)}
                className={`flex min-h-11 shrink-0 cursor-pointer items-center gap-2 rounded-2xl border-[1.5px] px-4 text-sm font-bold ${dept === d.id ? 'border-plum bg-plum text-white' : 'border-line bg-white text-ink hover:border-plum-soft'}`}>
                {d.name}
                <span title={isToday ? 'Waiting' : 'Booked'} className={`rounded-full px-2 py-0.5 text-xs ${dept === d.id ? 'bg-white/20' : 'bg-plum-tint text-plum'}`}>{counts(d.id)}</span>
              </button>
            ))}
          </div>

          {!booksThisDay && list.length === 0 && (
            <p className="m-0 rounded-2xl bg-white p-5 text-center text-[15px] text-muted ring-1 ring-line">
              No ỌMA bookings on {WEEKDAYS[thisWeekday]} for {deptName}. Walk-ins can still be logged below.
            </p>
          )}

          {!isToday && (
            <QueueList title={`Booked · ${list.filter((a) => a.status === 'booked').length}`} empty="No bookings for this day yet." items={list.filter((a) => a.status === 'booked')} />
          )}

          {isToday && <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,420px)_1fr]">
            <div className="flex flex-col gap-5">
            {/* With the doctor + call next */}
            <section className="flex flex-col gap-4 rounded-[26px] bg-[#2f1563] p-6 text-white shadow-[0_20px_44px_rgba(47,21,99,0.3)]">
              <span className="text-xs font-bold uppercase tracking-[0.12em] text-[#cdb9e8]">With the doctor · {deptName}</span>
              {withDoctor ? (
                <>
                  <div className="flex items-end gap-4">
                    <span className="font-display text-6xl font-extrabold leading-none">#{withDoctor.queueNumber}</span>
                    <span className="pb-1"><b className="block text-xl">{withDoctor.name ?? withDoctor.firstName}</b><span className="text-sm text-[#cdb9e8]">called {minsAgo(withDoctor.calledAt, now)} min ago</span></span>
                  </div>
                  <div className="grid grid-cols-2 gap-2.5">
                    <button type="button" disabled={busyId === withDoctor.id} onClick={() => act(withDoctor.id, `/staff/appointments/${withDoctor.id}/seen`, null, `#${withDoctor.queueNumber} marked as seen.`)}
                      className="min-h-12 cursor-pointer rounded-2xl border-0 bg-[#22c55e] font-bold text-[#0b2e17] hover:bg-[#1fb355] disabled:opacity-60">✓ Seen</button>
                    {(() => {
                      const left = withDoctor.graceEndsAt ? Math.ceil((new Date(withDoctor.graceEndsAt).getTime() - now) / 60000 - 0.05) : 0
                      return (
                        <button type="button" disabled={left > 0 || busyId === withDoctor.id} onClick={() => act(withDoctor.id, `/staff/appointments/${withDoctor.id}/no-show`, null, `#${withDoctor.queueNumber} marked as a no-show.`)}
                          className="min-h-12 cursor-pointer rounded-2xl border border-white/30 bg-white/10 font-bold text-white hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-50">
                          {left > 0 ? `No-show in ${left} min` : 'No-show'}
                        </button>
                      )
                    })()}
                  </div>
                </>
              ) : (
                <p className="m-0 text-lg text-[#e3d8fb]">Nobody is with the doctor right now.</p>
              )}
              {behind >= 10 && (
                <p className="m-0 rounded-xl bg-white/10 px-3.5 py-2 text-sm text-[#f6d9e7]">Running about {behind} min behind. Patients can see this on their phones.</p>
              )}
              <button type="button" disabled={!!withDoctor || waitingAll.length === 0 || busyId === 'next'}
                onClick={() => act('next', `/staff/departments/${dept}/call-next`, null, 'Next patient called.')}
                className="min-h-[60px] cursor-pointer rounded-2xl border-0 bg-rose text-lg font-extrabold text-white hover:bg-rose-dark disabled:cursor-not-allowed disabled:bg-white/15 disabled:text-white/60">
                {withDoctor ? 'Finish the current patient first' : waitingAll.length ? `Call next · #${waitingAll[0].queueNumber} ${waitingAll[0].firstName}` : 'Nobody waiting yet'}
              </button>
            </section>

            </div>

            <div className="flex flex-col gap-5">
              <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Find a patient: name or number"
                aria-label="Find a patient by name or number" className={`${input} min-h-11`} />
              <QueueList title={`Waiting · ${waiting.length}`} empty={q ? 'Nobody waiting matches that.' : 'Nobody has arrived yet.'} items={waiting} busyId={busyId}
                actions={(a, i) => i > 0 && (
                  <button type="button" onClick={() => setMoving(a)} title="Move to the front (emergency)" className="min-h-9 cursor-pointer rounded-lg border border-line bg-white px-2.5 text-xs font-semibold text-rose hover:bg-blush">↑ Move up</button>
                )} />
              <QueueList title={`Not arrived yet · ${expected.length}`} empty={q ? 'Nobody expected matches that.' : 'No more bookings expected today.'} items={expected} busyId={busyId} isLate={isLate}
                actions={(a) => (
                  <button type="button" disabled={busyId === a.id} onClick={() => act(a.id, `/staff/appointments/${a.id}/check-in`, null, `#${a.queueNumber} has arrived.`)} className="min-h-10 cursor-pointer rounded-xl border-0 bg-[#1d6b3a] px-3.5 text-sm font-bold text-white hover:bg-[#165a30] disabled:opacity-50">Arrived</button>
                )} />
              {done.length > 0 && (
                <details className="rounded-[22px] bg-white p-4 ring-1 ring-line">
                  <summary className="cursor-pointer text-sm font-bold text-muted">Finished today · {done.length}</summary>
                  <div className="mt-3"><QueueList bare items={done} busyId={busyId} actions={(a) => a.status === 'no_show' && (
                    <button type="button" disabled={busyId === a.id} onClick={() => act(a.id, `/staff/appointments/${a.id}/requeue`, null, `#${a.queueNumber} is back in the queue.`)} className="min-h-10 cursor-pointer rounded-xl border border-line bg-white px-3 text-sm font-semibold text-plum hover:bg-plum-tint">Arrived late</button>
                  )} /></div>
                </details>
              )}
              {/* Walk-in log: seen by another doctor, never in the booking line */}
            <section className="flex flex-col gap-3 rounded-[24px] bg-white p-5 ring-1 ring-line">
              <div>
                <h2 className="m-0 text-base font-bold">Walk-ins · {deptWalkIns.length}</h2>
                <p className="m-0 mt-0.5 text-xs text-muted">For today’s numbers only.</p>
              </div>
              <form onSubmit={addWalkIn} className="flex gap-2">
                <input className={`${input} min-h-11`} value={walkName} onChange={(e) => setWalkName(e.target.value)} placeholder="Walk-in patient’s name" aria-label="Walk-in patient’s name" />
                <button type="submit" disabled={busyId === 'walkin'} className="min-h-11 shrink-0 cursor-pointer rounded-xl border-0 bg-rose px-4 text-sm font-bold text-white hover:bg-rose-dark disabled:opacity-60">Log</button>
              </form>
              {deptWalkIns.length > 0 && (
                <ul className="m-0 flex list-none flex-col divide-y divide-line p-0">
                  {deptWalkIns.map((w) => (
                    <li key={w.id} className={`flex items-center gap-3 py-2.5 ${w.status === 'waiting' ? '' : 'opacity-60'}`}>
                      <span className="w-10 font-display text-base font-extrabold text-rose">W{w.number}</span>
                      <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">{w.name}</span>
                      {w.status === 'waiting' ? (
                        <span className="flex gap-1.5">
                          <button type="button" disabled={busyId === w.id} onClick={() => walkStatus(w, 'seen')} className="min-h-9 cursor-pointer rounded-lg border-0 bg-[#1d6b3a] px-3 text-xs font-bold text-white">Seen</button>
                          <button type="button" disabled={busyId === w.id} onClick={() => walkStatus(w, 'left')} className="min-h-9 cursor-pointer rounded-lg border border-line bg-white px-3 text-xs font-semibold text-muted">Left</button>
                        </span>
                      ) : (
                        <button type="button" onClick={() => walkStatus(w, 'waiting')} className="cursor-pointer border-0 bg-transparent text-xs font-semibold text-muted underline">{w.status === 'seen' ? 'Seen' : 'Left'} · undo</button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
            </div>
          </div>}

          {(isToday || list.length > 0) && (
            <button type="button" onClick={() => setCancelDay(true)} className="mx-auto mt-2 cursor-pointer border-0 bg-transparent text-sm font-semibold text-[#c8102e] underline underline-offset-4 hover:text-[#a00c24]">
              {isToday ? 'Doctor not available? Cancel the rest of today' : 'Cancel this day’s bookings'}
            </button>
          )}
        </div>
      )}

      {moving && (
        <Modal title={`Move #${moving.queueNumber} to the front?`} onClose={() => setMoving(null)}>
          <form className="flex flex-col gap-3.5" onSubmit={(e) => {
            e.preventDefault()
            const reason = new FormData(e.currentTarget).get('reason').toString().trim()
            if (reason.length < 2) return flash(false, 'Please give a reason.')
            const a = moving
            setMoving(null)
            act(a.id, `/staff/appointments/${a.id}/move-to-front`, { reason }, `#${a.queueNumber} moved to the front.`)
          }}>
            <p className="m-0 text-sm text-muted">For emergencies or very sick patients. The reason is saved in the action log.</p>
            <input name="reason" className={input} placeholder="e.g. High fever, child" autoFocus />
            <button type="submit" className={pinkBtn}>Move to front</button>
          </form>
        </Modal>
      )}

      {cancelDay && (
        <Modal title={isToday ? 'Cancel the rest of today?' : 'Cancel this day’s bookings?'} onClose={() => setCancelDay(false)}>
          <form className="flex flex-col gap-3.5" onSubmit={(e) => {
            e.preventDefault()
            const f = new FormData(e.currentTarget)
            const body = { reason: f.get('reason').toString().trim() || 'Clinic closed', ...(day ? { date: day } : {}) }
            if (f.get('scope') !== 'all') body.departmentId = f.get('scope')
            setCancelDay(false)
            act('day', '/staff/cancel-day', body, 'Remaining visits cancelled. Deposits were returned to patients.')
          }}>
            <p className="m-0 text-sm text-muted">Everyone booked (and still waiting) is cancelled and their ₦300 deposit goes back to their Kolo.</p>
            <select name="scope" className={input} defaultValue={dept}>
              {info.departments.map((d) => <option key={d.id} value={d.id}>{d.name} only</option>)}
              <option value="all">The whole hospital</option>
            </select>
            <input name="reason" className={input} placeholder="Reason, e.g. Doctor called to an emergency" />
            <button type="submit" className="min-h-12 cursor-pointer rounded-2xl border-0 bg-[#c8102e] font-bold text-white hover:bg-[#a00c24]">Cancel remaining visits</button>
          </form>
        </Modal>
      )}

      {toast && <div role="status" className={`fixed inset-x-0 bottom-6 z-[60] mx-auto w-fit max-w-[90vw] rounded-full px-5 py-3 text-sm font-semibold text-white shadow-lg ${toast.ok ? 'bg-ink' : 'bg-[#c8102e]'}`}>{toast.text}</div>}
    </HospitalShell>
  )
}

function QueueList({ title, items, empty, actions, bare = false, isLate }) {
  const body = items.length === 0 ? (
    <p className="m-0 rounded-2xl border border-dashed border-line p-5 text-center text-sm text-muted">{empty}</p>
  ) : (
    <ul className="m-0 flex list-none flex-col divide-y divide-line p-0">
      {items.map((a, i) => {
        const [label, cls] = STATUS[a.status]
        const late = isLate?.(a)
        return (
          <li key={a.id} className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0">
            <span className="w-14 font-display text-xl font-extrabold text-plum">#{a.queueNumber}</span>
            <span className="min-w-0 flex-1">
              <b className="block truncate text-[15px]">{a.name ?? a.firstName}</b>
              <span className="text-xs text-muted">{clock(a.time)} · {a.serviceName} · {a.minutes} min</span>
            </span>
            {late && <span className="rounded-full bg-rose-tint px-2.5 py-1 text-xs font-bold text-rose-dark">Late</span>}
            {bare && <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${cls}`}>{label}</span>}
            <span className="flex gap-2">{actions?.(a, i)}</span>
          </li>
        )
      })}
    </ul>
  )
  if (bare) return body
  return (
    <section className="rounded-[24px] bg-white p-5 ring-1 ring-line">
      <h2 className="m-0 mb-3 text-base font-bold">{title}</h2>
      {body}
    </section>
  )
}
