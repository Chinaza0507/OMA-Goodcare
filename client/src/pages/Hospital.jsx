import { useState } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import Logo from '../components/Logo.jsx'
import { ErrorLine, Field, PrimaryButton, TextInput } from '../components/fields.jsx'
import { api } from '../api.js'
import { getPosition } from '../lib/geo.js'
import Hospital3D from '../components/Hospital3D.jsx'
import { useAuth } from '../auth.jsx'
import en from '../i18n/en.js'

// Hospital pages are always English for now; hospitals change language in settings after logging in.
const tEn = (path) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), en) ?? path

const TYPES = ['private', 'public', 'mission', 'dental', 'eye', 'specialist', 'school']
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

function Progress({ step, t }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between text-[13px] font-bold">
        <span className="text-rose">{t('hospital.stepOf').replace('{n}', step)}</span>
        <span className="text-muted">{step === 1 ? t('hospital.step1') : t('hospital.step2')}</span>
      </div>
      <div className="grid grid-cols-2 gap-1.5" aria-hidden="true">
        <span className="h-1.5 rounded-full bg-plum" />
        <span className={`h-1.5 rounded-full ${step === 2 ? 'bg-plum' : 'bg-line'}`} />
      </div>
    </div>
  )
}

const Wordmark = ({ className = '' }) => (
  <span className={`flex items-end gap-2 ${className}`}>
    <Logo width={36} />
    <span className="font-['Marcellus',Georgia,serif] text-[22px] leading-none">ỌMA</span>
    <span className="font-['Cormorant_Garamond',Georgia,serif] text-[11px] font-semibold italic leading-none text-rose">Good<br />Care</span>
  </span>
)

// Deep purple page with a compact card: form on the left (lavender), message and a
// hospital drawing on the right, with pink (rose) touches.
// Background: deep purple. Add ?bg=light to the address to see the light version
// (temporary, until one is chosen).
function HospitalLayout({ t, dark, children }) {
  return (
    // On laptops the page is exactly one screen tall and never scrolls; if the form is ever
    // taller than the card, only the form side of the card scrolls.
    <div className={`relative isolate min-h-screen overflow-clip p-3 sm:p-8 lg:flex lg:h-[100dvh] lg:min-h-0 lg:items-center lg:justify-center lg:px-16 lg:py-8 ${
      dark ? 'bg-[#2f1563]' : 'bg-[linear-gradient(140deg,#e6dcf7_0%,#ddd1f2_45%,#f3dceb_100%)]'}`}>
      <Logo className={`pointer-events-none absolute -left-24 top-10 -z-10 ${dark ? 'text-white opacity-[0.05]' : 'text-plum opacity-[0.07]'}`} width={520} />
      <Logo className={`pointer-events-none absolute -bottom-28 -right-20 -z-10 ${dark ? 'text-white opacity-[0.05]' : 'text-plum opacity-[0.07]'}`} width={560} />
      <div className={`mx-auto w-full max-w-[1040px] overflow-hidden rounded-[28px] bg-[#f7f3fc] lg:grid lg:h-full lg:max-h-[830px] lg:grid-cols-[1.25fr_1fr] lg:grid-rows-1 ${
        dark ? 'shadow-[0_24px_60px_rgba(10,3,25,0.45)]' : 'shadow-[0_24px_60px_rgba(90,45,176,0.18)] ring-1 ring-white/70'}`}>
        <div className="flex flex-col px-5 pb-7 pt-5 sm:px-9 lg:min-h-0 lg:overflow-y-auto lg:py-7">
          <Link to="/" aria-label="ỌMA home" className="self-start text-plum no-underline"><Wordmark /></Link>
          <div className="flex flex-1 items-center pt-5 [@media(min-width:1024px)_and_(max-height:820px)]:pt-3">{children}</div>
        </div>
        <div className="relative hidden flex-col bg-[#fbfaf5] px-9 pt-12 lg:flex lg:min-h-0">
          <div className="flex max-w-md flex-col">
            <span aria-hidden="true" className="font-display text-6xl font-extrabold leading-none text-rose">“</span>
            <p className="m-0 -mt-3 font-display text-[1.4rem] font-bold leading-snug text-ink">{t('hospital.quote')}</p>
            <span aria-hidden="true" className="mt-1 self-end font-display text-6xl font-extrabold leading-none text-rose">”</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-plum text-white"><Logo width={24} /></span>
            <span className="text-sm font-semibold text-muted">{t('hospital.quoteBy')}</span>
          </div>
          <Hospital3D className="absolute inset-x-0 bottom-0 h-auto w-full [mask-image:linear-gradient(to_bottom,#000_0%,#000_45%,transparent_100%)]" />
        </div>
      </div>
    </div>
  )
}

