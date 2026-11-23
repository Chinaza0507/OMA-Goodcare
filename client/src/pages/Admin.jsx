import { useCallback, useEffect, useState } from 'react'
import AuthShell from '../components/AuthShell.jsx'
import Logo from '../components/Logo.jsx'
import LangSwitch from '../components/LangSwitch.jsx'
import { ErrorLine, Field, PrimaryButton, TextInput } from '../components/fields.jsx'
import { api } from '../api.js'
import { useAuth } from '../auth.jsx'
import { useT } from '../i18n/index.jsx'

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

function SignIn() {
  const { t } = useT()
  const { workLogin, logout } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const ready = EMAIL_RE.test(email.trim()) && password.length > 0

  async function submit(e) {
    e.preventDefault()
    if (!ready) return
    setErr('')
    setBusy(true)
    try {
      const d = await workLogin(email.trim().toLowerCase(), password)
      if (d.user.role !== 'admin') {
        logout()
        setErr(t('errors.forbidden'))
      }
    } catch (e2) {
      setErr(e2.code === 'bad_credentials' ? t('errors.bad_work_credentials') : t(`errors.${e2.code}`) !== `errors.${e2.code}` ? t(`errors.${e2.code}`) : t('errors.server_error'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthShell>
      <form noValidate onSubmit={submit} className="flex flex-col gap-4">
        <div>
          <h1 className="m-0 text-[28px] font-extrabold leading-tight">{t('admin.signInTitle')}</h1>
          <p className="mt-1.5 text-[15px] text-muted">{t('admin.signInSub')}</p>
        </div>
        <Field id="a-email" label={t('admin.email')}>
          <TextInput id="a-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} ok={EMAIL_RE.test(email.trim())} />
        </Field>
        <Field id="a-pass" label={t('hospital.password')}>
          <TextInput id="a-pass" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} ok={password.length > 0} />
        </Field>
        <ErrorLine>{err}</ErrorLine>
        <PrimaryButton ready={ready} busy={busy}>{busy ? t('common.loading') : t('hospital.submitLogin')}</PrimaryButton>
      </form>
    </AuthShell>
  )
}

function ClinicCard({ c, t, onApprove, busy }) {
  const date = new Date(c.createdAt).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })
  return (
    <article className="flex flex-col gap-3 rounded-[22px] border border-line bg-white p-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="m-0 text-lg font-extrabold">{c.name}</h3>
          <span className="rounded-full bg-blush px-2.5 py-0.5 text-xs font-bold text-rose">{t(`hospital.types.${c.type}`)}</span>
        </div>
        <p className="m-0 text-[15px] text-ink">{[c.address, c.area, c.state].filter(Boolean).join(', ')}</p>
        {c.landmark && <p className="m-0 text-sm text-muted">{t('admin.landmark')}: {c.landmark}</p>}
        <p className="m-0 text-sm text-muted">{c.email ? `${c.email} · ` : ''}{t('admin.registered')} {date}</p>
      </div>
      {c.status === 'pending' && (
        <button type="button" onClick={() => onApprove(c.id)} disabled={busy}
          className="min-h-12 shrink-0 cursor-pointer rounded-2xl border-0 bg-plum px-6 text-base font-bold text-white hover:bg-plum-dark disabled:opacity-60">
          {busy ? t('admin.approving') : t('admin.approve')}
        </button>
      )}
    </article>
  )
}

function Dashboard() {
  const { t } = useT()
  const { user, logout } = useAuth()
  const [status, setStatus] = useState('pending')
  const [clinics, setClinics] = useState(null)
  const [busyId, setBusyId] = useState(null)
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    setErr('')
    try {
      setClinics((await api(`/admin/clinics?status=${status}`)).clinics)
    } catch (e) {
      setErr(t(`errors.${e.code}`) !== `errors.${e.code}` ? t(`errors.${e.code}`) : t('errors.server_error'))
    }
  }, [status, t])

  useEffect(() => { load() }, [load])

  async function approve(id) {
    setBusyId(id)
    try {
      await api(`/admin/clinics/${id}/approve`, { method: 'POST' })
      setClinics((list) => list.filter((c) => c.id !== id))
    } catch (e) {
      setErr(t(`errors.${e.code}`) !== `errors.${e.code}` ? t(`errors.${e.code}`) : t('errors.server_error'))
    } finally {
      setBusyId(null)
    }
  }

  const tabBtn = (id, label) => (
    <button type="button" role="tab" aria-selected={status === id} onClick={() => { setClinics(null); setStatus(id) }}
      className={`min-h-11 cursor-pointer rounded-full border-0 px-5 text-[15px] font-bold ${status === id ? 'bg-plum text-white' : 'bg-transparent text-muted hover:bg-blush'}`}>
      {label}
    </button>
  )

  return (
    <div className="min-h-screen bg-cream">
      <header className="border-b border-[#e8ebdd]">
        <div className="mx-auto flex max-w-[960px] items-center justify-between gap-3 px-5 py-3">
          <span className="flex items-center gap-2.5 text-plum"><Logo width={40} /><span className="font-display text-lg font-extrabold text-ink">{t('admin.title')}</span></span>
          <div className="flex items-center gap-2.5">
            <LangSwitch />
            <button type="button" onClick={logout} className="min-h-11 cursor-pointer rounded-full border-[1.5px] border-plum bg-transparent px-5 text-[15px] font-bold text-plum hover:bg-blush">{t('home.logout')}</button>
          </div>
        </div>
      </header>
      <main className="mx-auto flex max-w-[960px] flex-col gap-5 px-5 py-8">
        <p className="m-0 text-sm text-muted">{t('admin.signedInAs')} <b className="text-ink">{user.name}</b></p>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div role="tablist" className="flex gap-1 rounded-full border border-line bg-white p-1">
            {tabBtn('pending', t('admin.pending'))}{tabBtn('approved', t('admin.approved'))}
          </div>
          <button type="button" onClick={load} className="min-h-11 cursor-pointer rounded-full border border-line bg-white px-4 text-sm font-semibold text-plum hover:bg-blush">{t('admin.refresh')}</button>
        </div>
        <ErrorLine>{err}</ErrorLine>
        {clinics === null ? (
          <p className="text-muted">{t('common.loading')}</p>
        ) : clinics.length === 0 ? (
          <p className="rounded-[22px] border border-dashed border-line bg-white p-8 text-center text-muted">{t('admin.none')}</p>
        ) : (
          clinics.map((c) => <ClinicCard key={c.id} c={c} t={t} busy={busyId === c.id} onApprove={approve} />)
        )}
      </main>
    </div>
  )
}

export default function Admin() {
  const { user, checking } = useAuth()
  if (checking) return null
  return user?.role === 'admin' ? <Dashboard /> : <SignIn />
}
