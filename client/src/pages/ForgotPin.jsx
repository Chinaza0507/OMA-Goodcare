import { useState } from 'react'
import { Link } from 'react-router-dom'
import AuthShell from '../components/AuthShell.jsx'
import { LoginScene } from '../components/scenes.jsx'
import { ErrorLine, Field, PhoneInput, PinInput, PrimaryButton, TextInput, toE164Local } from '../components/fields.jsx'
import { api } from '../api.js'
import { useT } from '../i18n/index.jsx'

const FOUR = /^\d{4}$/
const SIX = /^\d{6}$/

// Forgot PIN: phone -> 6-digit code -> new PIN. Until an SMS provider is connected, the code is
// shown on screen in practice mode (development only).
export default function ForgotPin() {
  const { t } = useT()
  const [step, setStep] = useState('phone') // phone | code | done
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [pin, setPin] = useState('')
  const [again, setAgain] = useState('')
  const [practice, setPractice] = useState(null)
  const [minutes, setMinutes] = useState(10)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const digits = toE164Local(phone)
  const msg = (e) => {
    if (e.code === 'bad_code' && e.extra?.triesLeft != null) return `${t('errors.bad_code')}`
    return t(`errors.${e.code}`) !== `errors.${e.code}` ? t(`errors.${e.code}`) : t('errors.server_error')
  }

  async function send(e) {
    e?.preventDefault()
    if (digits.length !== 10) return setErr(t('login.needPhone'))
    setBusy(true)
    setErr('')
    try {
      const d = await api('/auth/forgot-pin', { method: 'POST', body: { phone: `+234${digits}` } })
      setPractice(d.practiceCode ?? null)
      setMinutes(d.minutes ?? 10)
      setCode('')
      setStep('code')
    } catch (e2) {
      setErr(msg(e2))
    } finally {
      setBusy(false)
    }
  }

  async function reset(e) {
    e.preventDefault()
    if (!SIX.test(code)) return setErr(t('forgot.needCode'))
    if (!FOUR.test(pin)) return setErr(t('forgot.needPin'))
    if (pin !== again) return setErr(t('forgot.mismatch'))
    setBusy(true)
    setErr('')
    try {
      await api('/auth/reset-pin', { method: 'POST', body: { phone: `+234${digits}`, code, pin } })
      setStep('done')
    } catch (e2) {
      setErr(msg(e2))
    } finally {
      setBusy(false)
    }
  }

  const shown = `+234 ${digits.replace(/(\d{3})(\d{3})(\d{0,4})/, '$1 $2 $3')}`

  return (
    <AuthShell scene={<LoginScene />}>
      {step === 'phone' && (
        <form noValidate onSubmit={send} className="flex flex-col gap-4">
          <div>
            <h1 className="m-0 text-[28px] font-extrabold leading-tight">{t('forgot.title')}</h1>
            <p className="mt-1.5 text-[15px] leading-normal text-muted">{t('forgot.sub')}</p>
          </div>
          <Field id="f-phone" label={t('signup.phone')}>
            <PhoneInput id="f-phone" value={phone} onChange={(e) => { setPhone(e.target.value); setErr('') }} ok={digits.length === 10} />
          </Field>
          <ErrorLine>{err}</ErrorLine>
          <PrimaryButton ready={digits.length === 10} busy={busy}>{busy ? t('common.loading') : t('forgot.send')}</PrimaryButton>
          <p className="m-0 text-center text-sm text-muted"><Link to="/login" className="font-bold text-plum">{t('profile.back')}</Link></p>
        </form>
      )}

      {step === 'code' && (
        <form noValidate onSubmit={reset} className="flex flex-col gap-4">
          <div>
            <h1 className="m-0 text-[28px] font-extrabold leading-tight">{t('forgot.codeTitle')}</h1>
            <p className="mt-1.5 text-[15px] leading-normal text-muted">{t('forgot.codeSub').replace('{phone}', shown).replace('{minutes}', minutes)}</p>
          </div>
          {practice && (
            <p role="status" className="m-0 rounded-2xl border border-dashed border-[#d9c06a] bg-[#fff9e6] px-4 py-3 text-sm text-[#6b5512]">
              {t('forgot.practice')} <b className="font-display text-base tracking-[0.2em] text-ink">{practice}</b>
            </p>
          )}
          <Field id="f-code" label={t('forgot.code')}>
            <TextInput id="f-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code}
              onChange={(e) => { setCode(e.target.value.replace(/\D/g, '').slice(0, 6)); setErr('') }} ok={SIX.test(code)} placeholder="••••••" />
          </Field>
          <Field id="f-pin" label={t('forgot.newPin')}><PinInput id="f-pin" value={pin} onChange={(v) => { setPin(v); setErr('') }} ok={FOUR.test(pin)} autoComplete="new-password" /></Field>
          <Field id="f-again" label={t('forgot.confirmPin')}><PinInput id="f-again" value={again} onChange={(v) => { setAgain(v); setErr('') }} ok={FOUR.test(again) && again === pin} autoComplete="new-password" /></Field>
          <ErrorLine>{err}</ErrorLine>
          <PrimaryButton ready={SIX.test(code) && FOUR.test(pin) && pin === again} busy={busy}>{busy ? t('common.loading') : t('forgot.reset')}</PrimaryButton>
          <div className="flex flex-wrap justify-between gap-2 text-sm">
            <button type="button" onClick={send} disabled={busy} className="cursor-pointer border-0 bg-transparent p-0 font-bold text-plum hover:underline">{t('forgot.resend')}</button>
            <button type="button" onClick={() => { setStep('phone'); setErr('') }} className="cursor-pointer border-0 bg-transparent p-0 font-semibold text-muted hover:underline">{t('forgot.changeNumber')}</button>
          </div>
        </form>
      )}

      {step === 'done' && (
        <div className="flex flex-col items-center gap-3 py-4 text-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-[#e9f7ee] text-[#1d6b3a]">
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12l5 5L20 7" /></svg>
          </span>
          <h1 className="m-0 text-2xl font-extrabold">{t('forgot.doneTitle')}</h1>
          <p className="m-0 text-[15px] text-muted">{t('forgot.doneBody')}</p>
          <Link to="/login" className="mt-2 flex min-h-[52px] w-full items-center justify-center rounded-2xl bg-plum text-base font-bold !text-white no-underline hover:bg-plum-dark">{t('forgot.toLogin')}</Link>
        </div>
      )}
    </AuthShell>
  )
}
