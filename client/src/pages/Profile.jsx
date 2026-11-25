import { useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import PatientShell from '../components/PatientShell.jsx'
import { useAuth } from '../auth.jsx'
import { SUPPORT_EMAIL, supportMailto } from '../lib/support.js'
import { useT } from '../i18n/index.jsx'
import { liveState, notifyState, setLive, setNotify } from '../lib/notify.js'
import Avatar from '../components/Avatar.jsx'

const ICON = {
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  family: 'M12 4.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zM5.5 7a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM18.5 7a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM8 20v-3.5a4 4 0 0 1 8 0V20M2.5 20v-2.5a3 3 0 0 1 4.6-2.5M21.5 20v-2.5a3 3 0 0 0-4.6-2.5',
  kolo: 'M5 6h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2zM3 10h18M16 15h2',
  pin: 'M6 11V8a6 6 0 0 1 12 0v3M5 11h14v10H5zM12 15v2',
  help: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01',
  bell: 'M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10 21a2 2 0 0 0 4 0',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
}
const Svg = ({ d }) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
)
const Chevron = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="text-muted"><path d="M9 18l6-6-6-6" /></svg>
)

function Row({ to, href, icon, label, sub, onClick, danger = false }) {
  const cls = `flex min-h-14 w-full cursor-pointer items-center gap-3.5 border-0 bg-transparent px-1 text-left font-[inherit] text-[15px] font-semibold no-underline ${danger ? 'text-[#c8102e]' : 'text-ink'} ${danger ? 'hover:opacity-80' : 'hover:text-plum'}`
  const body = (<><span className={danger ? 'text-[#c8102e]' : 'text-plum'}><Svg d={ICON[icon]} /></span><span className="flex min-w-0 flex-1 flex-col">{label}{sub && <span className="truncate text-[13px] font-normal text-muted">{sub}</span>}</span>{!onClick && <Chevron />}</>)
  if (onClick) return <button type="button" onClick={onClick} className={cls}>{body}</button>
  if (href) return <a href={href} className={cls}>{body}</a>
  return <Link to={to} className={cls}>{body}</Link>
}

const Switch = ({ on }) => (
  <span aria-hidden="true" className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${on ? 'bg-plum' : 'bg-[#d9d0d6]'}`}>
    <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? 'left-6' : 'left-1'}`} />
  </span>
)

// Notifications dropdown: the alert sound, phone notifications, and live queue updates.
function NotifySection({ t }) {
  const [state, setState] = useState(notifyState)
  const [live, setLiveState] = useState(liveState)
  const on = state === 'on'
  const sub = state === 'blocked' ? t('profile.notifyBlocked') : state === 'unsupported' ? t('profile.notifyUnsupported') : null
  return (
    <details className="group">
      <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3.5 px-1 text-[15px] font-semibold text-ink hover:text-plum [&::-webkit-details-marker]:hidden">
        <span className="text-plum"><Svg d={ICON.bell} /></span>
        <span className="flex-1">{t('profile.notify')}</span>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="text-muted transition-transform group-open:rotate-90"><path d="M9 18l6-6-6-6" /></svg>
      </summary>
      <div className="flex flex-col gap-4 pb-4 pl-[38px] pr-1">
        <button type="button" role="switch" aria-checked={on} disabled={state === 'unsupported'} onClick={async () => setState(await setNotify(!on))}
          className="flex cursor-pointer items-center gap-3 border-0 bg-transparent p-0 text-left font-[inherit] text-ink disabled:cursor-not-allowed">
          <span className="flex min-w-0 flex-1 flex-col text-[15px] font-semibold">{t('profile.phoneNotify')}<span className="text-[13px] font-normal text-muted">{sub ?? t('profile.notifySub')}</span></span>
          <Switch on={on} />
        </button>
        <button type="button" role="switch" aria-checked={live && on} disabled={!on} onClick={() => { setLive(!live); setLiveState(!live) }}
          className="flex cursor-pointer items-center gap-3 border-0 bg-transparent p-0 text-left font-[inherit] text-ink disabled:cursor-not-allowed disabled:opacity-50">
          <span className="flex min-w-0 flex-1 flex-col text-[15px] font-semibold">{t('profile.live')}<span className="text-[13px] font-normal text-muted">{t('profile.liveSub')}</span></span>
          <Switch on={live && on} />
        </button>
      </div>
    </details>
  )
}

// Profile: you at the top (tap "View profile" for your details), then a short menu.
export default function Profile() {
  const { t } = useT()
  const { user, checking, logout } = useAuth()
  if (checking) return null
  if (!user) return <Navigate to="/login" replace />
  return (
    <PatientShell>
      <div className="flex w-full max-w-xl flex-col gap-6">
        <Link to="/profile/edit" className="flex items-center gap-4 rounded-[24px] p-1 text-ink no-underline">
          <Avatar seed={user.id} size={88} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[28px] font-semibold leading-tight">{user.name}</span>
            <span className="text-[15px] font-semibold text-plum">{t('profile.view')} ›</span>
          </span>
        </Link>

        <section className="rounded-[24px] bg-white px-5 py-2 ring-1 ring-line">
          <div className="divide-y divide-line">
            <Row to="/settings" icon="settings" label={t('profile.settings')} />
            <Row to="/family" icon="family" label={t('profile.family')} />
            <Row to="/kolo" icon="kolo" label={t('profile.kolo')} />
            <Row to="/profile/pin" icon="pin" label={t('profile.changePin')} />
          </div>
        </section>

        <section className="rounded-[24px] bg-white px-5 py-2 ring-1 ring-line">
          <div className="divide-y divide-line">
            <NotifySection t={t} />
            <Row href={supportMailto(t('profile.helpSubject'))} icon="help" label={t('profile.help')} sub={SUPPORT_EMAIL} />
            <Row icon="logout" label={t('profile.logout')} onClick={logout} danger />
          </div>
        </section>
      </div>
    </PatientShell>
  )
}
