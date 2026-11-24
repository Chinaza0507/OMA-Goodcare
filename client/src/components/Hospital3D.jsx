// A 3D-style (oblique) hospital: each block has a lit front, a shaded side and a rooftop,
// plus a raised cross sign, an entrance canopy and round trees. It fades out at the bottom.
const INK = '#3a1a78'
const DX = 36 // how far the depth goes right
const DY = 22 // and up

// One block: front rectangle, side face and roof, drawn as polygons.
function Block({ x, w, top, ground = 330, front, side, roof = 'url(#h3d-roof)', dx = DX, dy = DY }) {
  return (
    <g stroke={INK} strokeWidth="2.5" strokeLinejoin="round">
      <polygon points={`${x + w},${top} ${x + w + dx},${top - dy} ${x + w + dx},${ground - dy} ${x + w},${ground}`} fill={side} />
      <polygon points={`${x},${top} ${x + w},${top} ${x + w + dx},${top - dy} ${x + dx},${top - dy}`} fill={roof} />
      <rect x={x} y={top} width={w} height={ground - top} fill={front} />
    </g>
  )
}

// Windows on a front face.
function FrontWindows({ cols, rows, w = 22, h = 22 }) {
  return rows.map((y) => cols.map((x) => (
    <g key={`${x}-${y}`}>
      <rect x={x} y={y} width={w} height={h} rx="3" fill="url(#h3d-glass)" stroke={INK} strokeWidth="2" />
      <path d={`M${x + 4} ${y + h - 5} L${x + w - 6} ${y + 4}`} stroke="#fff" strokeWidth="2" opacity="0.8" />
    </g>
  )))
}

// Windows on a side face: drawn flat, then slanted onto the side with a matrix.
function SideWindows({ x, top, rows, h = 22 }) {
  return (
    <g transform={`matrix(1,${-DY / DX},0,1,${x},${top})`}>
      {rows.map((v) => <rect key={v} x="10" y={v} width="16" height={h} rx="2" fill="#a993e6" stroke={INK} strokeWidth="2" />)}
    </g>
  )
}

function Tree({ x, s = 1 }) {
  return (
    <g>
      <ellipse cx={x + 6} cy={330} rx={22 * s} ry={5 * s} fill={INK} opacity="0.15" />
      <path d={`M${x} 330 V${330 - 34 * s}`} stroke={INK} strokeWidth="3" strokeLinecap="round" />
      <circle cx={x} cy={330 - 48 * s} r={24 * s} fill="url(#h3d-tree)" stroke={INK} strokeWidth="2.5" />
      <circle cx={x - 8 * s} cy={330 - 56 * s} r={6 * s} fill="#fff" opacity="0.6" />
    </g>
  )
}

export default function Hospital3D({ className = '' }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 640 332" preserveAspectRatio="xMidYMax meet" className={className}>
      <defs>
        <linearGradient id="h3d-frontL" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ffffff" /><stop offset="1" stopColor="#ece4fb" /></linearGradient>
        <linearGradient id="h3d-sideL" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#c9b6f4" /><stop offset="1" stopColor="#a78fe6" /></linearGradient>
        <linearGradient id="h3d-frontP" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#fffafc" /><stop offset="1" stopColor="#f9dfea" /></linearGradient>
        <linearGradient id="h3d-sideP" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#eab9ce" /><stop offset="1" stopColor="#d696b3" /></linearGradient>
        <linearGradient id="h3d-roof" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stopColor="#ffffff" /><stop offset="1" stopColor="#efe8fc" /></linearGradient>
        <linearGradient id="h3d-glass" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#e5dcfb" /><stop offset="1" stopColor="#b9a6ef" /></linearGradient>
        <radialGradient id="h3d-tree" cx="0.35" cy="0.3" r="0.8"><stop offset="0" stopColor="#efe8fc" /><stop offset="1" stopColor="#a993e6" /></radialGradient>
      </defs>

      <g>

        {/* left wing (pink) */}
        <Block x={62} w={118} top={196} front="url(#h3d-frontP)" side="url(#h3d-sideP)" />
        <FrontWindows cols={[80, 114, 148]} rows={[220, 264]} w={20} h={20} />

        {/* main block */}
        <Block x={170} w={252} top={104} front="url(#h3d-frontL)" side="url(#h3d-sideL)" />
        <FrontWindows cols={[194, 238, 332, 376]} rows={[130, 174, 218]} w={26} h={24} />
        <SideWindows x={422} top={104} rows={[28, 72, 116]} h={24} />

        {/* raised cross sign on the roof */}
        <Block x={272} w={48} top={46} ground={92} front="#8c1d52" side="#6f1641" roof="#b4467a" dx={18} dy={11} />
        <path d="M296 56 V82 M283 69 H309" stroke="#fff" strokeWidth="6" strokeLinecap="round" />

        {/* entrance: canopy slab and door */}
        <rect x="266" y="272" width="60" height="58" rx="4" fill="url(#h3d-sideL)" stroke={INK} strokeWidth="2.5" />
        <path d="M296 272 V330" stroke={INK} strokeWidth="2.5" />
        <Block x={252} w={88} top={258} ground={268} front="#ffffff" side="#d6c6ff" roof="#fbe3ee" dx={20} dy={12} />

        {/* right wing */}
        <Block x={442} w={118} top={176} front="url(#h3d-frontL)" side="url(#h3d-sideL)" />
        <FrontWindows cols={[460, 494, 528]} rows={[200, 242, 284]} w={20} h={20} />
        <SideWindows x={560} top={176} rows={[22, 64, 106]} h={20} />

        <Tree x={44} s={0.9} />
        <Tree x={600} s={1} />
        <Tree x={622} s={0.7} />
      </g>
    </svg>
  )
}
