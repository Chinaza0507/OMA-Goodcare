import { NavLink, Link } from 'react-router-dom'
import Logo from './Logo.jsx'
import { useAuth } from '../auth.jsx'

const NAV = [
  ['/hospital/home', 'Queue', 'M4 6h16M4 12h16M4 18h10'],
  ['/hospital/stats', "Today's numbers", 'M4 20V10M10 20V4M16 20v-7M22 20H2'],
  ['/hospital/settings', 'Settings', 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM4 12h2M18 12h2M12 4v2M12 18v2M6.3 6.3l1.4 1.4M16.3 16.3l1.4 1.4M6.3 17.7l1.4-1.4M16.3 7.7l1.4-1.4', 'manager'],
]

// Hospital side: deep purple top bar, cream content, pink actions.
export default function HospitalShell({ children, actions }) {
  const { user, clinic, logout } = useAuth()
  return (
    <div className="min-h-screen bg-cream">
      <header className="sticky top-0 z-30 bg-[#2f1563] text-white shadow-[0_6px_24px_rgba(20,6,40,0.25)]">
        <div className="mx-auto flex max-w-[1280px] flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 lg:px-8">
          <Link to="/hospital/home" className="flex items-center gap-2.5 text-white no-underline">
            <Logo width={34} />
            <span className="flex flex-col leading-tight">
              <b className="font-display text-[15px]">{clinic?.name ?? user?.name}</b>
              <span className="text-xs text-[#cdb9e8]">{user?.role === 'manager' ? 'Manager' : 'Front desk'} · ỌMA</span>
            </span>
          </Link>
          <nav aria-label="Hospital" className="order-3 -mx-1 flex w-full gap-1 overflow-x-auto px-1 sm:order-none sm:w-auto">
            {NAV.filter(([, , , role]) => !role || user?.role === role).map(([to, label, icon]) => (
              <NavLink key={to} to={to}
                className={({ isActive }) => `flex min-h-10 shrink-0 items-center gap-2 rounded-xl px-3.5 text-sm font-semibold no-underline ${isActive ? 'bg-white text-[#2f1563]' : 'text-white/85 hover:bg-white/10'}`}>
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={icon} /></svg>
                {label}
              </NavLink>
            ))}
            {clinic?.id && (
              <a href={`/screen/${clinic.id}`} target="_blank" rel="noreferrer"
                className="flex min-h-10 shrink-0 items-center gap-2 rounded-xl px-3.5 text-sm font-semibold text-white/85 no-underline hover:bg-white/10">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="2" y="4" width="20" height="13" rx="2" /><path d="M8 21h8M12 17v4" /></svg>
                Now serving screen ↗
              </a>
            )}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            {actions}
            <button type="button" onClick={logout} className="min-h-10 cursor-pointer rounded-xl border border-white/25 bg-transparent px-3.5 text-sm font-semibold text-white hover:bg-white/10">Log out</button>
          </div>
        </div>
      </header>
      {clinic && clinic.status !== 'approved' && (
        <div className="bg-[#fff4d6] px-4 py-2.5 text-center text-sm text-[#6b5512]">
          <b>Waiting for ỌMA approval.</b> Patients can’t find or book your hospital yet — you can set up departments and staff meanwhile.
        </div>
      )}
      <main className="mx-auto w-full max-w-[1280px] px-4 py-6 lg:px-8 lg:py-8">{children}</main>
    </div>
  )
}
