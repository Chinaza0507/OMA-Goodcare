import { useEffect, useRef, useState } from 'react'
import { gsap } from 'gsap'
import ConfirmBox from './ConfirmBox.jsx'
import { api } from '../api.js'

const clock = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number)
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`
}
const longDay = (iso) => new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`))

// Details of one visit, with cancel. Early cancel returns the deposit; late cancel asks first.
export default function VisitSheet({ a, t, onClose, onChanged }) {
  const [busy, setBusy] = useState(false)
  const [late, setLate] = useState(null) // { amount } when the server says the deposit would be kept
  const [error, setError] = useState('')
  const card = useRef(null)
  const onCloseRef = useRef(onClose)
  useEffect(() => { onCloseRef.current = onClose })
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !late) onCloseRef.current() }
    document.addEventListener('keydown', onKey)
    if (card.current && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      gsap.fromTo(card.current, { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: 0.3, ease: 'power3.out' })
    }
    return () => document.removeEventListener('keydown', onKey)
  }, [late])

  const msg = (code) => (t(`errors.${code}`) !== `errors.${code}` ? t(`errors.${code}`) : t('errors.server_error'))

  async function cancel(confirm) {
    setBusy(true)
    setError('')
    try {
      await api(`/appointments/${a.id}/cancel`, { method: 'POST', body: { confirm } })
      setLate(null)
      onChanged(t('visit.cancelled'))
    } catch (e) {
      if (e.code === 'needs_confirmation') setLate({ amount: 300 })
      else setError(msg(e.code))
    } finally {
      setBusy(false)
    }
  }

  const rows = [
    [t('visit.for'), a.patientName],
    [t('visit.where'), `${a.departmentName}, ${a.clinicName}`],
    [t('visit.when'), longDay(a.date)],
    [t('visit.arrive'), clock(a.time)],
    [t('visit.deposit'), t(`visit.depositStates.${a.deposit.status}`)],
  ]

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-[#22121c]/40 p-4 backdrop-blur-[2px] sm:items-center" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div ref={card} role="dialog" aria-modal="true" aria-labelledby="visit-title" className="w-full max-w-[440px] rounded-[28px] bg-white p-6 shadow-[0_30px_70px_rgba(34,18,28,0.3)]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="visit-title" className="m-0 text-xl font-extrabold">{t('visit.title')}</h2>
            <span className="mt-1 inline-block rounded-full bg-rose px-3 py-0.5 font-display text-sm font-bold text-white">#{a.queueNumber}</span>
          </div>
          <button type="button" onClick={onClose} aria-label={t('visit.close')} className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-full border border-line bg-white text-muted hover:bg-cream">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>
        <dl className="m-0 mt-4 divide-y divide-line rounded-2xl bg-plum-faint px-4 ring-1 ring-line">
          {rows.map(([k, v]) => (
            <div key={k} className="flex items-start justify-between gap-4 py-3">
              <dt className="text-sm text-muted">{k}</dt>
              <dd className="m-0 text-right text-[15px] font-semibold">{v}</dd>
            </div>
          ))}
        </dl>
        {error && <p role="alert" className="m-0 mt-3 text-sm font-semibold text-rose">{error}</p>}
        {a.canCancel && (
          <>
            {a.cancelRefundsDeposit && a.deposit.status === 'held' && <p className="m-0 mt-4 text-sm text-muted">{t('visit.cancelEarly')}</p>}
            <button type="button" disabled={busy} onClick={() => cancel(false)}
              className="mt-4 min-h-12 w-full cursor-pointer rounded-2xl border-[1.5px] border-[#f3c7cf] bg-white font-bold text-[#c8102e] hover:bg-[#fff5f6] disabled:cursor-wait">
              {busy ? t('common.loading') : t('visit.cancelVisit')}
            </button>
          </>
        )}
      </div>
      {late && (
        <ConfirmBox title={t('visit.lateTitle')} body={t('visit.lateBody').replace('{amount}', late.amount)}
          yes={t('visit.lateYes')} no={t('visit.keep')} danger busy={busy}
          onYes={() => cancel(true)} onNo={() => setLate(null)} />
      )}
    </div>
  )
}
