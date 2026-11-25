import { useEffect, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import PatientShell from '../components/PatientShell.jsx'
import { api } from '../api.js'
import { connectSocket } from '../lib/socket.js'
import { useAuth } from '../auth.jsx'
import { useT } from '../i18n/index.jsx'

const LAGOS = 'Africa/Lagos'
const naira = (n) => `₦${Number(n || 0).toLocaleString('en-NG')}`
const clock = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number)
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`
}
const addMins = (hhmm, n) => {
  const [h, m] = hhmm.split(':').map(Number)
  const total = h * 60 + m + n
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}
const todayLagos = () => new Intl.DateTimeFormat('en-CA', { timeZone: LAGOS }).format(new Date())
const dayParts = (iso) => {
  const d = new Date(`${iso}T00:00:00Z`)
  return {
    weekday: new Intl.DateTimeFormat('en-GB', { weekday: 'short', timeZone: 'UTC' }).format(d),
    day: d.getUTCDate(),
    long: new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(d),
  }
}
// "Wed, Thu" from booking days (0 = Sunday … 6 = Saturday).
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
// Short, readable booking days: "Every day", "Mon–Sat", "Tue & Thu", "Wednesdays", "Mon, Wed & Fri".
const LONG_DAYS = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays']
function daysLabel(days) {
  const d = [...days].sort((a, b) => a - b)
  if (d.length === 7) return 'Every day'
  if (d.length === 1) return LONG_DAYS[d[0]]
  const runs = []
  for (const x of d) {
    const last = runs[runs.length - 1]
    if (last && x === last[1] + 1) last[1] = x
    else runs.push([x, x])
  }
  const parts = runs.flatMap(([a, b]) => (b - a >= 2 ? [`${DAY_NAMES[a]}–${DAY_NAMES[b]}`] : a === b ? [DAY_NAMES[a]] : [DAY_NAMES[a], DAY_NAMES[b]]))
  return parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} & ${parts[parts.length - 1]}`
}
// "8am", "1:30pm"
const shortClock = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number)
  return `${((h + 11) % 12) + 1}${m ? `:${String(m).padStart(2, '0')}` : ''}${h < 12 ? 'am' : 'pm'}`
}

