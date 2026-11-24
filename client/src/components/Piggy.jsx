// The Kolo: a little piggy bank. It floats gently; when money is added (drop changes),
// a coin falls into the slot and the pig gives a happy wiggle. Pure CSS animation.
export default function Piggy({ drop = 0, size = 150 }) {
  return (
    <div className="relative oma-float" style={{ width: size, height: size * 0.86 }} aria-hidden="true">
      {drop > 0 && (
        <svg key={`coin-${drop}`} viewBox="0 0 40 40" className="kolo-coin absolute left-1/2 top-0 z-10" style={{ width: size * 0.2, marginLeft: -size * 0.1 }}>
          <circle cx="20" cy="20" r="17" fill="#f6c443" stroke="#c98d14" strokeWidth="3" />
          <text x="20" y="27" textAnchor="middle" fontSize="20" fontWeight="800" fill="#9a6a0a" fontFamily="system-ui, sans-serif">₦</text>
        </svg>
      )}
      <svg key={`pig-${drop}`} viewBox="0 0 200 172" className={drop > 0 ? 'kolo-wiggle h-full w-full' : 'h-full w-full'}>
        {/* tail */}
        <path d="M20 98c-14-2-14-20 0-18 9 1 6 13-2 9" fill="none" stroke="#f3a7c8" strokeWidth="6" strokeLinecap="round" />
        {/* legs */}
        <rect x="52" y="128" width="22" height="32" rx="9" fill="#f08fb9" />
        <rect x="128" y="128" width="22" height="32" rx="9" fill="#f08fb9" />
        {/* body */}
        <ellipse cx="100" cy="98" rx="80" ry="58" fill="#f9c3db" />
        <ellipse cx="88" cy="80" rx="46" ry="24" fill="#fde3ef" opacity="0.8" />
        {/* ear */}
        <path d="M128 46c6-22 26-26 30-18 3 7-6 22-16 28z" fill="#f08fb9" />
        {/* coin slot */}
        <rect x="78" y="40" width="44" height="9" rx="4.5" fill="#8c1d52" />
        {/* snout */}
        <ellipse cx="174" cy="102" rx="20" ry="17" fill="#f08fb9" />
        <circle cx="168" cy="102" r="3.6" fill="#8c1d52" />
        <circle cx="181" cy="102" r="3.6" fill="#8c1d52" />
        {/* eye and cheek */}
        <circle cx="146" cy="80" r="6" fill="#3b0f28" />
        <circle cx="148" cy="78" r="2" fill="#fff" />
        <ellipse cx="150" cy="100" rx="9" ry="5" fill="#f08fb9" opacity="0.6" />
      </svg>
    </div>
  )
}
