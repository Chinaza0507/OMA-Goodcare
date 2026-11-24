import { Link } from 'react-router-dom'
import Logo from './Logo.jsx'
import LangSwitch from './LangSwitch.jsx'
import { useT } from '../i18n/index.jsx'

// Phone: full-screen page. Laptop (md and up): centred white card on the cream background
// with a "Back to home" link in the corner, matching the laptop designs.
export default function AuthShell({ children, scene = null }) {
  const { t } = useT()
  return (
    <div className="relative isolate flex min-h-screen flex-col overflow-hidden bg-cream md:items-center md:justify-center md:px-4 md:py-20">
      {scene}
      <div className="flex items-center justify-between px-4 pt-3 md:absolute md:left-8 md:right-8 md:top-7 md:p-0">
        <Link to="/" className="flex min-h-11 items-center gap-1.5 text-[15px] font-semibold text-plum no-underline hover:text-rose">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M19 12H5M11 18l-6-6 6-6" />
          </svg>
          <span className="hidden md:inline">{t('common.backHome')}</span>
          <span className="md:hidden">{t('common.back')}</span>
        </Link>
        <LangSwitch />
      </div>
      <main className="flex w-full flex-1 flex-col gap-3.5 px-6 pb-8 pt-4 md:max-w-[460px] md:flex-none md:rounded-3xl md:border md:border-[#efe4ea] md:bg-white md:px-6 md:pb-8 md:pt-8 md:shadow-[0_20px_50px_rgba(90,45,176,0.10)]">
        <Link to="/" aria-label="ỌMA home" className="flex self-center text-plum"><Logo width={56} /></Link>
        {children}
      </main>
    </div>
  )
}
