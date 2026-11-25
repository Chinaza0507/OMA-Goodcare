import { useState } from 'react'
import { NavLink, Link } from 'react-router-dom'
import Logo from './Logo.jsx'
import { useT } from '../i18n/index.jsx'
import { useAuth } from '../auth.jsx'

// Icons from the design's bottom bar.
const ICONS = {
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  book: 'M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM16 3v4M8 3v4M3 10h18',
  kolo: 'M5 6h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2zM3 10h18M16 15h2',
  family: 'M12 4.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zM5.5 7a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM18.5 7a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM8 20v-3.5a4 4 0 0 1 8 0V20M2.5 20v-2.5a3 3 0 0 1 4.6-2.5M21.5 20v-2.5a3 3 0 0 0-4.6-2.5',
  account: 'M12 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM4 21a8 8 0 0 1 16 0',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
}
const ALL = [['home', '/home'], ['book', '/book'], ['kolo', '/kolo'], ['family', '/family'], ['account', '/profile']]
const PHONE = ['home', 'book', 'kolo', 'account'] // four tabs on phones, as in the design

export const Icon = ({ name, size = 22, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}><path d={ICONS[name]} /></svg>
)

const Brand = ({ small = false }) => (
  <Link to="/home" aria-label="ỌMA home" className="flex items-end gap-2 text-plum no-underline">
    <Logo width={34} />
    {!small && <span className="font-['Marcellus',Georgia,serif] text-[23px] leading-none">ỌMA</span>}
  </Link>
)


export default function PatientShell({ children }) {
  const { t } = useT()
  const { logout } = useAuth()
  // Laptop side menu: slim (icons only) until you hover over it or tab into it, then it opens
  // over the page. It never pushes the page sideways.
  const [open, setOpen] = useState(false)
  const small = !open
  return (
    <div className="min-h-screen bg-cream lg:flex">
      {/* Laptop: slim side menu that opens on hover */}
      <div aria-hidden="true" className="hidden lg:block lg:w-[84px] lg:shrink-0" />
      <aside onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)} onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false) }}
        className={`hidden overflow-hidden bg-cream transition-[width,box-shadow] duration-200 ease-out motion-reduce:transition-none lg:fixed lg:left-0 lg:top-0 lg:z-30 lg:flex lg:h-screen lg:flex-col lg:border-r lg:border-line lg:py-7 ${small ? 'lg:w-[84px] lg:px-3' : 'lg:w-[232px] lg:px-5 lg:shadow-[12px_0_40px_rgba(34,18,28,0.12)]'}`}>
        <div className={`flex h-10 items-center ${small ? 'justify-center' : ''}`}>
          <Brand small={small} />
        </div>
        <nav aria-label={t('menu.main')} className="mt-10 flex flex-col gap-1">
          {ALL.map(([key, to]) => (
            <NavLink key={key} to={to} title={small ? t(`menu.${key}`) : undefined} aria-label={small ? t(`menu.${key}`) : undefined}
              className={({ isActive }) => `flex min-h-12 items-center gap-3 whitespace-nowrap rounded-2xl text-[15px] font-semibold no-underline transition-colors ${small ? 'justify-center px-0' : 'px-4'} ${isActive ? 'bg-plum text-white' : 'text-muted hover:bg-blush hover:text-rose'}`}>
              <Icon name={key} size={20} className="shrink-0" />{!small && t(`menu.${key}`)}
            </NavLink>
          ))}
        </nav>
        <NavLink to="/settings" title={small ? t('menu.settings') : undefined} aria-label={small ? t('menu.settings') : undefined}
          className={({ isActive }) => `mt-auto mb-2 flex min-h-11 items-center gap-3 whitespace-nowrap rounded-2xl text-sm font-semibold no-underline transition-colors ${small ? 'justify-center px-0' : 'px-4'} ${isActive ? 'bg-plum text-white' : 'text-muted hover:bg-blush hover:text-rose'}`}>
          <Icon name="settings" size={18} className="shrink-0" />{!small && t('menu.settings')}
        </NavLink>
        <button type="button" onClick={logout} title={small ? t('home.logout') : undefined} aria-label={small ? t('home.logout') : undefined}
          className={`flex min-h-11 cursor-pointer items-center gap-3 whitespace-nowrap rounded-2xl border border-line bg-white text-sm font-semibold text-muted hover:bg-blush hover:text-rose ${small ? 'justify-center px-0' : 'px-4'}`}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" /></svg>
          {!small && t('home.logout')}
        </button>
      </aside>

      {/* Phone: top bar */}
      <header className="flex items-center justify-between px-5 pb-2 pt-4 lg:hidden"><Brand /></header>

      <main className="mx-auto w-full max-w-[1120px] flex-1 px-5 pb-24 pt-2 lg:px-10 lg:pb-10 lg:pt-10">{children}</main>

      {/* Phone: bottom tabs */}
      <nav aria-label={t('menu.main')} className="fixed inset-x-0 bottom-0 z-20 grid h-[72px] grid-cols-4 border-t border-line bg-cream/95 backdrop-blur lg:hidden">
        {PHONE.map((key) => (
          <NavLink key={key} to={key === 'account' ? '/profile' : `/${key}`}
            className={({ isActive }) => `flex flex-col items-center justify-center gap-1 text-xs no-underline ${isActive ? 'font-bold text-rose' : 'font-semibold text-muted'}`}>
            <Icon name={key} size={24} />{t(`menu.${key}`)}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
