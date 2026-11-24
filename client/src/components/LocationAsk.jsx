import { useEffect, useRef, useState } from 'react'
import { gsap } from 'gsap'
import { getPosition, locationError } from '../lib/geo.js'

export async function permissionState() {
  try { return (await navigator.permissions.query({ name: 'geolocation' })).state } catch { return 'prompt' }
}

const Pin = ({ size = 30 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.5" /></svg>
)

// Our own friendly ask before the browser's location prompt.
// request(): already allowed (or reported blocked) -> really try; the help box shows only if it fails;
// otherwise -> explain first, and only ask the browser if the person taps Allow.
export function useLocationAsk({ t, onPosition, onStatus }) {
  const [box, setBox] = useState(null) // null | 'ask' | 'blocked'
  const [detail, setDetail] = useState('') // the browser's exact reason, shown small for troubleshooting

  async function locate() {
    onStatus('locating')
    try {
      onPosition(await getPosition())
      onStatus('idle')
    } catch (e) {
      const why = locationError(e)
      onStatus(why)
      setDetail(`${e?.message || 'no message'} (code ${e?.code ?? '?'})`)
      if (why === 'blocked') setBox('blocked')
    }
  }

  async function request() {
    if (!window.isSecureContext) { onStatus('insecure'); return }
    const state = await permissionState()
    // Safari can keep reporting an old "denied" after the person changes their settings,
    // so when it says denied we still really try; the help box only shows if that fails.
    if (state === 'granted' || state === 'denied') return locate()
    setBox('ask')
  }

  const modal = box && (
    <LocationBox kind={box} t={t} detail={detail}
      onAllow={() => { setBox(null); locate() }}
      onClose={() => { setBox(null); onStatus('idle') }} />
  )
  return { request, modal }
}

function LocationBox({ kind, t, detail, onAllow, onClose }) {
  const card = useRef(null)
  const first = useRef(null)
  const closeRef = useRef(onClose)
  useEffect(() => { closeRef.current = onClose })
  useEffect(() => {
    first.current?.focus()
    const onKey = (e) => { if (e.key === 'Escape') closeRef.current() }
    document.addEventListener('keydown', onKey)
    if (card.current && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      gsap.fromTo(card.current, { opacity: 0, y: 24, scale: 0.96 }, { opacity: 1, y: 0, scale: 1, duration: 0.3, ease: 'back.out(1.4)' })
    }
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const ask = kind === 'ask'
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-[#22121c]/45 p-4 backdrop-blur-[2px] sm:items-center" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div ref={card} role="dialog" aria-modal="true" aria-labelledby="loc-title" className="w-full max-w-[420px] rounded-[28px] bg-white p-6 text-center shadow-[0_30px_70px_rgba(34,18,28,0.3)] sm:p-7">
        <span className={`mx-auto flex h-16 w-16 items-center justify-center rounded-full ${ask ? 'bg-blush text-rose' : 'bg-plum-tint text-plum'}`}><Pin /></span>
        <h2 id="loc-title" className="m-0 mt-4 text-[22px] font-extrabold leading-tight">{ask ? t('loc.title') : t('loc.blockedTitle')}</h2>
        <p className="m-0 mt-2 text-[15px] leading-relaxed text-muted">{ask ? t('loc.body') : t('loc.blockedBody')}</p>
        {ask ? (
          <p className="m-0 mt-3 flex items-center justify-center gap-1.5 text-[13px] font-semibold text-[#1d6b3a]">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
            {t('loc.privacy')}
          </p>
        ) : (
          <ol className="m-0 mt-4 list-none rounded-2xl bg-plum-tint p-4 text-left text-sm leading-relaxed text-ink">
            <li><b>Safari:</b> {t('loc.safari')}</li>
            <li className="mt-2"><b>Chrome:</b> {t('loc.chrome')}</li>
          </ol>
        )}
        {!ask && detail && (
          <p className="m-0 mt-3 text-[11px] text-muted">Browser said: {detail}</p>
        )}
        <div className="mt-6 flex flex-col gap-2.5">
          {ask && (
            <button ref={first} type="button" onClick={onAllow} className="min-h-[52px] cursor-pointer rounded-2xl border-0 bg-rose text-base font-bold text-white hover:bg-rose-dark">{t('loc.allow')}</button>
          )}
          <button ref={ask ? undefined : first} type="button" onClick={onClose}
            className={`min-h-[52px] cursor-pointer rounded-2xl text-base font-bold ${ask ? 'border-0 bg-transparent text-muted hover:bg-cream' : 'border-0 bg-plum text-white hover:bg-plum-dark'}`}>
            {ask ? t('loc.notNow') : t('loc.ok')}
          </button>
        </div>
      </div>
    </div>
  )
}
