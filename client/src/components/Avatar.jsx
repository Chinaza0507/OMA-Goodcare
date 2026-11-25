// A friendly cartoon character for each person, instead of a plain letter. Skin tone, hair
// (low cut, afro, braids in a bun, gele headwrap, twists) and clothes are picked from the
// person's id, so everyone keeps the same character. The eyes blink now and then.
const SKIN = ['#8d5524', '#6b3e1f', '#a0663b', '#5a3418', '#c68642', '#7a4a2a']
const CLOTHES = ['#5a2db0', '#8c1d52', '#1d6b3a', '#c98d14', '#2b6cb0', '#b5446e']
const GELE = ['#e0a526', '#c8102e', '#5a2db0', '#1d8a6b']
const HAIR = '#1b1110'

const hash = (s) => [...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7)

function Hair({ style, gele }) {
  switch (style) {
    case 0: // low cut
      return <path d="M30 44c0-14 9-22 20-22s20 8 20 22c-3-7-10-11-20-11s-17 4-20 11z" fill={HAIR} />
    case 1: // afro
      return <><circle cx="50" cy="38" r="25" fill={HAIR} /><circle cx="31" cy="44" r="9" fill={HAIR} /><circle cx="69" cy="44" r="9" fill={HAIR} /></>
    case 2: // braids in a bun
      return <><circle cx="50" cy="16" r="9" fill={HAIR} /><path d="M29 46c0-16 9-24 21-24s21 8 21 24c-4-9-11-13-21-13s-17 4-21 13z" fill={HAIR} /><path d="M38 24l4 10M50 22v11M62 24l-4 10" stroke="#3a2420" strokeWidth="2" /></>
    case 3: // gele headwrap
      return <><path d="M24 40c2-18 14-26 26-26s24 8 26 26c-8-6-16-8-26-8s-18 2-26 8z" fill={gele} /><path d="M50 14c8-8 22-6 24 2-6 0-12 2-16 6z" fill={gele} /><path d="M50 14c-8-8-22-6-24 2 6 0 12 2 16 6z" fill={gele} /><path d="M28 34c8-4 15-5 22-5s14 1 22 5" stroke="rgba(255,255,255,0.35)" strokeWidth="2" fill="none" /></>
    default: // twists
      return <><path d="M28 46c0-16 10-25 22-25s22 9 22 25c-4-8-11-12-22-12s-18 4-22 12z" fill={HAIR} />{[32, 40, 48, 56, 64].map((x) => <rect key={x} x={x} y="18" width="5" height="14" rx="2.5" fill={HAIR} />)}</>
  }
}

export default function Avatar({ seed, size = 64, className = '' }) {
  const h = hash(seed)
  const skin = SKIN[h % SKIN.length]
  const clothes = CLOTHES[(h >> 3) % CLOTHES.length]
  const style = (h >> 6) % 5
  const gele = GELE[(h >> 9) % GELE.length]
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} className={`shrink-0 rounded-full bg-plum-tint ${className}`} aria-hidden="true">
      <clipPath id={`av-${h}`}><circle cx="50" cy="50" r="50" /></clipPath>
      <g clipPath={`url(#av-${h})`}>
        <path d="M16 100c2-18 16-28 34-28s32 10 34 28z" fill={clothes} />
        <rect x="44" y="62" width="12" height="12" rx="4" fill={skin} />
        <ellipse cx="50" cy="46" rx="20" ry="22" fill={skin} />
        <ellipse cx="30" cy="48" rx="4" ry="6" fill={skin} />
        <ellipse cx="70" cy="48" rx="4" ry="6" fill={skin} />
        <Hair style={style} gele={gele} />
        <g className="avatar-blink">
          <ellipse cx="42" cy="48" rx="2.6" ry="3.2" fill="#1b1110" />
          <ellipse cx="58" cy="48" rx="2.6" ry="3.2" fill="#1b1110" />
        </g>
        <path d="M43 57c4 4 10 4 14 0" stroke="#3a1c14" strokeWidth="2.4" fill="none" strokeLinecap="round" />
        <ellipse cx="36" cy="55" rx="4" ry="2.4" fill="#e0707a" opacity="0.35" />
        <ellipse cx="64" cy="55" rx="4" ry="2.4" fill="#e0707a" opacity="0.35" />
      </g>
    </svg>
  )
}
