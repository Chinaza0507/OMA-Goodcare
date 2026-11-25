import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { gsap } from 'gsap'
import { useGSAP } from '@gsap/react'
import PatientShell from '../components/PatientShell.jsx'
import HospitalCard from '../components/HospitalCard.jsx'
import { api } from '../api.js'
import { cachedPosition } from '../lib/geo.js'
import { useLocationAsk, permissionState } from '../components/LocationAsk.jsx'
import { useAuth } from '../auth.jsx'
import { COMMON_SERVICES, LAGOS_AREAS, sameService } from '../lib/catalog.js'
import { useT } from '../i18n/index.jsx'

gsap.registerPlugin(useGSAP)

const PinIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.5" /></svg>
)

// Dropdown with its own arrow, spaced away from the edge.
function Select({ label, value, onChange, options, any }) {
  return (
    <label className="relative block">
      <span className="sr-only">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="min-h-12 w-full cursor-pointer appearance-none rounded-[14px] border-[1.5px] border-line bg-white pl-3.5 pr-10 text-[15px] text-ink">
        <option value="">{any}</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
        className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-muted"><path d="m6 9 6 6 6-6" /></svg>
    </label>
  )
}

// "Book": find a hospital — nearest first with the patient's location, or by search / state / area.
export default function FindHospital() {
  const { t } = useT()
  const { user, checking } = useAuth()
  const [pos, setPos] = useState(cachedPosition)
  const [locState, setLocState] = useState('idle') // idle | locating | denied
  const [clinics, setClinics] = useState(null)
  const [places, setPlaces] = useState([])
  const [q, setQ] = useState('')
  const state = '' // Lagos only for now
  const [area, setArea] = useState('')
  const [service, setService] = useState('')
  const [error, setError] = useState(false)
  const scope = useRef(null)

  const load = useCallback(async () => {
    const params = new URLSearchParams()
    if (state) params.set('state', state)
    if (area) params.set('area', area)
    if (pos) { params.set('lat', pos.lat); params.set('lng', pos.lng) }
    try {
      setClinics((await api(`/clinics?${params}`)).clinics)
      setError(false)
    } catch {
      setError(true)
    }
  }, [state, area, pos])

  useEffect(() => { if (user) load() }, [user, load])
  useEffect(() => { api('/clinics/locations').then((d) => setPlaces(d.locations)).catch(() => {}) }, [])

  const { request: locate, modal: locationModal } = useLocationAsk({ t, onPosition: setPos, onStatus: setLocState })
  useEffect(() => {
    if (pos) return
    permissionState().then((s) => { if (s === 'denied') setLocState('blocked') })
  }, [pos])
  const locOff = !pos && (locState === 'blocked' || locState === 'insecure')

  const areas = useMemo(() => [...new Set([...LAGOS_AREAS, ...places.map((p) => p.area).filter(Boolean)])].sort((a, b) => a.localeCompare(b)), [places])
  // Every service offered by the hospitals in the list, for the "Any service" dropdown.
  const services = useMemo(() => [...new Set([...COMMON_SERVICES, ...(clinics ?? []).flatMap((c) => c.departments.flatMap((d) => d.services.map((sv) => sv.name)))])]
    .sort((a, b) => a.localeCompare(b)), [clinics])
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const offers = (c) => !service || c.departments.some((d) => d.services.some((sv) => sameService(sv.name, service)))
    if (!clinics) return clinics
    if (!needle) return clinics.filter(offers)
    // Search by hospital, place, or what you need (e.g. "braces", "eye test").
    return clinics.filter(offers).filter((c) => [c.name, c.area, c.state, c.address, c.landmark, ...c.departments.flatMap((d) => [d.name, ...d.services.map((s) => s.name)])]
      .some((v) => v?.toLowerCase().includes(needle)))
  }, [clinics, q, service])

  useGSAP(() => {
    if (!shown?.length || document.hidden) return
    const mm = gsap.matchMedia()
    mm.add('(prefers-reduced-motion: no-preference)', () => {
      gsap.from('.hosp-in', { y: 16, opacity: 0, duration: 0.5, stagger: 0.05, ease: 'power3.out' })
    })
    const safety = setTimeout(() => {
      const els = scope.current?.querySelectorAll('.hosp-in') ?? []
      gsap.killTweensOf(els)
      gsap.set(els, { clearProps: 'opacity,transform' })
    }, 1600)
    return () => { clearTimeout(safety); mm.revert() }
  }, { scope, dependencies: [shown?.length ?? 0, !!pos] })

  if (checking) return null
  if (!user) return <Navigate to="/login" replace />


  return (
    <PatientShell>
      <div ref={scope} className="flex flex-col gap-5">
        <div>
          <h1 className="m-0 text-[30px] font-extrabold leading-tight">{t('find.title')}</h1>
          <p className="m-0 mt-1 text-[15px] text-muted">{t('find.sub')}</p>
        </div>

        <section className="flex flex-col gap-3 rounded-[24px] bg-white p-4 ring-1 ring-line sm:p-5">
          <div className="flex flex-col gap-3 lg:flex-row">
            <button type="button" onClick={locate} disabled={locState === 'locating'}
              className={`flex min-h-12 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-[14px] border-0 px-5 text-[15px] font-bold disabled:cursor-wait ${locOff ? 'bg-[#f1edf3] text-muted hover:bg-[#ebe5ee]' : pos ? 'bg-plum-tint text-plum hover:bg-plum-tint' : 'bg-rose text-white hover:bg-rose-dark'}`}>
              <PinIcon />{locState === 'locating' ? t('find.locating') : pos ? t('find.refresh') : locOff ? t('find.locationOff') : t('find.useLocation')}
            </button>
            <label className="relative flex-1">
              <span className="sr-only">{t('find.search')}</span>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted"><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></svg>
              <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('find.search')}
                className="min-h-12 w-full rounded-[14px] border-[1.5px] border-line bg-white pl-10 pr-3 text-base text-ink" />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3 lg:max-w-xl">
            <Select label={t('find.service')} value={service} onChange={setService} options={services} any={t('find.anyService')} />
            <Select label={t('find.area')} value={area} onChange={setArea} options={areas} any={t('find.anyArea')} />
          </div>
          {locState === 'unavailable' && <p role="alert" className="m-0 text-sm text-rose">{t('find.why.unavailable')}</p>}
          {locOff && <p className="m-0 text-sm text-muted">{t('find.offNote')}</p>}
        </section>

        {error && <p role="alert" className="m-0 text-[15px] text-muted">{t('dash.loadError')}</p>}

        {shown === null && !error && (
          <div aria-hidden="true" className="grid gap-4 md:grid-cols-2">
            {[0, 1, 2, 3].map((i) => <div key={i} className="h-[190px] animate-pulse rounded-[22px] bg-[#efe7ec]" />)}
          </div>
        )}

        {shown && (
          <>
            <div className="flex items-center justify-between text-sm font-semibold text-muted">
              <span>{shown.length === 1 ? t('find.one') : t('find.count').replace('{n}', shown.length)}</span>
              {pos && <span className="flex items-center gap-1.5 text-plum"><PinIcon />{t('find.nearest')}</span>}
            </div>
            {shown.length === 0 ? (
              <p className="rounded-[22px] border border-dashed border-line bg-white/60 p-8 text-center text-muted">{clinics.length === 0 ? t('find.none') : t('find.empty')}</p>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                {shown.map((c) => <HospitalCard key={c.id} c={c} t={t} />)}
              </div>
            )}
          </>
        )}
      </div>
      {locationModal}
    </PatientShell>
  )
}
