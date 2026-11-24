import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { connectSocket, pollEvery } from '../lib/socket.js'
import { gsap } from 'gsap'
import Logo from '../components/Logo.jsx'
import { api } from '../api.js'

const clockText = (d) => new Intl.DateTimeFormat('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Africa/Lagos' }).format(d)
const dayText = (d) => new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Africa/Lagos' }).format(d)

// One department tile. The number pulses gently when a new patient is called.
function Tile({ d }) {
  const num = useRef(null)
  const last = useRef(d.nowServing?.queueNumber)
  useEffect(() => {
    const n = d.nowServing?.queueNumber
    if (n === last.current) return
    last.current = n
    if (n == null || !num.current || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    gsap.fromTo(num.current, { scale: 1.25, color: '#ff8fc0' }, { scale: 1, color: '#ffffff', duration: 0.9, ease: 'elastic.out(1, 0.5)' })
  }, [d.nowServing?.queueNumber])

  return (
    <section className="flex flex-col rounded-[28px] bg-white/[0.06] p-[clamp(16px,2vw,32px)] ring-1 ring-white/10">
      <h2 className="m-0 text-[clamp(18px,2vw,30px)] font-extrabold text-[#e3d8fb]">{d.departmentName}</h2>
      <div className="mt-[clamp(8px,1.5vh,20px)] text-[clamp(12px,1vw,16px)] font-bold uppercase tracking-[0.14em] text-[#cdb9e8]">Now serving</div>
      {d.nowServing ? (
        <div className="flex items-end gap-4">
          <span ref={num} className="inline-block origin-left font-display text-[clamp(64px,9vw,150px)] font-extrabold leading-none text-white">#{d.nowServing.queueNumber}</span>
          <span className="pb-[0.6em] text-[clamp(18px,2vw,32px)] font-bold text-white/90">{d.nowServing.firstName}</span>
        </div>
      ) : (
        <span ref={num} className="font-display text-[clamp(40px,5vw,80px)] font-extrabold leading-tight text-white/35">—</span>
      )}
      <div className="mt-auto pt-[clamp(12px,2vh,28px)]">
        <div className="mb-2 text-[clamp(12px,1vw,16px)] font-bold uppercase tracking-[0.14em] text-[#cdb9e8]">Next</div>
        {d.next.length ? (
          <div className="flex flex-wrap gap-2.5">
            {d.next.map((p) => (
              <span key={p.queueNumber} className="rounded-2xl bg-white/10 px-[clamp(10px,1vw,18px)] py-2 text-[clamp(16px,1.6vw,26px)] font-bold text-white">#{p.queueNumber} <span className="font-semibold text-white/75">{p.firstName}</span></span>
            ))}
          </div>
        ) : <span className="text-[clamp(14px,1.3vw,22px)] text-white/50">Nobody waiting</span>}
      </div>
    </section>
  )
}

// Public TV screen for the waiting room: /screen/:clinicId. No login needed.
export default function NowServing() {
  const { clinicId } = useParams()
  const [data, setData] = useState(null)
  const [state, setState] = useState('loading') // loading | ok | missing | offline
  const [now, setNow] = useState(() => new Date())

  const load = useCallback(async () => {
    try {
      setData(await api(`/public/clinics/${clinicId}/now-serving`))
      setState('ok')
    } catch (e) {
      setState(e.status === 404 || e.status === 400 ? 'missing' : 'offline')
    }
  }, [clinicId])

  useEffect(() => {
    load()
    const s = connectSocket()
    s.on('connect', () => { s.emit('join', { clinicId }); load() })
    s.on('queue:changed', load)
    const poll = setInterval(load, pollEvery(30_000))
    const tick = setInterval(() => setNow(new Date()), 10_000)
    return () => { s.disconnect(); clearInterval(poll); clearInterval(tick) }
  }, [clinicId, load])

  const count = data?.departments.length ?? 0
  const cols = count <= 1 ? 'grid-cols-1' : count === 2 ? 'md:grid-cols-2' : count <= 4 ? 'md:grid-cols-2' : 'md:grid-cols-2 xl:grid-cols-3'

  return (
    <div className="flex min-h-screen flex-col bg-[radial-gradient(ellipse_at_top,#4a2394_0%,#2f1563_45%,#1c0b3d_100%)] px-[clamp(16px,3vw,56px)] py-[clamp(16px,3vh,40px)] text-white">
      <header className="mb-[clamp(16px,3vh,40px)] flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Logo width={48} />
          <div>
            <h1 className="m-0 text-[clamp(22px,2.6vw,44px)] font-extrabold leading-tight">{data?.clinic.name ?? 'ỌMA'}</h1>
            <p className="m-0 text-[clamp(13px,1.1vw,18px)] text-[#cdb9e8]">{dayText(now)} · Please wait for your number</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          {state === 'offline' && <span className="rounded-full bg-[#c8102e] px-3 py-1 text-sm font-bold">Reconnecting…</span>}
          <span className="font-display text-[clamp(28px,3.4vw,60px)] font-extrabold tabular-nums">{clockText(now)}</span>
        </div>
      </header>

      {state === 'loading' && <div className="flex-1 animate-pulse rounded-[28px] bg-white/5" />}
      {state === 'missing' && (
        <div className="m-auto max-w-lg text-center">
          <h2 className="m-0 text-3xl font-extrabold">This screen isn’t available</h2>
          <p className="text-lg text-[#cdb9e8]">The hospital may still be waiting for ỌMA approval, or the link is wrong.</p>
        </div>
      )}
      {data && state !== 'missing' && (
        count === 0
          ? <p className="m-auto text-2xl text-[#cdb9e8]">No departments are open yet.</p>
          : <div className={`grid flex-1 auto-rows-fr gap-[clamp(12px,2vw,28px)] ${cols}`}>{data.departments.map((d) => <Tile key={d.departmentId} d={d} />)}</div>
      )}

      <footer className="mt-[clamp(12px,2vh,28px)] text-center text-[clamp(12px,1vw,16px)] text-white/55">
        Book your place and follow the queue on your phone with ỌMA · Good Care
      </footer>
    </div>
  )
}
