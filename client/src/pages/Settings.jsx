import { useEffect, useRef, useState } from 'react'
import { Navigate } from 'react-router-dom'
import PatientShell from '../components/PatientShell.jsx'
import LangSwitch from '../components/LangSwitch.jsx'
import { api } from '../api.js'
import { THEMES, applyTheme, currentTheme } from '../lib/theme.js'
import ConfirmBox from '../components/ConfirmBox.jsx'
import AlertSound from '../components/AlertSound.jsx'
import { Field, PinInput } from '../components/fields.jsx'
import { useAuth } from '../auth.jsx'
import { useT } from '../i18n/index.jsx'

const ALERT_CHOICES = [1, 2, 3, 4, 5, 7, 10]

const Saved = ({ show, t }) => (show
  ? <span role="status" className="flex items-center gap-1 text-[13px] font-semibold text-[#1d6b3a]">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12l5 5L20 7" /></svg>{t('settings.saved')}
    </span>
  : null)

// Patient settings: language and the default "turn is close" alert point.
export default function Settings() {
  const { t, lang } = useT()
  const { user, checking, refresh, logout } = useAuth()
  const [deleting, setDeleting] = useState(false)
  const [delPin, setDelPin] = useState('')
  const [delError, setDelError] = useState('')
  const [saved, setSaved] = useState('')
  const [busy, setBusy] = useState(false)
  const [theme, setTheme] = useState(currentTheme)

  const flash = (what) => { setSaved(what); setTimeout(() => setSaved(''), 1800) }

  // Language is switched instantly on screen; save it to the account so it follows the user.
  const first = useRef(true)
  useEffect(() => {
    if (first.current) { first.current = false; return }
    if (!user) return
    api('/auth/me', { method: 'PATCH', body: { language: lang } }).then(() => flash('language')).catch(() => {})
  }, [lang, user])

  async function setAlert(n) {
    if (busy || n === user.alertAhead) return
    setBusy(true)
    try {
      await api('/auth/me', { method: 'PATCH', body: { alertAhead: n } })
      await refresh()
      flash('alert')
    } finally {
      setBusy(false)
    }
  }

  if (checking) return null
  if (!user) return <Navigate to="/login" replace />


  return (
    <PatientShell>
      <div className="flex max-w-2xl flex-col gap-5">
        <h1 className="m-0 text-[30px] font-extrabold">{t('settings.title')}</h1>

        <section className="rounded-[24px] bg-white p-5 ring-1 ring-line sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="m-0 text-lg font-bold">{t('dash.language')}</h2>
            <Saved show={saved === 'language'} t={t} />
          </div>
          <p className="mb-4 mt-1 text-sm text-muted">{t('settings.languageHelp')}</p>
          <LangSwitch />
        </section>

        <section className="rounded-[24px] bg-white p-5 ring-1 ring-line sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="m-0 text-lg font-bold">{t('settings.alertTitle')}</h2>
            <Saved show={saved === 'alert'} t={t} />
          </div>
          <p className="mb-4 mt-1 text-sm text-muted">{t('settings.alertHelp')}</p>
          <div role="radiogroup" aria-label={t('settings.alertTitle')} className="flex flex-wrap gap-2">
            {ALERT_CHOICES.map((n) => {
              const on = user.alertAhead === n
              return (
                <button key={n} type="button" role="radio" aria-checked={on} disabled={busy} onClick={() => setAlert(n)}
                  className={`min-h-11 min-w-12 cursor-pointer rounded-xl border-[1.5px] px-4 font-display text-base font-bold transition-colors disabled:cursor-wait ${on ? 'border-plum bg-plum text-white' : 'border-line bg-white text-ink hover:border-plum-soft hover:bg-plum-tint'}`}>
                  {n}
                </button>
              )
            })}
          </div>
          <p className="mb-0 mt-3 text-sm text-muted">
            {user.alertAhead === 1 ? t('settings.onePerson') : t('settings.people').replace('{n}', user.alertAhead)}
          </p>
        </section>

        <AlertSound t={t} />

        <section className="rounded-[24px] bg-white p-5 ring-1 ring-line sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="m-0 text-lg font-bold">{t('settings.themeTitle')}</h2>
            <Saved show={saved === 'theme'} t={t} />
          </div>
          <p className="mb-4 mt-1 text-sm text-muted">{t('settings.themeHelp')}</p>
          <div role="radiogroup" aria-label={t('settings.themeTitle')} className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {THEMES.map((th) => {
              const on = theme === th.id
              return (
                <button key={th.id} type="button" role="radio" aria-checked={on}
                  onClick={() => { applyTheme(th.id); setTheme(th.id); flash('theme') }}
                  className={`flex cursor-pointer flex-col items-start gap-3 rounded-2xl border-[1.5px] bg-white p-3 text-left transition-colors ${on ? 'border-plum ring-2 ring-plum-soft' : 'border-line hover:border-plum-soft'}`}>
                  <span className="flex w-full overflow-hidden rounded-xl" aria-hidden="true">
                    <span className="h-10 flex-[2]" style={{ background: th.colors[0] }} />
                    <span className="h-10 flex-1" style={{ background: th.colors[1] }} />
                    <span className="h-10 flex-1 border-l border-line" style={{ background: th.colors[2] }} />
                  </span>
                  <span className="flex w-full items-center justify-between gap-2 text-sm font-bold">
                    {t(`settings.themes.${th.id}`)}
                    {on && <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="text-plum"><path d="M5 12l5 5L20 7" /></svg>}
                  </span>
                </button>
              )
            })}
          </div>
        </section>

        {user.role === 'patient' && (
          <section className="rounded-[24px] border-[1.5px] border-[#f3c7cf] bg-[#fff8f9] p-5 sm:p-6">
            <h2 className="m-0 flex items-center gap-2 text-lg font-bold text-[#c8102e]">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 9v4M12 17h.01M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /></svg>
              {t('settings.dangerTitle')}
            </h2>
            <p className="mb-4 mt-1 text-sm text-muted">{t('settings.dangerBody')}</p>
            <button type="button" onClick={() => { setDeleting(true); setDelPin(''); setDelError('') }}
              className="min-h-12 cursor-pointer rounded-2xl border-0 bg-[#c8102e] px-5 font-bold text-white hover:bg-[#a00c24]">{t('settings.deleteBtn')}</button>
          </section>
        )}
      </div>
      {deleting && (
        <ConfirmBox title={t('settings.deleteTitle')} body={t('settings.deleteBody')}
          yes={t('settings.deleteYes')} no={t('settings.deleteNo')} danger busy={busy}
          onNo={() => setDeleting(false)}
          onYes={async () => {
            if (!/^\d{4}$/.test(delPin)) { setDelError(t('profile.pinNeed')); return }
            setBusy(true)
            try {
              await api('/auth/delete-account', { method: 'POST', body: { secret: delPin } })
              logout()
            } catch (err) {
              setDelError(t(`errors.${err.code}`) !== `errors.${err.code}` ? t(`errors.${err.code}`) : t('errors.server_error'))
            } finally {
              setBusy(false)
            }
          }}>
          <div className="mt-4">
            <Field id="del-pin" label={t('settings.deletePin')}>
              <PinInput id="del-pin" value={delPin} onChange={(v) => { setDelPin(v); setDelError('') }} ok={false} autoComplete="current-password" />
            </Field>
            {delError && <p role="alert" className="m-0 mt-2 text-sm font-semibold text-[#c8102e]">{delError}</p>}
          </div>
        </ConfirmBox>
      )}
    </PatientShell>
  )
}
