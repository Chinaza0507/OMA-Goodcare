export default function Logo({ className = '', width = 56 }) {
  return (
    <svg className={className} width={width} height={(width * 210) / 320} viewBox="610 195 320 210" aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeLinecap="round">
        <path d="M684 222 C700 258 738 270 768 270 C798 270 836 258 852 222" strokeWidth="20" />
        <path d="M684 382 C700 346 738 332 768 332 C798 332 836 346 852 382" strokeWidth="20" />
        <circle cx="768" cy="301" r="21" strokeWidth="15" />
        <path d="M628 274 H688 M628 298 H688 M628 322 H688 M848 274 H908 M848 298 H908 M848 322 H908" strokeWidth="14" />
      </g>
      <g fill="currentColor">
        <circle cx="768" cy="213" r="15" />
        <circle cx="768" cy="301" r="8" />
        <circle cx="768" cy="388" r="15" />
      </g>
    </svg>
  )
}
