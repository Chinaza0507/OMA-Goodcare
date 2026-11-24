import { useEffect, useRef, useState } from 'react'
import { gsap } from 'gsap'

const KIND_STYLE = {
  alert: 'bg-rose text-white',
  turn: 'bg-[#c8102e] text-white',
  money: 'bg-plum-soft text-plum-deep',
  booked: 'bg-plum text-white',
  returned: 'bg-[#dff3e6] text-[#1d6b3a]',
  kept: 'bg-blush text-rose',
}
const KIND_ICON = {
  alert: 'M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10 21a2 2 0 0 0 4 0',
  turn: 'M12 9v4M12 17h.01M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  money: 'M12 5v14M5 12h14',
  booked: 'M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM16 3v4M8 3v4M3 10h18',
  returned: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5',
  kept: 'M18 6 6 18M6 6l12 12',
}

const read = (k, fallback) => { try { return JSON.parse(localStorage.getItem(k)) ?? fallback } catch { return fallback } }
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* private mode */ } }

// "Tue 24 Nov · 2:15 pm" in Lagos time.
function stamp(date) {
  const day = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Africa/Lagos' }).format(date)
  const time = new Intl.DateTimeFormat('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Africa/Lagos' }).format(date)
  return `${day} · ${time}`
}

// items: [{ key, time: Date, kind, title, body, live }]. Unread = newer than the last time the
// list was opened (live queue alerts count once per state). Remembered on this device.
export default function NotificationsBell({ items, t }) {
  const [open, setOpen] = useState(false)
  const [seenAt, setSeenAt] = useState(() => read('oma_notif_seen', 0))
  const [seenLive, setSeenLive] = useState(() => read('oma_notif_live', []))
  const wrap = useRef(null)
  const panel = useRef(null)

  const isNew = (n) => (n.live ? !seenLive.includes(n.key) : n.time.getTime() > seenAt)
  const unread = items.filter(isNew).length

  function toggle() {
    if (!open) {
      const now = Date.now()
      const liveKeys = [...new Set([...seenLive, ...items.filter((n) => n.live).map((n) => n.key)])].slice(-50)
      // Keep the "new" dots visible while the panel is open; mark read for next time.
      write('oma_notif_seen', now)
      write('oma_notif_live', liveKeys)
      setOpen(true)
      setTimeout(() => { setSeenAt(now); setSeenLive(liveKeys) }, 2500)
    } else setOpen(false)
  }

  useEffect(() => {
    if (!open) return
    const onDown = (e) => { if (!wrap.current?.contains(e.target)) setOpen(false) }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    if (panel.current && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      gsap.fromTo(panel.current, { opacity: 0, y: -8, scale: 0.97 }, { opacity: 1, y: 0, scale: 1, duration: 0.25, ease: 'power2.out' })
    }
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  return (
    <div ref={wrap} className="relative">
      <button type="button" onClick={toggle} aria-expanded={open} aria-label={t('notif.open').replace('{n}', unread)}
        className={`relative flex h-11 w-11 cursor-pointer items-center justify-center rounded-full border bg-white text-ink transition-colors hover:bg-blush ${open ? 'border-plum' : 'border-line'}`}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={KIND_ICON.alert} /></svg>
        {unread > 0 && (
          <span aria-hidden="true" className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-white bg-[#c8102e] px-1 text-[11px] font-bold text-white">{unread > 9 ? '9+' : unread}</span>
        )}
      </button>

      {open && (
        <div ref={panel} role="dialog" aria-label={t('notif.title')}
          className="absolute right-0 top-[52px] z-30 w-[min(370px,calc(100vw-2.5rem))] origin-top-right overflow-hidden rounded-[22px] bg-white shadow-[0_24px_60px_rgba(34,18,28,0.18)] ring-1 ring-line">
          <div className="border-b border-line px-5 py-4 font-display text-base font-extrabold">{t('notif.title')}</div>
          {items.length === 0 ? (
            <p className="m-0 px-5 py-8 text-center text-sm text-muted">{t('notif.empty')}</p>
          ) : (
            <ul className="m-0 max-h-[60vh] list-none overflow-y-auto p-0">
              {items.map((n) => (
                <li key={n.key} className={`flex gap-3 border-b border-line px-5 py-3.5 last:border-0 ${isNew(n) ? 'bg-plum-faint' : ''}`}>
                  <span className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${KIND_STYLE[n.kind]}`}>
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={KIND_ICON[n.kind]} /></svg>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-start justify-between gap-2">
                      <b className="text-[14px] leading-snug">{n.title}</b>
                      {isNew(n) && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[#c8102e]" aria-label="new" />}
                    </span>
                    {n.body && <span className="mt-0.5 block text-[13px] leading-snug text-muted">{n.body}</span>}
                    <span className="mt-1 block text-[11px] font-semibold text-muted">{stamp(n.time)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
