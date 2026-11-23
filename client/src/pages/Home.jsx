import { Navigate } from 'react-router-dom'
import Logo from '../components/Logo.jsx'
import LangSwitch from '../components/LangSwitch.jsx'
import { useAuth } from '../auth.jsx'
import { useT } from '../i18n/index.jsx'

// Placeholder until the dashboard design is decided.
export default function Home() {
  const { t } = useT()
  const { user, checking, logout } = useAuth()
  if (checking) return null
  if (!user) return <Navigate to="/login" replace />
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <Logo className="text-plum" width={72} />
      <h1 className="m-0 text-3xl font-extrabold">{t('home.hello')}, {user.name.split(' ')[0]}</h1>
      <p className="m-0 text-muted">{t('home.soon')}</p>
      <LangSwitch />
      <button type="button" onClick={logout} className="min-h-11 cursor-pointer rounded-full border-[1.5px] border-plum bg-transparent px-6 font-bold text-plum">{t('home.logout')}</button>
    </main>
  )
}
