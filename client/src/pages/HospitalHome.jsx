import { Navigate } from 'react-router-dom'
import Logo from '../components/Logo.jsx'
import LangSwitch from '../components/LangSwitch.jsx'
import { useAuth } from '../auth.jsx'
import { useT } from '../i18n/index.jsx'

// Placeholder until the front-desk dashboard design is decided. Shows whether the hospital
// is still waiting for approval.
export default function HospitalHome() {
  const { t } = useT()
  const { user, clinic, checking, logout } = useAuth()
  if (checking) return null
  if (!user || (user.role !== 'manager' && user.role !== 'staff')) return <Navigate to="/hospital/login" replace />
  const live = clinic?.status === 'approved'
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <Logo className="text-plum" width={72} />
      <h1 className="m-0 text-3xl font-extrabold">{clinic?.name ?? user.name}</h1>
      <span className={`rounded-full px-4 py-1.5 text-sm font-bold ${live ? 'bg-plum-soft text-[#2a1458]' : 'bg-blush text-rose'}`}>
        {live ? t('hospital.approvedTitle') : t('hospital.pendingTitle')}
      </span>
      <p className="m-0 max-w-md text-muted">{live ? t('hospital.approvedBody') : t('hospital.pendingBody')}</p>
      <p className="m-0 text-sm text-muted">{t('hospital.homeSoon')}</p>
      <LangSwitch />
      <button type="button" onClick={logout} className="min-h-11 cursor-pointer rounded-full border-[1.5px] border-plum bg-transparent px-6 font-bold text-plum">{t('home.logout')}</button>
    </main>
  )
}
