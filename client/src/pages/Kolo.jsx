import { useCallback, useEffect, useRef, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { gsap } from 'gsap'
import { useGSAP } from '@gsap/react'
import PatientShell from '../components/PatientShell.jsx'
import { api } from '../api.js'
import { useAuth } from '../auth.jsx'
import { useT } from '../i18n/index.jsx'

gsap.registerPlugin(useGSAP)

const naira = (n) => `₦${Number(n || 0).toLocaleString('en-NG')}`
const QUICK = [500, 1000, 2000, 5000]
const when = (iso) => new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Africa/Lagos' }).format(new Date(iso))

// How each kind of Kolo movement looks: sign, colour and icon.
const KIND = {
  topup: { sign: '+', tone: 'text-[#1d6b3a]', chip: 'bg-[#e9f7ee] text-[#1d6b3a]', icon: 'M12 5v14M5 12h14' },
  refund: { sign: '+', tone: 'text-[#1d6b3a]', chip: 'bg-[#e9f7ee] text-[#1d6b3a]', icon: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5' },
  hold: { sign: '−', tone: 'text-plum', chip: 'bg-plum-tint text-plum', icon: 'M6 11V8a6 6 0 0 1 12 0v3M5 11h14v10H5z' },
  deduct: { sign: '−', tone: 'text-ink', chip: 'bg-[#f1edf3] text-ink', icon: 'M20 6 9 17l-5-5' },
  forfeit: { sign: '−', tone: 'text-rose', chip: 'bg-blush text-rose', icon: 'M18 6 6 18M6 6l12 12' },
}

function Balance({ value, className }) {
  const ref = useRef(null)
  const last = useRef(value)
  useGSAP(() => {
    const el = ref.current
    const from = last.current
    last.current = value
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || from === value) { el.textContent = naira(value); return }
    const o = { n: from }
    gsap.to(o, { n: value, duration: 0.8, ease: 'power2.out', onUpdate: () => { el.textContent = naira(Math.round(o.n)) } })
  }, { dependencies: [value] })
  return <span ref={ref} className={className}>{naira(value)}</span>
}

export default function Kolo() {
  const { t } = useT()
  const { user, checking } = useAuth()
  const [kolo, setKolo] = useState(null)
  const [history, setHistory] = useState(null)
  const [amount, setAmount] = useState(1000)
  const [custom, setCustom] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState(null) // { ok: boolean, text }

  const load = useCallback(async () => {
    const [k, h] = await Promise.all([api('/kolo'), api('/kolo/transactions?limit=100')])
    setKolo(k)
    setHistory(h.transactions)
  }, [])
  useEffect(() => { if (user) load().catch(() => setNote({ ok: false, text: t('dash.loadError') })) }, [user, load, t])

  const chosen = custom ? Number(custom.replace(/\D/g, '')) : amount
  const valid = Number.isInteger(chosen) && chosen >= 100 && chosen <= 100000

  async function addMoney(e) {
    e.preventDefault()
    if (!valid) { setNote({ ok: false, text: t('koloPage.needAmount') }); return }
    setBusy(true)
    setNote(null)
    try {
      await api('/kolo/topup', { method: 'POST', body: { amount: chosen } })
      await load()
      setCustom('')
      setNote({ ok: true, text: t('koloPage.added').replace('{amount}', naira(chosen)) })
    } catch (err) {
      setNote({ ok: false, text: t(`errors.${err.code}`) !== `errors.${err.code}` ? t(`errors.${err.code}`) : t('errors.server_error') })
    } finally {
      setBusy(false)
    }
  }

  if (checking) return null
  if (!user) return <Navigate to="/login" replace />

  return (
    <PatientShell>
      <div className="flex flex-col gap-5">
        <div>
          <h1 className="m-0 text-[30px] font-extrabold leading-tight">{t('koloPage.title')}</h1>
          <p className="m-0 mt-1 text-[15px] text-muted">{t('koloPage.sub')}</p>
        </div>

        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="flex flex-col gap-5">
            {/* Balance */}
            <section className="relative overflow-hidden rounded-[28px] bg-[linear-gradient(150deg,var(--color-plum)_0%,var(--color-plum-dark)_100%)] p-6 text-white shadow-[0_24px_50px_rgba(90,45,176,0.25)] sm:p-7">
              <div aria-hidden="true" className="pointer-events-none absolute -right-14 -top-14 h-52 w-52 rounded-full bg-white/[0.07]" />
              <span className="relative text-sm font-semibold text-white/80">{t('koloPage.available')}</span>
              <div className="relative mt-1"><Balance value={kolo?.available ?? 0} className="font-display text-[44px] font-extrabold leading-none" /></div>
              <div className="relative mt-5 flex flex-wrap items-center gap-3">
                <span className="rounded-full bg-white/15 px-3.5 py-1.5 text-sm">{t('koloPage.reserved')}: <b>{naira(kolo?.reserved ?? 0)}</b></span>
              </div>
              <p className="relative m-0 mt-4 text-xs text-white/75">{t('koloPage.simulated')}</p>
            </section>

            {/* History */}
            <section className="rounded-[24px] bg-white p-5 ring-1 ring-line sm:p-6">
              <h2 className="m-0 mb-3 text-lg font-bold">{t('koloPage.history')}</h2>
              {history === null ? (
                <div aria-hidden="true" className="h-40 animate-pulse rounded-2xl bg-[#efe7ec]" />
              ) : history.length === 0 ? (
                <p className="m-0 rounded-2xl border border-dashed border-line p-6 text-center text-sm text-muted">{t('koloPage.empty')}</p>
              ) : (
                <ul className="m-0 flex list-none flex-col divide-y divide-line p-0">
                  {history.map((tx) => {
                    const k = KIND[tx.type]
                    const v = tx.appointment
                    return (
                      <li key={tx.id} className="flex items-center gap-3 py-3.5 first:pt-0 last:pb-0">
                        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${k.chip}`}>
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={k.icon} /></svg>
                        </span>
                        <span className="min-w-0 flex-1">
                          <b className="block text-[15px]">{t(`koloPage.types.${tx.type}`)}</b>
                          {v && <span className="block truncate text-sm text-muted">{v.patientName} · {v.departmentName}, {v.clinicName}</span>}
                          <span className="block text-xs text-muted">{when(tx.createdAt)}</span>
                        </span>
                        <b className={`shrink-0 font-display text-[16px] ${k.tone}`}>{k.sign}{naira(tx.amount)}</b>
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>
          </div>

          <div className="flex flex-col gap-5">
            {/* Add money */}
            <form onSubmit={addMoney} className="flex flex-col gap-4 rounded-[24px] bg-white p-5 ring-1 ring-line sm:p-6">
              <h2 className="m-0 text-lg font-bold">{t('koloPage.addTitle')}</h2>
              <div className="grid grid-cols-2 gap-2.5">
                {QUICK.map((n) => {
                  const on = !custom && amount === n
                  return (
                    <button key={n} type="button" aria-pressed={on} onClick={() => { setAmount(n); setCustom(''); setNote(null) }}
                      className={`min-h-12 cursor-pointer rounded-2xl border-[1.5px] font-display text-base font-bold transition-colors ${on ? 'border-plum bg-plum-tint text-plum' : 'border-line bg-white text-ink hover:border-plum-soft'}`}>
                      {naira(n)}
                    </button>
                  )
                })}
              </div>
              <label className="flex flex-col gap-1.5">
                <span className="text-sm font-semibold">{t('koloPage.other')}</span>
                <span className="relative">
                  <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 font-bold text-muted">₦</span>
                  <input inputMode="numeric" value={custom} onChange={(e) => { setCustom(e.target.value.replace(/\D/g, '').slice(0, 6)); setNote(null) }}
                    placeholder={t('koloPage.amountPh')} className="min-h-12 w-full rounded-[14px] border-[1.5px] border-line bg-white pl-8 pr-3 text-base text-ink" />
                </span>
              </label>
              {note && <p role={note.ok ? 'status' : 'alert'} className={`m-0 text-sm font-semibold ${note.ok ? 'text-[#1d6b3a]' : 'text-rose'}`}>{note.text}</p>}
              <button type="submit" disabled={busy}
                className={`min-h-[52px] rounded-2xl border-0 text-base font-bold ${valid && !busy ? 'cursor-pointer bg-rose text-white hover:bg-rose-dark' : 'cursor-not-allowed bg-[#efe7ec] text-[#6b5a65]'}`}>
                {busy ? t('common.loading') : t('koloPage.addBtn').replace('{amount}', valid ? naira(chosen) : '')}
              </button>
            </form>

            <section className="rounded-[24px] bg-plum-tint p-5">
              <h2 className="m-0 text-base font-bold">{t('koloPage.how')}</h2>
              <p className="m-0 mt-2 text-sm leading-relaxed text-muted">{t('koloPage.howBody')}</p>
            </section>
          </div>
        </div>
      </div>
    </PatientShell>
  )
}