function Stepper({ step, t }) {
  const labels = t('bookPage.steps')
  return (
    <ol className="m-0 flex list-none items-center gap-2 p-0" aria-label="Booking steps">
      {labels.map((label, i) => {
        const done = i < step
        const on = i === step
        return (
          <li key={label} className="flex min-w-0 flex-1 items-center gap-2">
            <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full font-display text-sm font-extrabold transition-colors ${done ? 'bg-plum text-white' : on ? 'bg-rose text-white' : 'bg-[#efe7ec] text-muted'}`}>
              {done ? <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12l5 5L20 7" /></svg> : i + 1}
            </span>
            <span className={`hidden truncate text-sm font-semibold sm:block ${on ? 'text-ink' : 'text-muted'}`} aria-current={on ? 'step' : undefined}>{label}</span>
            {i < labels.length - 1 && <span aria-hidden="true" className={`h-0.5 min-w-3 flex-1 rounded-full ${done ? 'bg-plum' : 'bg-line'}`} />}
          </li>
        )
      })}
    </ol>
  )
}

const Choice = ({ on, onClick, children, className = '' }) => (
  <button type="button" aria-pressed={on} onClick={onClick}
    className={`cursor-pointer rounded-2xl border-[1.5px] text-left transition-colors ${on ? 'border-plum bg-plum-tint text-plum' : 'border-line bg-white text-ink hover:border-plum-soft'} ${className}`}>
    {children}
  </button>
)

export default function BookVisit() {
  const { clinicId } = useParams()
  const { t } = useT()
  const { user, checking } = useAuth()
  const navigate = useNavigate()

  const [clinic, setClinic] = useState(null)
  const [family, setFamily] = useState([])
  const [kolo, setKolo] = useState(null)
  const [loadError, setLoadError] = useState('')

  const [step, setStep] = useState(0) // 0 service, 1 day + time, 2 who, 3 confirm, 4 done
  const [serviceId, setServiceId] = useState(null)
  const [avail, setAvail] = useState(null) // { days: [{ date, times }] }
  const [date, setDate] = useState(null)
  const [slotsRefresh, setSlotsRefresh] = useState(0)
  const [time, setTime] = useState(null)
  const [memberId, setMemberId] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [booked, setBooked] = useState(null)

  const msg = (code) => (t(`errors.${code}`) !== `errors.${code}` ? t(`errors.${code}`) : t('errors.server_error'))

  useEffect(() => {
    if (!user) return
    Promise.all([api(`/clinics/${clinicId}`), api('/family'), api('/kolo')])
      .then(([c, f, k]) => {
        setClinic(c.clinic)
        setFamily(f.members)
        setKolo(k)
        setMemberId((m) => m ?? f.members.find((x) => x.isSelf)?.id ?? null)
      })
      .catch((e) => setLoadError(msg(e.code)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clinicId, user])

  // Free times for the chosen service on each booking day (up to 2 days ahead).
  // A new service starts fresh; a live refresh keeps the chosen time if it is still free.
  const [shownService, setShownService] = useState(null)
  useEffect(() => {
    if (!serviceId) return
    let live = true
    api(`/services/${serviceId}/availability`)
      .then((d) => {
        if (!live) return
        setAvail(d)
        setShownService(serviceId)
        setDate((cur) => (d.days.some((x) => x.date === cur && x.times.length) ? cur : d.days.find((x) => x.times.length)?.date ?? d.days[0]?.date ?? null))
        setTime((cur) => (cur && d.days.some((x) => x.times.includes(cur)) ? cur : null))
      })
      .catch(() => { if (live) setAvail({ days: [] }) })
    return () => { live = false }
  }, [serviceId, slotsRefresh])

  const dept = clinic?.departments.find((d) => d.services.some((sv) => sv.id === serviceId))
  const service = dept?.services.find((sv) => sv.id === serviceId)
  const ready = avail && shownService === serviceId ? avail : null
  const dayTimes = ready?.days.find((d) => d.date === date)?.times ?? null

  // Live: when anyone books or cancels in this department, refresh the free times at once.
  const deptId = dept?.id
  useEffect(() => {
    if (!deptId) return
    const s = connectSocket()
    s.on('connect', () => s.emit('join', { departmentId: deptId }))
    s.on('queue:changed', () => setSlotsRefresh((n) => n + 1))
    return () => s.disconnect()
  }, [deptId])
  const member = family.find((m) => m.id === memberId)
  const deposit = clinic?.depositNaira ?? 0
  const lowKolo = kolo && deposit > 0 && kolo.available < deposit
  const alertValue = user?.alertAhead ?? 2 // set in Settings → Turn alert

  async function confirm() {
    if (busy || lowKolo) return
    setBusy(true)
    setError('')
    try {
      const d = await api('/appointments', { method: 'POST', body: { familyMemberId: memberId, serviceId, date, time, alertAhead: alertValue } })
      setBooked(d.appointment)
      setStep(3)
    } catch (e) {
      setError(msg(e.code))
      if (e.code === 'slot_taken' || e.code === 'slot_past' || e.code === 'invalid_date') { setStep(1); setSlotsRefresh((n) => n + 1) }
    } finally {
      setBusy(false)
    }
  }

  if (checking) return null
  if (!user) return <Navigate to="/login" replace />

  const primary = 'flex min-h-[52px] w-full items-center justify-center rounded-2xl border-0 px-6 text-base font-bold transition-colors sm:w-auto'
  const back = (to) => (
    <button type="button" onClick={() => { setError(''); setStep(to) }} className="min-h-[52px] cursor-pointer rounded-2xl border-[1.5px] border-line bg-white px-6 text-base font-bold text-ink hover:bg-blush">{t('bookPage.back')}</button>
  )

  return (
    <PatientShell>
      <div className="mx-auto flex max-w-3xl flex-col gap-5">
        <div className="flex items-center gap-3">
          <Link to="/book" aria-label={t('bookPage.back')} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-line bg-white text-ink no-underline hover:bg-blush">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M19 12H5M11 18l-6-6 6-6" /></svg>
          </Link>
          <div className="min-w-0">
            <h1 className="m-0 text-[26px] font-semibold leading-tight">{t('bookPage.title')}</h1>
            {clinic && <p className="m-0 truncate text-sm text-muted">{clinic.name} · {[clinic.area, clinic.state].filter(Boolean).join(', ')}</p>}
          </div>
        </div>

        {step < 3 && <Stepper step={step} t={t} />}

        {loadError && <p role="alert" className="m-0 rounded-2xl bg-white p-5 text-muted ring-1 ring-line">{loadError}</p>}
        {!clinic && !loadError && <div aria-hidden="true" className="h-[360px] animate-pulse rounded-[24px] bg-[#efe7ec]" />}

        {error && (
          <p role="alert" className="m-0 flex items-center gap-2 rounded-2xl border border-rose-line bg-blush px-4 py-3 text-[15px] font-semibold text-rose">{error}</p>
        )}

        {/* Step 0: what do you need? */}
        {clinic && step === 0 && (
          <section className="flex flex-col gap-5 rounded-[24px] bg-white p-5 ring-1 ring-line sm:p-6">
            <div className="step-in">
              <h2 className="m-0 text-base font-bold">{t('bookPage.service')}</h2>
              <p className="m-0 mt-1 text-sm text-muted">{t('bookPage.serviceHelp')}</p>
            </div>
            {clinic.departments.length === 0 && <p className="step-in m-0 rounded-2xl border border-dashed border-line p-5 text-center text-sm text-muted">{t('bookPage.noServices')}</p>}
            {clinic.departments.map((d) => (
              <div key={d.id} className="step-in">
                <div className="mb-2.5">
                  <h3 className="m-0 text-sm font-bold uppercase tracking-[0.06em] text-muted">{d.name}</h3>
                  <span className="mt-0.5 flex items-center gap-1.5 text-[13px] text-muted">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM16 3v4M8 3v4M3 10h18" /></svg>
                    {daysLabel(d.bookingDays)} · {shortClock(d.opensAt)}–{shortClock(d.closesAt)}
                  </span>
                </div>
                <div className="grid gap-2.5 sm:grid-cols-2">
                  {d.services.map((sv) => (
                    <Choice key={sv.id} on={serviceId === sv.id} onClick={() => { setServiceId(sv.id); setError(''); setStep(1) }} className="flex items-center justify-between gap-3 px-4 py-3.5">
                      <span className="min-w-0">
                        <b className="block truncate">{sv.name}</b>
                        <span className="text-sm text-muted">{t('bookPage.minutes').replace('{n}', sv.minutes)}</span>
                      </span>
                      <span className="shrink-0 text-sm font-semibold text-muted">{sv.price == null ? t('bookPage.feeUnknown') : sv.price === 0 ? t('bookPage.free') : naira(sv.price)}</span>
                    </Choice>
                  ))}
                </div>
              </div>
            ))}
          </section>
        )}

        {/* Step 1: day and time */}
        {clinic && step === 1 && service && (
          <section className="flex flex-col gap-6 rounded-[24px] bg-white p-5 ring-1 ring-line sm:p-6">
            <div className="step-in flex items-center gap-3 rounded-2xl bg-plum-tint px-4 py-3">
              <span className="min-w-0 flex-1"><b className="block truncate">{service.name}</b><span className="text-sm text-muted">{dept.name} · {t('bookPage.minutes').replace('{n}', service.minutes)} · {daysLabel(dept.bookingDays)}</span></span>
              <button type="button" onClick={() => setStep(0)} className="cursor-pointer border-0 bg-transparent text-sm font-bold text-plum hover:underline">{t('bookPage.change')}</button>
            </div>

            <div className="step-in">
              <h2 className="m-0 text-base font-bold">{t('bookPage.when')}</h2>
              <p className="m-0 mb-3 mt-1 text-sm text-muted">{t('bookPage.whenHelp')}</p>
              {ready === null ? (
                <p className="m-0 text-sm text-muted">{t('bookPage.loadingTimes')}</p>
              ) : ready.days.length === 0 ? (
                <p className="m-0 rounded-2xl border border-dashed border-line p-5 text-center text-sm text-muted">{t('bookPage.noDays')}</p>
              ) : (
                <>
                  <div className="mb-4 flex flex-wrap gap-2">
                    {ready.days.map((d) => {
                      const p = dayParts(d.date)
                      const full = d.times.length === 0
                      return (
                        <button key={d.date} type="button" aria-pressed={date === d.date} disabled={full} onClick={() => { setDate(d.date); setTime(null) }}
                          className={`flex min-h-[58px] min-w-[84px] flex-col items-center justify-center rounded-2xl border-[1.5px] px-3 disabled:cursor-not-allowed disabled:opacity-45 ${date === d.date ? 'border-plum bg-plum text-white' : 'cursor-pointer border-line bg-white text-ink hover:border-plum-soft'}`}>
                          <span className="text-xs font-bold uppercase">{d.date === todayLagos() ? t('bookPage.today') : p.weekday}</span>
                          <span className="font-display text-lg font-extrabold leading-tight">{full ? t('bookPage.dayFull') : `${p.day}`}</span>
                        </button>
                      )
                    })}
                  </div>
                  {dayTimes && dayTimes.length > 0 ? (
                    <div className="grid max-h-[300px] grid-cols-2 gap-2 overflow-y-auto pr-1 sm:grid-cols-3">
                      {dayTimes.map((s) => (
                        <button key={s} type="button" aria-pressed={time === s} onClick={() => setTime(s)}
                          className={`min-h-12 cursor-pointer rounded-xl border-[1.5px] px-2 text-[15px] font-semibold transition-colors ${time === s ? 'border-rose bg-rose text-white' : 'border-line bg-white text-ink hover:border-rose-line hover:bg-blush'}`}>
                          {clock(s)} – {clock(addMins(s, 35))}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="m-0 rounded-2xl border border-dashed border-line p-5 text-center text-sm text-muted">{t('bookPage.noTimes')}</p>
                  )}
                </>
              )}
            </div>

            <div className="flex flex-col-reverse justify-between gap-2.5 sm:flex-row">
              {back(0)}
              <button type="button" disabled={!time} onClick={() => { setError(''); setStep(2) }}
                className={`${primary} ${time ? 'cursor-pointer bg-plum text-white hover:bg-plum-dark' : 'cursor-not-allowed bg-[#efe7ec] text-[#6b5a65]'}`}>{t('bookPage.next')}</button>
            </div>
          </section>
        )}

        {/* Step 3: check and confirm */}
        {clinic && step === 2 && service && member && time && date && (
          <section className="flex flex-col gap-5 rounded-[24px] bg-white p-5 ring-1 ring-line sm:p-6">
            <h2 className="step-in m-0 text-lg font-bold">{t('bookPage.review')}</h2>
            <div className="step-in">
              <span className="text-sm font-semibold">{t('bookPage.who')}</span>
              <div className="mt-2 flex flex-wrap gap-2">
                {family.map((m) => (
                  <button key={m.id} type="button" aria-pressed={memberId === m.id} onClick={() => setMemberId(m.id)}
                    className={`min-h-11 cursor-pointer rounded-xl border-[1.5px] px-4 text-sm font-semibold ${memberId === m.id ? 'border-plum bg-plum text-white' : 'border-line bg-white text-ink hover:border-plum-soft'}`}>
                    {m.isSelf ? `${m.name.split(' ')[0]} (${t('dash.you')})` : m.name}
                  </button>
                ))}
                <Link to="/family" className="flex min-h-11 items-center rounded-xl border-[1.5px] border-dashed border-line px-4 text-sm font-semibold text-plum no-underline hover:bg-plum-faint">+ {t('dash.addFamily')}</Link>
              </div>
            </div>
            <dl className="step-in m-0 grid gap-0 divide-y divide-line rounded-2xl bg-plum-faint px-4 ring-1 ring-line">
              {[
                [t('bookPage.hospital'), `${clinic.name}`],
                [t('bookPage.serviceRow'), `${service.name} · ${dept.name}`],
                [t('visit.when'), `${dayParts(date).long} · ${clock(time)} – ${clock(addMins(time, service.minutes))}`],
                [t('bookPage.fee'), service.price == null ? t('bookPage.feeUnknown') : service.price === 0 ? t('bookPage.free') : naira(service.price)],
              ].map(([k, v]) => (
                <div key={k} className="flex items-start justify-between gap-4 py-3">
                  <dt className="text-sm text-muted">{k}</dt>
                  <dd className="m-0 text-right text-[15px] font-semibold">{v}</dd>
                </div>
              ))}
            </dl>

            {deposit > 0 && (
              <div className="step-in rounded-2xl bg-plum-tint p-4">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[15px] font-semibold">{t('bookPage.depositRow')}</span>
                  <b className="font-display text-lg text-plum">{naira(deposit)}</b>
                </div>
                {kolo && !lowKolo && (
                  <div className="mt-1.5 flex items-center justify-between gap-3 text-sm text-muted">
                    <span>{t('bookPage.koloAfter')}</span><span>{naira(kolo.available - deposit)}</span>
                  </div>
                )}
                <p className="m-0 mt-3 text-[13px] leading-snug text-muted">{t('bookPage.depositNote')}</p>
              </div>
            )}

            {lowKolo && (
              <div role="alert" className="step-in flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-rose-line bg-blush p-4">
                <span className="text-[15px] font-semibold text-rose">{t('bookPage.lowKolo').replace('{available}', naira(kolo.available))}</span>
                <Link to="/kolo" className="flex min-h-11 items-center rounded-xl bg-rose px-4 text-sm font-bold !text-white no-underline">{t('bookPage.addMoney')}</Link>
              </div>
            )}

            <div className="flex flex-col-reverse justify-between gap-2.5 sm:flex-row">
              {back(1)}
              <button type="button" disabled={busy || lowKolo} onClick={confirm}
                className={`${primary} ${!busy && !lowKolo ? 'cursor-pointer bg-rose text-white hover:bg-rose-dark' : 'cursor-not-allowed bg-[#efe7ec] text-[#6b5a65]'}`}>
                {busy ? t('common.loading') : t('bookPage.confirm')}
              </button>
            </div>
          </section>
        )}

        {/* Done */}
        {step === 3 && booked && (
          <section className="step-in flex flex-col items-center gap-4 rounded-[28px] bg-white px-6 py-10 text-center ring-1 ring-line">
            <span className="flex h-20 w-20 items-center justify-center rounded-full bg-[#e9f7ee] text-[#1d6b3a]">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12l5 5L20 7" /></svg>
            </span>
            <h2 className="m-0 text-[28px] font-extrabold">{t('bookPage.doneTitle')}</h2>
            <p className="m-0 max-w-md text-[15px] text-muted">{t('bookPage.doneBody').replace('{time}', clock(booked.time))}</p>
            <div className="mt-1 rounded-[22px] bg-rose px-8 py-5 text-white">
              <div className="text-xs font-semibold uppercase tracking-[0.08em] text-rose-tint">{t('bookPage.queueNo')}</div>
              <div className="font-display text-5xl font-extrabold leading-none">#{booked.queueNumber}</div>
              <div className="mt-2 text-sm text-rose-tint">{booked.patientName} · {booked.serviceName}</div>
              <div className="text-sm text-rose-tint">{dayParts(booked.date).long} · {clock(booked.time)}</div>
            </div>
            <div className="mt-2 flex w-full flex-col gap-2.5 sm:w-auto sm:flex-row">
              <button type="button" onClick={() => navigate('/home')} className={`${primary} cursor-pointer bg-plum text-white hover:bg-plum-dark`}>{t('bookPage.goHome')}</button>
              <Link to="/book" className={`${primary} border-[1.5px] border-line bg-white text-ink no-underline hover:bg-blush`}>{t('bookPage.another')}</Link>
            </div>
          </section>
        )}
      </div>
    </PatientShell>
  )
}