// mode 'register' lives at /hospital, mode 'login' at /hospital/login.
export default function Hospital({ mode = 'register' }) {
  const t = tEn
  const lang = 'en'
  const { user, workLogin } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const registered = mode === 'login' && location.state?.registered === true
  const [step, setStep] = useState(1)
  const [f, setF] = useState({ hospitalName: '', type: 'private', state: '', area: '', address: '', landmark: '', email: location.state?.email ?? '', password: '', confirm: '' })
  const [spot, setSpot] = useState(null) // { lat, lng } when the hospital shares its location
  const [spotState, setSpotState] = useState('idle') // idle | locating | failed
  const [tried, setTried] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const set = (k) => (v) => setF((s) => ({ ...s, [k]: v }))

  if (user && (user.role === 'manager' || user.role === 'staff')) return <Navigate to="/hospital/home" replace />
  if (user && user.role === 'admin') return <Navigate to="/admin" replace />

  const isLogin = mode === 'login'
  const emailOk = EMAIL_RE.test(f.email.trim())
  const ok = {
    name: f.hospitalName.trim().length >= 2,
    state: f.state.trim().length >= 2,
    area: f.area.trim().length >= 2,
    address: f.address.trim().length >= 3,
  }
  const checks = isLogin
    ? [[emailOk, t('hospital.needEmail')], [f.password.length > 0, t('hospital.needLoginPassword')]]
    : step === 1
      ? [[ok.name, t('hospital.needHospital')], [ok.state && ok.area && ok.address, t('hospital.needPlace')]]
      : [[emailOk, t('hospital.needEmail')], [f.password.length >= 8, t('hospital.needPassword')], [f.confirm === f.password, t('hospital.needMatch')]]
  const problem = checks.find(([good]) => !good)?.[1] || ''
  const ready = !problem

  const message = (code) => {
    if (code === 'bad_credentials') return t('errors.bad_work_credentials')
    const k = `errors.${code}`
    return t(k) !== k ? t(k) : t('errors.server_error')
  }


  async function submit(e) {
    e.preventDefault()
    setErr('')
    if (!ready) return setTried(true)
    if (!isLogin && step === 1) { setTried(false); setStep(2); return }
    setBusy(true)
    try {
      const email = f.email.trim().toLowerCase()
      if (isLogin) {
        const d = await workLogin(email, f.password)
        navigate(d.user.role === 'admin' ? '/admin' : d.user.role === 'patient' ? '/home' : '/hospital/home', { replace: true })
        return
      }
      // Register, then send them to sign in with the account they just made.
      await api('/hospitals/register', {
        method: 'POST',
        body: {
          hospitalName: f.hospitalName.trim(), type: f.type, state: f.state.trim(), area: f.area.trim(),
          address: f.address.trim(), landmark: f.landmark.trim() || undefined, email, password: f.password, language: lang,
          ...(spot ? { latitude: spot.lat, longitude: spot.lng } : {}),
        },
      })
      // Registered: go to the log-in page with the email ready.
      navigate('/hospital/login', { state: { registered: true, email } })
    } catch (e2) {
      setErr(message(e2.code))
    } finally {
      setBusy(false)
    }
  }

  const emailAndPassword = (
    <>
      <Field id="h-email" label={t('hospital.email')}>
        <TextInput id="h-email" type="email" autoComplete="email" value={f.email} onChange={(e) => set('email')(e.target.value)} placeholder={t('hospital.emailPh')} ok={emailOk} bad={tried && f.email.trim() !== '' && !emailOk} />
      </Field>
      <Field id="h-pass" label={isLogin ? t('hospital.password') : t('hospital.newPassword')}>
        <TextInput id="h-pass" type="password" autoComplete={isLogin ? 'current-password' : 'new-password'} value={f.password} onChange={(e) => set('password')(e.target.value)} ok={isLogin ? f.password.length > 0 : f.password.length >= 8} />
        {!isLogin && <span className="text-[13px] leading-snug text-muted">{t('hospital.passwordHelp')}</span>}
      </Field>
      {!isLogin && (
        <Field id="h-confirm" label={t('hospital.confirmPassword')}>
          <TextInput id="h-confirm" type="password" autoComplete="new-password" value={f.confirm} onChange={(e) => set('confirm')(e.target.value)}
            ok={f.confirm.length >= 8 && f.confirm === f.password} bad={f.confirm.length > 0 && !f.password.startsWith(f.confirm)} />
          {f.confirm.length > 0 && !f.password.startsWith(f.confirm) && <span className="text-[13px] text-danger">{t('hospital.needMatch')}</span>}
        </Field>
      )}
    </>
  )

  const form = (
  <form noValidate onSubmit={submit} className="hospital-form mx-auto flex w-full max-w-[500px] flex-col gap-3">
    <div>
      <h2 className="m-0 text-[25px] font-extrabold leading-tight">{isLogin ? t('hospital.loginTitle') : t('hospital.registerTitle')}</h2>
      <p className="hospital-sub mt-1.5 text-[15px] leading-normal text-muted">
        {isLogin ? t('hospital.loginSub') : step === 1 ? t('hospital.registerSub') : t('hospital.step2Help')}
      </p>
    </div>

    {!isLogin && <Progress step={step} t={t} />}

    {isLogin && registered && (
      <div role="status" className="flex gap-3 rounded-2xl border border-[#d9ccf7] bg-[#f3eefd] px-4 py-3.5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-plum text-white">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12l5 5L20 7" /></svg>
        </span>
        <span className="text-sm leading-snug"><b className="block text-[15px]">{t('hospital.registeredTitle')}</b><span className="text-muted">{t('hospital.registeredBody')}</span></span>
      </div>
    )}
    {isLogin && emailAndPassword}

    {!isLogin && step === 1 && (
      <>
        <Field id="h-name" label={t('hospital.hospitalName')}>
          <TextInput id="h-name" autoComplete="organization" value={f.hospitalName} onChange={(e) => set('hospitalName')(e.target.value)} placeholder={t('hospital.hospitalNamePh')} ok={ok.name} />
        </Field>
        <Field id="h-type" label={t('hospital.type')}>
          <select id="h-type" value={f.type} onChange={(e) => set('type')(e.target.value)}
            className="min-h-[52px] w-full cursor-pointer rounded-[14px] border-[1.5px] border-plum bg-white px-3.5 text-base text-ink">
            {TYPES.map((ty) => <option key={ty} value={ty}>{t(`hospital.types.${ty}`)}</option>)}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-2.5">
          <Field id="h-state" label={t('hospital.state')}><TextInput id="h-state" value={f.state} onChange={(e) => set('state')(e.target.value)} placeholder={t('hospital.statePh')} ok={ok.state} /></Field>
          <Field id="h-area" label={t('hospital.area')}><TextInput id="h-area" value={f.area} onChange={(e) => set('area')(e.target.value)} placeholder={t('hospital.areaPh')} ok={ok.area} /></Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
        <Field id="h-address" label={t('hospital.address')}>
          <TextInput id="h-address" autoComplete="street-address" value={f.address} onChange={(e) => set('address')(e.target.value)} placeholder={t('hospital.addressPh')} ok={ok.address} />
        </Field>
        <Field id="h-landmark" label={<>{t('hospital.landmark')} <span className="font-normal text-muted">({t('hospital.optional')})</span></>}>
          <TextInput id="h-landmark" value={f.landmark} onChange={(e) => set('landmark')(e.target.value)} placeholder={t('hospital.landmarkPh')} ok={f.landmark.trim().length > 1} />
        </Field>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <button type="button" disabled={spotState === 'locating'}
            onClick={async () => { setSpotState('locating'); try { setSpot(await getPosition()); setSpotState('idle') } catch { setSpotState('failed') } }}
            className={`flex min-h-9 cursor-pointer items-center gap-2 rounded-xl border-[1.5px] px-3 text-[13px] font-bold disabled:cursor-wait ${spot ? 'border-[#9bd3ae] bg-[#eef8f1] text-[#1d6b3a]' : 'border-rose bg-white text-rose hover:bg-blush'}`}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{spot ? <path d="M5 12l5 5L20 7" /> : <><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.5" /></>}</svg>
            {spot ? t('hospital.locationSaved') : spotState === 'locating' ? t('find.locating') : t('hospital.useLocation')}
          </button>
          <span className={`hospital-sub min-w-0 flex-1 text-[12px] leading-snug ${spotState === 'failed' ? 'text-rose' : 'text-muted'}`}>{spotState === 'failed' ? t('hospital.locationFail') : !spot ? t('hospital.locationHelp') : ''}</span>
        </div>
      </>
    )}

    {!isLogin && step === 2 && (
      <>
        <div className="flex items-center gap-3 rounded-2xl bg-[#f6f1fe] px-4 py-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-plum text-white">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12l5 5L20 7" /></svg>
          </span>
          <span className="min-w-0 text-sm leading-snug">
            <b className="block truncate">{f.hospitalName.trim()}</b>
            <span className="text-muted">{[f.area.trim(), f.state.trim()].filter(Boolean).join(', ')}</span>
          </span>
        </div>
        {emailAndPassword}
      </>
    )}

    <ErrorLine>{err || (tried && !ready && !(problem === t('hospital.needMatch') && f.confirm) ? problem : '')}</ErrorLine>

    <div className="flex gap-2.5">
      {!isLogin && step === 2 && (
        <button type="button" onClick={() => { setStep(1); setTried(false); setErr('') }}
          className="min-h-14 cursor-pointer rounded-2xl border-[1.5px] border-line bg-white px-5 text-[17px] font-bold text-ink hover:bg-blush">
          {t('hospital.back')}
        </button>
      )}
      <div className="flex-1">
        <PrimaryButton tone="rose" ready={ready} busy={busy}>
          {busy ? t('common.loading') : isLogin ? t('hospital.submitLogin') : step === 1 ? t('hospital.next') : t('hospital.submitRegister')}
        </PrimaryButton>
      </div>
    </div>

    <p className="m-0 text-center text-sm text-muted">
      {isLogin ? t('hospital.newHospital') : t('hospital.alreadyRegistered')}{' '}
      <Link to={isLogin ? '/hospital' : '/hospital/login'} className="font-bold text-plum underline-offset-2 hover:underline">
        {isLogin ? t('hospital.registerLink') : t('hospital.tabLogin')}
      </Link>
    </p>
  </form>
  )

  return <HospitalLayout t={t} dark={new URLSearchParams(location.search).get('bg') !== 'light'}>{form}</HospitalLayout>
}
