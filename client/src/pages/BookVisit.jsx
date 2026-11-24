import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { gsap } from 'gsap'
import { useGSAP } from '@gsap/react'
import PatientShell from '../components/PatientShell.jsx'
import { api } from '../api.js'
import { useAuth } from '../auth.jsx'
import { useT } from '../i18n/index.jsx'

gsap.registerPlugin(useGSAP)

const LAGOS = 'Africa/Lagos'
const naira = (n) => `₦${Number(n || 0).toLocaleString('en-NG')}`
const clock = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number)
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`
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
const ALERTS = [1, 2, 3, 4, 5, 7, 10]

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
  const scope = useRef(null)

  const [clinic, setClinic] = useState(null)
  const [family, setFamily] = useState([])
  const [kolo, setKolo] = useState(null)
  const [loadError, setLoadError] = useState('')

  const [step, setStep] = useState(1) // 0 = hospital (already chosen), 1 time, 2 who, 3 confirm, 4 done
  const [deptId, setDeptId] = useState(null)
  const date = useMemo(() => todayLagos(), []) // same-day booking only
  const [slots, setSlots] = useState(null)
  const [slotsRefresh, setSlotsRefresh] = useState(0)
  const [time, setTime] = useState(null)
  const [memberId, setMemberId] = useState(null)
  const [alertAhead, setAlertAhead] = useState(null)
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
        setDeptId((d) => d ?? (c.clinic.departments.length === 1 ? c.clinic.departments[0].id : null))
        setMemberId((m) => m ?? f.members.find((x) => x.isSelf)?.id ?? null)
      })
      .catch((e) => setLoadError(msg(e.code)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clinicId, user])

  // Free arrival times for the chosen department and day.
  useEffect(() => {
    if (!deptId) return
    let live = true
    setSlots(null)
    setTime(null)
    api(`/clinics/departments/${deptId}/slots?date=${date}`)
      .then((d) => { if (live) setSlots(d.slots.filter((s) => s.available).map((s) => s.time)) })
      .catch(() => { if (live) setSlots([]) })
    return () => { live = false }
  }, [deptId, date, slotsRefresh])

  const dept = clinic?.departments.find((d) => d.id === deptId)
  const member = family.find((m) => m.id === memberId)
  const deposit = clinic?.depositNaira ?? 0
  const lowKolo = kolo && deposit > 0 && kolo.available < deposit
  const alertValue = alertAhead ?? user?.alertAhead ?? 3

  // Gentle slide when the step changes.
  useGSAP(() => {
    if (document.hidden || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    gsap.fromTo('.step-in', { x: 18, opacity: 0 }, { x: 0, opacity: 1, duration: 0.4, stagger: 0.05, ease: 'power3.out', clearProps: 'opacity,transform' })
    // Safety net if the browser throttles animations: never leave a step half-faded.
    const safety = setTimeout(() => {
      const els = scope.current?.querySelectorAll('.step-in') ?? []
      gsap.killTweensOf(els)
      gsap.set(els, { clearProps: 'opacity,transform' })
    }, 1200)
    return () => clearTimeout(safety)
  }, { scope, dependencies: [step, !!clinic] })

  async function confirm() {
    if (busy || lowKolo) return
    setBusy(true)
    setError('')
    try {
      const d = await api('/appointments', { method: 'POST', body: { familyMemberId: memberId, departmentId: deptId, date, time, alertAhead: alertValue } })
      setBooked(d.appointment)
      setStep(4)
    } catch (e) {
      setError(msg(e.code))
      if (e.code === 'slot_taken' || e.code === 'slot_past') { setStep(1); setSlotsRefresh((n) => n + 1) }
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
      <div ref={scope} className="mx-auto flex max-w-3xl flex-col gap-5">
        <div className="flex items-center gap-3">
          <Link to="/book" aria-label={t('bookPage.back')} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-line bg-white text-ink no-underline hover:bg-blush">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M19 12H5M11 18l-6-6 6-6" /></svg>
          </Link>
          <div className="min-w-0">
            <h1 className="m-0 text-[26px] font-extrabold leading-tight">{t('bookPage.title')}</h1>
            {clinic && <p className="m-0 truncate text-sm text-muted">{clinic.name} · {[clinic.area, clinic.state].filter(Boolean).join(', ')}</p>}
          </div>
        </div>

        {step < 4 && <Stepper step={step} t={t} />}

        {loadError && <p role="alert" className="m-0 rounded-2xl bg-white p-5 text-muted ring-1 ring-line">{loadError}</p>}
        {!clinic && !loadError && <div aria-hidden="true" className="h-[360px] animate-pulse rounded-[24px] bg-[#efe7ec]" />}

        {error && (
          <p role="alert" className="m-0 flex items-center gap-2 rounded-2xl border border-rose-line bg-blush px-4 py-3 text-[15px] font-semibold text-rose">{error}</p>
        )}

        {/* Step 1: department, day, arrival time */}
        {clinic && step === 1 && (
          <section className="flex flex-col gap-6 rounded-[24px] bg-white p-5 ring-1 ring-line sm:p-6">
            <div className="step-in">
              <h2 className="m-0 mb-3 text-base font-bold">{t('bookPage.department')}</h2>
              <div className="grid gap-2.5 sm:grid-cols-2">
                {clinic.departments.map((d) => (
                  <Choice key={d.id} on={deptId === d.id} onClick={() => setDeptId(d.id)} className="flex items-center justify-between gap-3 px-4 py-3.5">
                    <span className="font-bold">{d.name}</span>
                    <span className="text-sm font-semibold text-muted">{d.consultationFee == null ? t('bookPage.feeUnknown') : d.consultationFee === 0 ? t('bookPage.free') : naira(d.consultationFee)}</span>
                  </Choice>
                ))}
              </div>
            </div>

            {dept && (
              <div className="step-in flex items-center gap-3 rounded-2xl bg-plum-tint px-4 py-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-plum text-white">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM16 3v4M8 3v4M3 10h18" /></svg>
                </span>
                <span><b className="block">{t('bookPage.today')} · {dayParts(date).long}</b><span className="text-sm text-muted">{t('bookPage.sameDay')}</span></span>
              </div>
            )}

            {dept && (
              <div className="step-in">
                <h2 className="m-0 text-base font-bold">{t('bookPage.time')}</h2>
                <p className="m-0 mb-3 mt-1 text-sm text-muted">{t('bookPage.timeHelp')}</p>
                {slots === null ? (
                  <p className="m-0 text-sm text-muted">{t('bookPage.loadingTimes')}</p>
                ) : slots.length === 0 ? (
                  <p className="m-0 rounded-2xl border border-dashed border-line p-5 text-center text-sm text-muted">{t('bookPage.noTimes')}</p>
                ) : (
                  <div className="grid max-h-[260px] grid-cols-3 gap-2 overflow-y-auto pr-1 sm:grid-cols-5">
                    {slots.map((s) => (
                      <button key={s} type="button" aria-pressed={time === s} onClick={() => setTime(s)}
                        className={`min-h-11 cursor-pointer rounded-xl border-[1.5px] font-display text-[15px] font-bold transition-colors ${time === s ? 'border-rose bg-rose text-white' : 'border-line bg-white text-ink hover:border-rose-line hover:bg-blush'}`}>
                        {clock(s)}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="flex justify-end">
              <button type="button" disabled={!dept || !time} onClick={() => { setError(''); setStep(2) }}
                className={`${primary} ${dept && time ? 'cursor-pointer bg-plum text-white hover:bg-plum-dark' : 'cursor-not-allowed bg-[#efe7ec] text-[#6b5a65]'}`}>{t('bookPage.next')}</button>
            </div>
          </section>
        )}

        {/* Step 2: who, and when to alert */}
        {clinic && step === 2 && (
          <section className="flex flex-col gap-6 rounded-[24px] bg-white p-5 ring-1 ring-line sm:p-6">
            <div className="step-in">
              <h2 className="m-0 mb-3 text-base font-bold">{t('bookPage.who')}</h2>
              <div className="grid gap-2.5 sm:grid-cols-2">
                {family.map((m) => (
                  <Choice key={m.id} on={memberId === m.id} onClick={() => setMemberId(m.id)} className="flex items-center gap-3 px-4 py-3">
                    <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold ${memberId === m.id ? 'bg-plum text-white' : 'bg-plum-soft text-plum-deep'}`}>
                      {m.name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('')}
                    </span>
                    <span className="min-w-0 flex-1">
                      <b className="block truncate">{m.name}</b>
                      <span className="text-sm text-muted">{m.isSelf ? t('dash.you') : m.age != null ? `${m.age} ${t('famPage.years')}` : ''}</span>
                    </span>
                  </Choice>
                ))}
              </div>
              <Link to="/family" className="mt-3 inline-block text-sm font-bold text-plum no-underline hover:underline">+ {t('dash.addFamily')}</Link>
            </div>

            <div className="step-in">
              <h2 className="m-0 text-base font-bold">{t('bookPage.alert')}</h2>
              <p className="m-0 mb-3 mt-1 text-sm text-muted">{t('bookPage.alertHelp')}</p>
              <div className="flex flex-wrap gap-2">
                {ALERTS.map((n) => (
                  <button key={n} type="button" aria-pressed={alertValue === n} onClick={() => setAlertAhead(n)}
                    className={`min-h-11 min-w-12 cursor-pointer rounded-xl border-[1.5px] px-4 font-display text-base font-bold ${alertValue === n ? 'border-plum bg-plum text-white' : 'border-line bg-white text-ink hover:border-plum-soft'}`}>{n}</button>
                ))}
              </div>
            </div>

            <div className="flex flex-col-reverse justify-between gap-2.5 sm:flex-row">
              {back(1)}
              <button type="button" disabled={!memberId} onClick={() => { setError(''); setStep(3) }}
                className={`${primary} ${memberId ? 'cursor-pointer bg-plum text-white hover:bg-plum-dark' : 'cursor-not-allowed bg-[#efe7ec] text-[#6b5a65]'}`}>{t('bookPage.next')}</button>
            </div>
          </section>
        )}

        {/* Step 3: check and confirm */}
        {clinic && step === 3 && dept && member && time && (
          <section className="flex flex-col gap-5 rounded-[24px] bg-white p-5 ring-1 ring-line sm:p-6">
            <h2 className="step-in m-0 text-lg font-bold">{t('bookPage.review')}</h2>
            <dl className="step-in m-0 grid gap-0 divide-y divide-line rounded-2xl bg-plum-faint px-4 ring-1 ring-line">
              {[
                [t('bookPage.hospital'), `${clinic.name}`],
                [t('bookPage.department'), dept.name],
                [t('visit.for'), member.name],
                [t('visit.when'), `${dayParts(date).long} · ${clock(time)}`],
                [t('bookPage.fee'), dept.consultationFee == null ? t('bookPage.feeUnknown') : dept.consultationFee === 0 ? t('bookPage.free') : naira(dept.consultationFee)],
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
              {back(2)}
              <button type="button" disabled={busy || lowKolo} onClick={confirm}
                className={`${primary} ${!busy && !lowKolo ? 'cursor-pointer bg-rose text-white hover:bg-rose-dark' : 'cursor-not-allowed bg-[#efe7ec] text-[#6b5a65]'}`}>
                {busy ? t('common.loading') : t('bookPage.confirm')}
              </button>
            </div>
          </section>
        )}

        {/* Done */}
        {step === 4 && booked && (
          <section className="step-in flex flex-col items-center gap-4 rounded-[28px] bg-white px-6 py-10 text-center ring-1 ring-line">
            <span className="flex h-20 w-20 items-center justify-center rounded-full bg-[#e9f7ee] text-[#1d6b3a]">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12l5 5L20 7" /></svg>
            </span>
            <h2 className="m-0 text-[28px] font-extrabold">{t('bookPage.doneTitle')}</h2>
            <p className="m-0 max-w-md text-[15px] text-muted">{t('bookPage.doneBody').replace('{time}', clock(booked.time))}</p>
            <div className="mt-1 rounded-[22px] bg-rose px-8 py-5 text-white">
              <div className="text-xs font-semibold uppercase tracking-[0.08em] text-rose-tint">{t('bookPage.queueNo')}</div>
              <div className="font-display text-5xl font-extrabold leading-none">#{booked.queueNumber}</div>
              <div className="mt-2 text-sm text-rose-tint">{booked.patientName} · {booked.departmentName}</div>
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
