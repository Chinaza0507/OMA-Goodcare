const base = 'min-h-[52px] w-full rounded-[14px] border-[1.5px] bg-white px-3.5 text-base text-ink box-border'

export function Field({ id, label, children }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-semibold">{label}</label>
      {children}
    </div>
  )
}

export const borderFor = (ok, bad) => (bad ? 'border-danger' : ok ? 'border-plum' : 'border-line')

export function TextInput({ ok, bad, ...props }) {
  return <input {...props} className={`${base} ${borderFor(ok, bad)}`} />
}

export function PhoneInput({ id, value, onChange, ok, bad, describedBy }) {
  return (
    <div className="flex gap-2">
      <span className="flex min-h-[52px] items-center rounded-[14px] border-[1.5px] border-line bg-white px-3 text-[15px] font-semibold">+234</span>
      <input
        id={id}
        type="tel"
        inputMode="numeric"
        autoComplete="tel-national"
        value={value}
        onChange={onChange}
        placeholder="803 000 0000"
        aria-describedby={describedBy}
        className={`${base} min-w-0 flex-1 ${borderFor(ok, bad)}`}
      />
    </div>
  )
}

export function PinInput({ id, value, onChange, ok, autoComplete }) {
  return (
    <input
      id={id}
      type="password"
      inputMode="numeric"
      autoComplete={autoComplete}
      maxLength={4}
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 4))}
      placeholder="••••"
      className={`${base} text-center font-display text-2xl font-extrabold tracking-[0.6em] ${borderFor(ok, false)}`}
    />
  )
}

export const ErrorLine = ({ children }) =>
  children ? (
    <p role="alert" className="m-0 flex items-center gap-2 text-[13px] font-semibold text-rose">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v6M12 16.5h.01" /></svg>
      {children}
    </p>
  ) : null

// tone 'rose' is the pink brand colour (used on the hospital pages).
const TONES = { plum: 'bg-plum text-white hover:bg-plum-dark', rose: 'bg-rose text-white hover:bg-[#6f1641]' }
export const PrimaryButton = ({ ready = true, busy, tone = 'plum', children, ...props }) => (
  <button
    type="submit"
    aria-disabled={!ready || busy}
    {...props}
    className={`min-h-14 w-full cursor-pointer rounded-2xl border-0 text-[17px] font-bold ${ready && !busy ? TONES[tone] : 'bg-[#efe7ec] text-[#6b5a65]'}`}
  >
    {children}
  </button>
)

export const toE164Local = (raw) => raw.replace(/\D/g, '').replace(/^0/, '')
