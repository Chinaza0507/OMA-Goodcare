import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import Logo from '../components/Logo.jsx'
import LangSwitch from '../components/LangSwitch.jsx'
import { useT } from '../i18n/index.jsx'

const wrap = 'mx-auto w-full max-w-[1200px] px-5'
const kicker = 'text-sm font-bold uppercase tracking-[0.06em] text-rose'
const h2 = 'm-0 text-[clamp(1.9rem,3.5vw,2.6rem)] font-extrabold leading-[1.15]'
const card = 'rounded-[22px] border border-line bg-white'
const Check = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#5A2DB0" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="mt-0.5 shrink-0"><path d="M5 12l5 5L20 7" /></svg>
)
const FEATURE_ICONS = [
  'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2',
  'M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10 21a2 2 0 0 0 4 0',
  'M12 4.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zM5.5 7a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM18.5 7a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM8 20v-3.5a4 4 0 0 1 8 0V20M2.5 20v-2.5a3 3 0 0 1 4.6-2.5M21.5 20v-2.5a3 3 0 0 0-4.6-2.5',
  'M4 7h16v3a2 2 0 0 0 0 4v3H4v-3a2 2 0 0 0 0-4z',
]

function Welcome({ words }) {
  const [i, setI] = useState(0)
  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    const id = setInterval(() => setI((n) => (n + 1) % words.length), 2500)
    return () => clearInterval(id)
  }, [words.length])
  return <div key={i} aria-hidden="true" className="oma-word h-[1.4em] font-hand text-[34px] font-semibold leading-[1.4] text-rose">{words[i]}</div>
}

