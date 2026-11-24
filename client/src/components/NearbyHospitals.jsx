import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import HospitalCard from './HospitalCard.jsx'
import { api } from '../api.js'
import { cachedPosition } from '../lib/geo.js'
import { useLocationAsk, permissionState } from './LocationAsk.jsx'

// Dashboard section: the 3 nearest hospitals once the patient shares their location.
export default function NearbyHospitals({ t }) {
  const [pos, setPos] = useState(cachedPosition)
  const [status, setStatus] = useState('idle') // idle | locating | denied
  const [clinics, setClinics] = useState(null)

  useEffect(() => {
    if (!pos) return
    api(`/clinics?lat=${pos.lat}&lng=${pos.lng}`).then((d) => setClinics(d.clinics.slice(0, 3))).catch(() => setClinics([]))
  }, [pos])

  const { request, modal } = useLocationAsk({ t, onPosition: setPos, onStatus: setStatus })

  // If this browser has location blocked, don't keep offering the button.
  useEffect(() => {
    if (pos) return
    permissionState().then((s) => { if (s === 'denied') setStatus('blocked') })
  }, [pos])
  const off = status === 'blocked' || status === 'insecure'

  return (
    <section className="dash-in rounded-[24px] bg-white p-5 ring-1 ring-line">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="m-0 text-base font-bold">{t('find.nearTitle')}</h2>
          {!pos && <p className="m-0 mt-0.5 text-sm text-muted">{t('find.nearSub')}</p>}
        </div>
        <Link to="/book" className="text-sm font-bold text-plum no-underline hover:underline">{t('find.seeAll')} →</Link>
      </div>

      {!pos && !off && (
        <button type="button" onClick={request} disabled={status === 'locating'}
          className="mt-4 flex min-h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-2xl border-0 bg-rose text-[15px] font-bold text-white hover:bg-rose-dark disabled:cursor-wait sm:w-auto sm:px-6">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.5" /></svg>
          {status === 'locating' ? t('find.locating') : t('find.useLocation')}
        </button>
      )}
      {off && !pos && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-plum-tint px-4 py-3">
          <span className="text-sm text-muted">{t('find.offNote')}</span>
          <Link to="/book" className="flex min-h-10 items-center rounded-xl bg-rose px-4 text-sm font-bold !text-white no-underline hover:bg-rose-dark">{t('find.searchBtn')}</Link>
        </div>
      )}
      {status === 'unavailable' && <p role="alert" className="m-0 mt-3 text-sm text-rose">{t('find.why.unavailable')}</p>}

      {pos && clinics === null && <div aria-hidden="true" className="mt-4 h-[150px] animate-pulse rounded-[22px] bg-[#efe7ec]" />}
      {pos && clinics?.length === 0 && <p className="m-0 mt-4 text-sm text-muted">{t('find.none')}</p>}
      {pos && clinics?.length > 0 && (
        <div className="mt-4 grid gap-3">
          {clinics.map((c) => <HospitalCard key={c.id} c={c} t={t} compact />)}
        </div>
      )}
      {modal}
    </section>
  )
}
