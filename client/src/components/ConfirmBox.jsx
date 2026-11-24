import { useEffect, useRef } from 'react'
import { gsap } from 'gsap'

// A small "are you sure?" box. danger = the yes button is red-pink.
export default function ConfirmBox({ title, body, yes, no, onYes, onNo, danger = false, busy = false, children }) {
  const card = useRef(null)
  const noRef = useRef(null)
  const onNoRef = useRef(onNo)
  useEffect(() => { onNoRef.current = onNo })
  useEffect(() => {
    noRef.current?.focus()
    const onKey = (e) => { if (e.key === 'Escape') onNoRef.current() }
    document.addEventListener('keydown', onKey)
    if (card.current && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      gsap.fromTo(card.current, { opacity: 0, y: 20, scale: 0.97 }, { opacity: 1, y: 0, scale: 1, duration: 0.28, ease: 'back.out(1.4)' })
    }
    return () => document.removeEventListener('keydown', onKey)
  }, [])
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-[#22121c]/45 p-4 backdrop-blur-[2px] sm:items-center" onMouseDown={(e) => { if (e.target === e.currentTarget) onNo() }}>
      <div ref={card} role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" className="w-full max-w-[420px] rounded-[26px] bg-white p-6 shadow-[0_30px_70px_rgba(34,18,28,0.3)]">
        <h2 id="confirm-title" className="m-0 text-xl font-extrabold">{title}</h2>
        {body && <p className="m-0 mt-2 text-[15px] leading-relaxed text-muted">{body}</p>}
        {children}
        <div className="mt-6 flex flex-col-reverse gap-2.5 sm:flex-row sm:justify-end">
          <button ref={noRef} type="button" onClick={onNo} className="min-h-12 cursor-pointer rounded-2xl border-[1.5px] border-line bg-white px-5 font-bold text-ink hover:bg-cream">{no}</button>
          <button type="button" disabled={busy} onClick={onYes}
            className={`min-h-12 cursor-pointer rounded-2xl border-0 px-5 font-bold text-white disabled:cursor-wait disabled:opacity-70 ${danger ? 'bg-[#c8102e] hover:bg-[#a00c24]' : 'bg-plum hover:bg-plum-dark'}`}>{yes}</button>
        </div>
      </div>
    </div>
  )
}
