import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import PatientShell from '../components/PatientShell.jsx'
import SubPage from '../components/SubPage.jsx'
import { api } from '../api.js'
import { useAuth } from '../auth.jsx'
import { useT } from '../i18n/index.jsx'

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const initials = (name) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('')
const box = 'flex flex-col gap-0.5 rounded-2xl border-[1.5px] border-line bg-white px-4 py-2.5 focus-within:border-plum'
const input = 'no-ring w-full border-0 bg-transparent p-0 text-base text-ink outline-none'

export default function EditProfile() {
  const { user, checking } = useAuth()
  if (checking) return null
  if (!user) return <Navigate to="/login" replace />
  // The form only mounts once the user is loaded, so the boxes start filled in.
  return <EditForm user={user} />
}

function EditForm({ user }) {
  const { t } = useT()
  const { refresh } = useAuth()
  const [name, setName] = useState(user?.name ?? '')
  const [email, setEmail] = useState(user?.email ?? '')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState(null)

  async function save(e) {
    e.preventDefault()
    if (name.trim().length < 2) return setNote({ ok: false, text: t('profile.needName') })
    if (email.trim() && !EMAIL_RE.test(email.trim())) return setNote({ ok: false, text: t('profile.needEmail') })
    setBusy(true)
    try {
      await api('/auth/me', { method: 'PATCH', body: { name: name.trim(), email: email.trim() } })
      await refresh()
      setNote({ ok: true, text: t('profile.saved') })
    } catch (err) {
      setNote({ ok: false, text: t(`errors.${err.code}`) !== `errors.${err.code}` ? t(`errors.${err.code}`) : t('errors.server_error') })
    } finally {
      setBusy(false)
    }
  }

  return (
    <PatientShell>
      <SubPage title={t('profile.editTitle')} backLabel={t('profile.back')}>
        <section className="flex flex-col items-center gap-1 text-center">
          <span className="flex h-20 w-20 items-center justify-center rounded-full bg-plum font-display text-2xl font-extrabold text-white ring-4 ring-plum-soft">{initials(name || user.name)}</span>
          <h2 className="m-0 mt-2 text-lg font-extrabold">{name.trim() || user.name}</h2>
          <p className="m-0 text-sm text-muted">{user.phone}</p>
        </section>
        <hr className="m-0 border-0 border-t border-line" />
        <form noValidate onSubmit={save} className="flex flex-col gap-3">
          <label className={box}>
            <span className="text-xs text-muted">{t('profile.fullName')}</span>
            <input className={input} value={name} onChange={(e) => { setName(e.target.value); setNote(null) }} autoComplete="name" />
          </label>
          <div className="flex flex-col gap-0.5 rounded-2xl border-[1.5px] border-line bg-[#f6f3f8] px-4 py-2.5">
            <span className="text-xs text-muted">{t('profile.phone')}</span>
            <span className="flex items-center justify-between gap-2 text-base text-muted">{user.phone}
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
            </span>
          </div>
          <p className="-mt-1 m-0 px-1 text-xs text-muted">{t('profile.phoneLocked')}</p>
          <label className={box}>
            <span className="text-xs text-muted">{t('profile.email')}</span>
            <input className={input} type="email" value={email} onChange={(e) => { setEmail(e.target.value); setNote(null) }} autoComplete="email" placeholder="you@example.com" />
          </label>
          {note && <p role={note.ok ? 'status' : 'alert'} className={`m-0 text-sm font-semibold ${note.ok ? 'text-[#1d6b3a]' : 'text-rose'}`}>{note.text}</p>}
          <button type="submit" disabled={busy} className="mt-3 min-h-[54px] cursor-pointer rounded-2xl border-0 bg-rose text-base font-bold text-white hover:bg-rose-dark disabled:cursor-wait disabled:opacity-70">{busy ? t('common.loading') : t('profile.save')}</button>
        </form>
      </SubPage>
    </PatientShell>
  )
}
