import { useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import AuthShell from '../components/AuthShell.jsx'
import { SignUpScene } from '../components/scenes.jsx'
import { ErrorLine, Field, PhoneInput, PinInput, PrimaryButton, TextInput, toE164Local } from '../components/fields.jsx'
import { useAuth } from '../auth.jsx'
import { useT } from '../i18n/index.jsx'

export default function SignUp() {
  const { t, lang } = useT()
  const { user, register } = useAuth()
  const navigate = useNavigate()
  const [f, setF] = useState({ name: '', phone: '', email: '', pin: '', agree: false })
  const [tried, setTried] = useState(false)
  const [busy, setBusy] = useState(false)
  const [serverError, setServerError] = useState('')
  const set = (k) => (v) => setF((s) => ({ ...s, [k]: v }))

  if (user) return <Navigate to="/home" replace />

  const digits = toE164Local(f.phone)
  const nameOk = f.name.trim().length >= 2
  const phoneOk = digits.length === 10
  const emailOk = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email.trim())
  const pinOk = /^\d{4}$/.test(f.pin)
  const ready = nameOk && phoneOk && emailOk && pinOk && f.agree

  const problem = !nameOk ? t('signup.needName') : !phoneOk ? t('signup.needPhone') : !emailOk ? t('signup.needEmail') : !pinOk ? t('signup.needPin') : !f.agree ? t('signup.needAgree') : ''

  async function submit(e) {
    e.preventDefault()
    setServerError('')
    if (!ready) return setTried(true)
    setBusy(true)
    try {
      await register({ name: f.name.trim(), phone: `+234${digits}`, email: f.email.trim(), pin: f.pin, language: lang, consent: true })
      navigate('/home', { replace: true })
    } catch (err) {
      setServerError(t(`errors.${err.code}`) !== `errors.${err.code}` ? t(`errors.${err.code}`) : t('errors.server_error'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthShell scene={<SignUpScene />}>
      <form noValidate onSubmit={submit} className="flex flex-col gap-3.5">
        <div>
          <h1 className="m-0 text-[26px] font-extrabold leading-tight">{t('signup.title')}</h1>
          <p className="mt-1 text-sm text-muted">{t('signup.sub')}</p>
        </div>
        <Field id="s-name" label={t('signup.name')}>
          <TextInput id="s-name" type="text" autoComplete="name" value={f.name} onChange={(e) => set('name')(e.target.value)} placeholder={t('signup.namePh')} ok={nameOk} />
        </Field>
        <Field id="s-phone" label={t('signup.phone')}>
          <PhoneInput id="s-phone" value={f.phone} onChange={(e) => set('phone')(e.target.value)} ok={phoneOk} bad={digits.length > 0 && !phoneOk} describedBy="s-phone-help" />
          {digits.length > 0 && !phoneOk && <span id="s-phone-help" className="text-[13px] text-danger">{t('signup.phoneBad')}</span>}
        </Field>
        <Field id="s-email" label={t('signup.email')}>
          <TextInput id="s-email" type="email" autoComplete="email" value={f.email} onChange={(e) => set('email')(e.target.value)} placeholder="you@example.com" ok={emailOk} bad={f.email.trim() !== '' && !emailOk} />
        </Field>
        <Field id="s-pin" label={t('signup.pin')}>
          <PinInput id="s-pin" value={f.pin} onChange={set('pin')} ok={pinOk} autoComplete="new-password" />
          <span className="text-[13px] leading-snug text-muted">{t('signup.pinHelp')}</span>
        </Field>
        <button type="button" role="checkbox" aria-checked={f.agree} onClick={() => set('agree')(!f.agree)} className="flex cursor-pointer items-start gap-2.5 border-0 bg-transparent p-0 text-left font-[inherit] text-ink">
          <span className={`flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-md border-2 border-plum text-white ${f.agree ? 'bg-plum' : 'bg-white'}`}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={f.agree ? '' : 'invisible'}><path d="M5 12l5 5L20 7" /></svg>
          </span>
          <span className="text-[13px] leading-snug text-muted">
            {t('signup.agreePre')}<a href="#" className="font-semibold text-plum">{t('landing.terms')}</a>{t('signup.agreeAnd')}<a href="#" className="font-semibold text-plum">{t('landing.privacy')}</a>.
          </span>
        </button>
        <ErrorLine>{serverError || (tried && !ready ? problem : '')}</ErrorLine>
        <PrimaryButton ready={ready} busy={busy}>{busy ? t('common.loading') : t('signup.submit')}</PrimaryButton>
        <p className="m-0 text-center text-sm text-muted">{t('signup.haveAccount')} <Link to="/login" className="font-bold text-plum">{t('nav.login')}</Link></p>
      </form>
    </AuthShell>
  )
}