export default function Landing() {
  const { t } = useT()
  const [open, setOpen] = useState(0)
  const L = (k) => t(`landing.${k}`)
  const navLink = 'flex min-h-11 items-center rounded-full px-4 text-[15px] font-semibold text-ink no-underline hover:bg-blush hover:text-rose'

  return (
    <div>
      <header className="border-b border-[#e8ebdd] bg-cream">
        <div className={`${wrap} flex flex-wrap items-center justify-between gap-x-5 gap-y-2 py-2.5`}>
          <nav aria-label="Main" className="hidden flex-wrap gap-x-1 lg:flex">
            <a className={navLink} href="#how">{t('nav.how')}</a>
            <a className={navLink} href="#features">{t('nav.features')}</a>
            <a className={navLink} href="#kolo">{t('nav.kolo')}</a>
            <a className={`${navLink} !font-extrabold`} href="#hospitals">{t('nav.hospitals')}</a>
            <a className={navLink} href="#faq">{t('nav.faq')}</a>
          </nav>
          <Logo className="text-plum lg:hidden" width={44} />
          <div className="flex items-center gap-2.5">
            <div className="hidden sm:block"><LangSwitch /></div>
            <Link to="/login" className="flex min-h-[46px] items-center whitespace-nowrap rounded-full border-[1.5px] border-plum px-5 text-[15px] font-bold text-plum no-underline hover:bg-blush">{t('nav.login')}</Link>
            <Link to="/signup" className="flex min-h-[46px] items-center whitespace-nowrap rounded-full bg-plum px-5 text-[15px] font-bold !text-white no-underline hover:bg-rose">{t('nav.signup')}</Link>
          </div>
        </div>
      </header>

      <section className="flex flex-col items-center gap-8 px-5 pb-24 pt-16 text-center md:pt-24">
        <h1 aria-label="ỌMA Good Care" className="m-0 flex flex-col items-center gap-[0.14em] pt-6 text-[clamp(5rem,19vw,10rem)] font-normal text-plum">
          <svg className="oma-symbol h-auto w-[1.25em]" viewBox="610 195 320 210" aria-hidden="true">
            <g fill="none" stroke="currentColor" strokeLinecap="round">
              <path d="M684 222 C700 258 738 270 768 270 C798 270 836 258 852 222" strokeWidth="18" />
              <path d="M684 382 C700 346 738 332 768 332 C798 332 836 346 852 382" strokeWidth="18" />
              <path d="M628 274 H688 M628 298 H688 M628 322 H688 M848 274 H908 M848 298 H908 M848 322 H908" strokeWidth="12" />
            </g>
            <g fill="currentColor"><circle cx="768" cy="213" r="13" /><circle cx="768" cy="388" r="13" /></g>
            <g className="oma-heart"><circle cx="768" cy="301" r="21" fill="none" stroke="currentColor" strokeWidth="13" /><circle cx="768" cy="301" r="9" fill="currentColor" /></g>
          </svg>
          <span aria-hidden="true" className="flex items-end gap-[0.015em]">
            <svg viewBox="0 0 280 118" aria-hidden="true" className="h-auto w-[2.52em] overflow-visible"><text className="oma-write" x="280" y="92" textAnchor="end" style={{ fontFamily: "'Playfair Display', Georgia, serif", fontWeight: 600, fontSize: '104px', letterSpacing: '4px' }}>ỌMA</text></svg>
            <span className="oma-tag -mb-[0.16em] flex flex-col items-start">
              <span className="text-left font-['Cormorant_Garamond',Georgia,serif] text-[0.15em] font-semibold italic leading-none tracking-[0.02em] text-rose">Good<br />Care</span>
              <svg viewBox="0 0 70 10" aria-hidden="true" className="mt-[0.03em] h-auto w-[0.42em]"><path className="oma-line" d="M1 9 C20 2 45 1 69 2" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" /></svg>
            </span>
          </span>
        </h1>
        <div className="sm:hidden"><LangSwitch /></div>
        <Welcome words={L('welcome')} />
        <p className="m-0 text-[clamp(1.9rem,5vw,3.25rem)] font-extrabold leading-[1.12] tracking-tight font-display">{L('headline')}</p>
        <p className="m-0 max-w-[46rem] text-[1.15rem] leading-relaxed text-muted">{L('sub')}</p>
        <div className="flex w-full max-w-[640px] flex-wrap justify-center gap-3.5">
          <Link to="/signup" className="flex min-h-[66px] flex-[1_1_260px] items-center justify-center rounded-[18px] bg-plum text-[19px] font-bold !text-white no-underline hover:bg-plum-dark">{L('start')}</Link>
          <Link to="/hospital" className="flex min-h-[66px] flex-[1_1_260px] items-center justify-center rounded-[18px] border-2 border-plum text-[19px] font-bold text-plum no-underline hover:bg-blush">{L('runHospital')}</Link>
        </div>
        <div className="flex flex-wrap justify-center gap-x-5 gap-y-1.5 text-[15px] text-muted">
          {L('perks').map((p, i) => (<span key={p}>{i > 0 && <span className="mr-5">·</span>}<b className="text-ink">{p}</b></span>))}
        </div>
      </section>

      <section className="border-t border-line">
        <div className={`${wrap} flex flex-wrap items-center gap-10 py-16`}>
          <div className="flex min-w-0 flex-[1_1_420px] flex-col gap-4">
            <h2 className={`${h2} text-rose`}>{L('liveTitle')}</h2>
            <p className="m-0 max-w-lg text-[1.12rem] leading-relaxed text-muted">{L('liveBody')}</p>
          </div>
          <div className="flex flex-[1_1_300px] flex-col items-center gap-3">
            <p className="m-0 max-w-[320px] -rotate-2 text-center font-hand text-2xl font-semibold leading-tight text-rose">(You fit switch am to English, Yoruba, Igbo or Hausa — na Wazobia we be!)</p>
            <div role="img" aria-label="Example of a live ticket in the ỌMA app, shown in Pidgin" className="box-border flex w-[300px] flex-col gap-3 rounded-[36px] border-[10px] border-ink bg-white px-4 pb-5 pt-4.5">
              <span className="self-start rounded-full bg-blush px-2.5 py-0.5 text-[11px] font-bold text-rose">Pidgin</span>
              <div className="text-[13px] text-muted">Good afternoon o,</div>
              <div className="-mt-2 font-display text-xl font-bold">Ngozi Okafor</div>
              <div className="flex flex-col gap-2.5 rounded-[18px] bg-rose p-3.5 text-white">
                <div className="flex justify-between text-[11px] font-semibold uppercase tracking-wide text-rose-tint"><span>Your line</span><span>P-014</span></div>
                <div className="text-[15px] font-bold">Chidi · Paediatrics</div>
                <div className="flex gap-2">
                  <div className="flex-1 rounded-[10px] bg-white/10 px-2.5 py-2"><div className="font-display text-[26px] font-extrabold leading-none">4th</div><div className="text-[11px] text-rose-tint">for line</div></div>
                  <div className="flex-1 rounded-[10px] bg-white/10 px-2.5 py-2"><div className="font-display text-[26px] font-extrabold leading-none">~25m</div><div className="text-[11px] text-rose-tint">e remain</div></div>
                </div>
                <div className="rounded-[10px] bg-plum-soft p-2 text-center text-[13px] font-bold text-plum-deep">Reach clinic before 11:20 am</div>
              </div>
              <div className="flex items-center gap-2.5 rounded-[14px] border border-line bg-white px-3 py-2.5">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blush text-rose">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10 21a2 2 0 0 0 4 0" /></svg>
                </span>
                <span className="text-xs leading-snug"><strong>Your turn don near!</strong> Start dey come back.</span>
              </div>
              <div className="flex items-center justify-between rounded-[14px] border border-line px-3 py-2.5"><span className="text-xs text-muted">Family Kolo</span><span className="font-display text-base font-bold">₦4,750</span></div>
            </div>
          </div>
        </div>
      </section>

      <section aria-label="The problem" className="border-y border-line">
        <div className={`${wrap} grid gap-6 py-10 sm:grid-cols-3`}>
          {L('problem').map((p) => (
            <div key={p.big}><div className={`font-display text-4xl font-extrabold ${p.big === 'Everyone' || p.big === 'Everybody' ? 'text-ink' : 'text-rose'}`}>{p.big}</div><p className="mt-1.5 text-base leading-relaxed text-muted">{p.body}</p>{p.note && <p className="mt-2 -rotate-1 font-hand text-[22px] font-semibold leading-tight text-rose">{p.note}</p>}</div>
          ))}
        </div>
      </section>

      <section id="how" className={`${wrap} pb-8 pt-[72px]`}>
        <span className={kicker}>{L('howKicker')}</span>
        <h2 className={`${h2} mt-2`}>{L('howTitle')}</h2>
        <div className="mt-7 grid gap-4 md:grid-cols-3">
          {L('steps').map((s, i) => (
            <article key={s.title} className={`${card} flex flex-col gap-3 p-[30px]`}>
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-blush font-display text-xl font-extrabold text-rose">{i + 1}</span>
              <h3 className="m-0 text-[1.3rem] font-extrabold">{s.title}</h3>
              <p className="m-0 text-base leading-relaxed text-muted">{s.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="features" className={`${wrap} pb-[72px] pt-10`}>
        <span className={kicker}>{L('featKicker')}</span>
        <h2 className={`${h2} mt-2 max-w-2xl`}>{L('featTitle')}</h2>
        <div className="mt-7 grid gap-3.5 md:grid-cols-2">
          {L('features').map((f, i) => (
            <div key={f.title} className={`${card} flex gap-[18px] !rounded-[20px] p-7`}>
              <span className="flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-[14px] bg-blush text-rose">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={FEATURE_ICONS[i]} /></svg>
              </span>
              <span className="flex flex-col gap-1"><h3 className="m-0 text-[1.1rem] font-bold">{f.title}</h3><span className="text-base leading-relaxed text-muted">{f.body}</span></span>
            </div>
          ))}
        </div>
      </section>

      <section id="kolo" className="bg-rose text-white">
        <div className={`${wrap} flex flex-wrap items-center gap-9 py-16`}>
          <div className="flex min-w-0 flex-[1_1_420px] flex-col gap-4">
            <span className="flex items-center gap-3">
              <svg width="64" height="72" viewBox="0 0 64 72" aria-hidden="true" className="overflow-visible">
                <circle className="oma-coin" cx="32" cy="2" r="5" fill="#F5C451" stroke="#FFFFFF" strokeWidth="1.5" />
                <circle className="oma-coin" cx="32" cy="2" r="5" fill="#F5C451" stroke="#FFFFFF" strokeWidth="1.5" style={{ animationDelay: '.7s' }} />
                <circle className="oma-coin" cx="32" cy="2" r="5" fill="#F5C451" stroke="#FFFFFF" strokeWidth="1.5" style={{ animationDelay: '1.4s' }} />
                <path d="M23 25 C9 29 4 42 8 54 C12 65 23 70 32 70 C41 70 52 65 56 54 C60 42 55 29 41 25 Z" fill="#F6D9E7" stroke="#FFFFFF" strokeWidth="2" strokeLinejoin="round" />
                <rect x="22" y="18" width="20" height="9" rx="3" fill="#F6D9E7" stroke="#FFFFFF" strokeWidth="2" />
                <path d="M27 22.5 H37" stroke="#8C1D52" strokeWidth="2.6" strokeLinecap="round" />
                <path d="M10 43 C22 48 42 48 54 43" fill="none" stroke="#8C1D52" strokeWidth="2" strokeLinecap="round" opacity="0.55" />
                <path d="M12 53 C24 57.5 40 57.5 52 53" fill="none" stroke="#8C1D52" strokeWidth="2" strokeLinecap="round" strokeDasharray="1 5" opacity="0.6" />
                <ellipse cx="22" cy="36" rx="4" ry="7" fill="#FFFFFF" opacity="0.45" />
              </svg>
              <span className="text-sm font-bold uppercase tracking-[0.06em] text-plum-soft">ỌMA Kolo</span>
            </span>
            <h2 className={h2}>{L('koloTitle')}</h2>
            <p className="m-0 text-[1.1rem] leading-relaxed text-rose-tint">{L('koloBody')}</p>
            <p className="m-0 -rotate-2 font-hand text-[26px] font-semibold text-rose-tint">(small-small, e go full!)</p>
            <a href="#faq" className="flex min-h-[52px] items-center self-start rounded-[14px] border-2 border-white bg-plum px-6 text-base font-bold !text-white no-underline hover:bg-plum-dark">{L('koloBtn')}</a>
          </div>
          <div className="flex flex-[1_1_300px] justify-center">
            <div className="box-border flex w-full max-w-[360px] flex-col gap-3.5 rounded-3xl bg-white p-[22px] text-ink">
              <span className="text-sm text-muted">{L('koloBalance')}</span>
              <span className="font-display text-[2.6rem] font-extrabold leading-none">₦4,750</span>
              <div className="flex flex-col gap-2.5 border-t border-line pt-3 text-[15px]">
                <div className="flex justify-between gap-2.5"><span>Deposit back · Chidi arrived</span><strong>+₦300</strong></div>
                <div className="flex justify-between gap-2.5"><span>Deposit · Chidi, Paediatrics</span><strong>−₦300</strong></div>
                <div className="flex justify-between gap-2.5"><span>You saved</span><strong>+₦1,000</strong></div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="hospitals" className={`${wrap} border-t-2 border-line py-[72px]`}>
        <div className="flex flex-wrap items-center gap-9">
          <div className="flex min-w-0 flex-[1_1_420px] flex-col gap-4">
            <span className="self-start rounded-full border-[1.5px] border-rose-line bg-blush px-4 py-2 text-[15px] font-extrabold uppercase tracking-[0.06em] text-rose">{L('hospKicker')}</span>
            <h2 className={h2}>{L('hospTitle')}</h2>
            <p className="m-0 text-[1.1rem] leading-relaxed text-muted">{L('hospBody')}</p>
            <ul className="m-0 flex list-none flex-col gap-2.5 p-0 text-base">
              {L('hospPoints').map((p) => (<li key={p} className="flex items-start gap-2.5"><Check />{p}</li>))}
            </ul>
          </div>
          <div className={`${card} flex min-w-0 flex-[1_1_360px] flex-col gap-2.5 p-[18px]`}>
            <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-display text-[17px] font-extrabold">Today · GOPD</span><span className="rounded-full bg-blush px-2.5 py-1 text-[13px] font-bold text-rose">Now serving G-011</span></div>
            {[['G-012', 'Baba Musa', 'Arrived'], ['G-013', 'Amaka', 'Arrived'], ['G-014', 'Ifeanyi', 'Not here yet'], ['G-015', 'Halima', 'Arrived']].map(([no, name, st]) => (
              <div key={no} className="flex items-center gap-2.5 rounded-xl px-3 py-2.5">
                <span className="w-14 font-display text-base font-extrabold">{no}</span><span className="flex-1 text-[15px] font-semibold">{name}</span>
                <span className={`whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-bold ${st === 'Arrived' ? 'bg-blush text-plum-deep' : 'bg-[#f7eef2] text-muted'}`}>{st}</span>
              </div>
            ))}
            <div className="flex min-h-12 items-center justify-center rounded-xl bg-plum text-[15px] font-bold text-white">Call next patient</div>
          </div>
        </div>
      </section>

      <section id="faq" className="border-t border-line">
        <div className="mx-auto max-w-[820px] px-5 py-16">
          <h2 className="mb-6 text-center text-[clamp(1.9rem,3.5vw,2.4rem)] font-extrabold">{L('faqTitle')}</h2>
          <div className="flex flex-col gap-2.5">
            {L('faqs').map((q, i) => (
              <div key={q.q} className="rounded-2xl border border-line bg-white">
                <button type="button" aria-expanded={open === i} onClick={() => setOpen(open === i ? -1 : i)} className="flex min-h-[60px] w-full cursor-pointer items-center justify-between gap-3 border-0 bg-transparent px-[18px] py-3.5 text-left font-[inherit] text-[17px] font-bold text-ink">
                  {q.q}<span aria-hidden="true" className="shrink-0 text-[22px] text-rose">{open === i ? '−' : '+'}</span>
                </button>
                {open === i && <p className="m-0 px-[18px] pb-[18px] text-base leading-relaxed text-muted">{q.a}</p>}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-line">
        <div className={`${wrap} flex flex-wrap items-center justify-between gap-6 py-14`}>
          <div className="max-w-[620px]">
            <h2 className="m-0 text-[clamp(1.7rem,3.5vw,2.4rem)] font-extrabold leading-[1.15] text-rose">{L('finalTitle')}</h2>
            <p className="mt-2.5 text-[1.05rem] text-muted">{L('finalSub')}</p>
          </div>
          <Link to="/signup" className="flex min-h-14 items-center rounded-2xl bg-plum px-8 text-[17px] font-extrabold !text-white no-underline hover:bg-plum-dark">{L('start')}</Link>
        </div>
      </section>

      <footer className="bg-ink text-[#e8dce3]">
        <div className={`${wrap} flex flex-wrap justify-between gap-5 py-9 text-sm`}>
          <div className="flex max-w-[360px] flex-col gap-2">
            <span className="flex items-end gap-2 text-white"><span className="flex font-['Marcellus',Georgia,serif] text-[28px] leading-[0.9]"><span className="relative">O<span className="absolute bottom-[-6px] left-1/2 -ml-[2.5px] h-[5px] w-[5px] rounded-full bg-current" /></span>MA</span><span className="font-['Cormorant_Garamond',Georgia,serif] text-sm font-semibold italic leading-none tracking-[0.02em]">Good<br />Care</span></span>
            <span>{L('tagline')}</span>
            <span className="font-semibold text-white">{L('emergency')}</span>
            <span className="flex items-center gap-1.5 font-hand text-[21px] font-semibold text-rose-tint">Made with love for every Nigerian who don wait too long <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7.5-4.6-9.5-9.2C1 8.3 3.2 4.5 7 4.5c2.1 0 3.6 1.1 5 2.9 1.4-1.8 2.9-2.9 5-2.9 3.8 0 6 3.8 4.5 7.3C19.5 16.4 12 21 12 21z" fill="#F6D9E7" /></svg></span>
          </div>
          <nav aria-label={L('footer')} className="flex flex-wrap gap-x-7 gap-y-2.5">
            <a href="#how" className="text-[#e8dce3] underline">{t('nav.how')}</a>
            <a href="#hospitals" className="text-[#e8dce3] underline">{t('nav.hospitals')}</a>
            <a href="#faq" className="text-[#e8dce3] underline">{t('nav.faq')}</a>
            <a href="#" className="text-[#e8dce3] underline">{L('privacy')}</a>
            <a href="#" className="text-[#e8dce3] underline">{L('terms')}</a>
          </nav>
          <span className="basis-full text-[#b9a8b2]">© 2026 ỌMA Good Care</span>
        </div>
      </footer>
    </div>
  )
}
