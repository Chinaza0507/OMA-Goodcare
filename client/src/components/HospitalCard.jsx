import { Link } from 'react-router-dom'

const naira = (n) => `₦${Number(n || 0).toLocaleString('en-NG')}`

// Cheapest department fee, or "Free" / "Fee at hospital".
function priceLabel(c, t) {
  const fees = c.departments.map((d) => d.consultationFee).filter((f) => f != null)
  if (!fees.length) return t('find.feeUnknown')
  const min = Math.min(...fees)
  return min === 0 ? t('find.free') : t('find.from').replace('{fee}', naira(min))
}

export default function HospitalCard({ c, t, compact = false }) {
  return (
    <article className="hosp-in flex flex-col gap-3 rounded-[22px] bg-white p-5 ring-1 ring-line transition-shadow hover:shadow-[0_14px_34px_rgba(90,45,176,0.10)]">
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-plum-tint text-plum">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 21V8l8-5 8 5v13M9 21v-6h6v6M12 7v4M10 9h4" /></svg>
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="m-0 line-clamp-2 text-[17px] font-bold leading-snug">{c.name}</h3>
          <p className="m-0 mt-0.5 truncate text-sm text-muted">{[c.area, c.state].filter(Boolean).join(', ')}</p>
        </div>
        {c.distanceKm != null && (
          <span className="shrink-0 rounded-full bg-blush px-2.5 py-1 text-xs font-bold text-rose">{t('find.away').replace('{km}', c.distanceKm)}</span>
        )}
      </div>

      {!compact && (c.address || c.landmark) && (
        <p className="m-0 text-sm leading-snug text-muted">
          {c.address}{c.landmark ? <> · <span className="text-ink">{c.landmark}</span></> : null}
        </p>
      )}

      <div className="flex flex-wrap gap-1.5">
        <span className="rounded-full bg-plum-tint px-2.5 py-1 text-xs font-semibold text-plum">{t(`find.types.${c.type}`)}</span>
        {c.departments.slice(0, compact ? 3 : 6).map((d) => (
          <span key={d.id} className="rounded-full border border-line px-2.5 py-1 text-xs font-semibold text-ink">{d.name}</span>
        ))}
      </div>

      <div className="mt-auto flex items-center justify-between gap-3 pt-1">
        <div className="text-sm">
          <b className="font-display text-[15px]">{priceLabel(c, t)}</b>
          <span className="block text-xs text-muted">{c.depositNaira > 0 ? t('find.deposit') : t('find.noDeposit')}</span>
        </div>
        <Link to={`/book/${c.id}`} className="flex min-h-11 items-center rounded-xl bg-rose px-5 text-[15px] font-bold !text-white no-underline hover:bg-rose-dark">{t('find.book')}</Link>
      </div>
    </article>
  )
}
