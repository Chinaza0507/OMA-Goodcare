import { useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import AuthShell from '../components/AuthShell.jsx'
import { LoginScene } from '../components/scenes.jsx'
import { ErrorLine, Field, PhoneInput, PinInput, PrimaryButton, toE164Local } from '../components/fields.jsx'
import { useAuth } from '../auth.jsx'
import { useT } from '../i18n/index.jsx'

export default function Login() {
  const { t } = useT()
  const { user, login } = useAuth()
  const navigate = useNavigate()
  const [phone, setPhone] = useState('')
  const [pin, setPin] = useState('')
  const [tried, setTried] = useState(false)
  const [busy, setBusy] = useState(false)
  const [serverError, setServerError] = useState('')

  if (user) return <Navigate to="/home" replace />

  const digits = toE164Local(phone)
  const phoneOk = digits.length === 10
  const pinOk = /^\d{4}$/.test(pin)
  const ready = phoneOk && pinOk

  async function submit(e) {
    e.preventDefault()
    setServerError('')
    if (!ready) return setTried(true)
    setBusy(true)
    try {
      await login(`+234${digits}`, pin)
      navigate('/home', { replace: true })
    } catch (err) {
      setServerError(t(`errors.${err.code}`) !== `errors.${err.code}` ? t(`errors.${err.code}`) : t('errors.server_error'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthShell scene={<LoginScene />}>
      <form noValidate onSubmit={submit} className="flex flex-col gap-4">
        <div>
          <h1 className="m-0 text-[28px] font-extrabold leading-tight">{t('login.title')}</h1>
          <p className="mt-1.5 text-[15px] leading-normal text-muted">{t('login.sub')}</p>
        </div>
        <Field id="l-phone" label={t('signup.phone')}>
          <PhoneInput id="l-phone" value={phone} onChange={(e) => setPhone(e.target.value)} ok={phoneOk} />
        </Field>
        <Field id="l-pin" label={t('login.pin')}>
          <PinInput id="l-pin" value={pin} onChange={setPin} ok={pinOk} autoComplete="current-password" />
        </Field>
        <ErrorLine>{serverError || (tried && !phoneOk ? t('login.needPhone') : tried && !pinOk ? t('login.needPin') : '')}</ErrorLine>
        <PrimaryButton ready={ready} busy={busy}>{busy ? t('common.loading') : t('login.submit')}</PrimaryButton>
        <p className="m-0 text-center text-sm text-muted">{t('login.newHere')} <Link to="/signup" className="font-bold text-plum">{t('login.create')}</Link></p>
      </form>
    </AuthShell>
  )
}
