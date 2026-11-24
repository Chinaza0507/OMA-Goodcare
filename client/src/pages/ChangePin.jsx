import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import PatientShell from '../components/PatientShell.jsx'
import SubPage from '../components/SubPage.jsx'
import { Field, PinInput } from '../components/fields.jsx'
import { api } from '../api.js'
import { useAuth } from '../auth.jsx'
import { useT } from '../i18n/index.jsx'

const FOUR = /^\d{4}$/

export default function ChangePin() {
  const { t } = useT()
  const { user, checking } = useAuth()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [again, setAgain] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState(null)

  if (checking) return null
  if (!user) return <Navigate to="/login" replace />

  const ready = FOUR.test(current) && FOUR.test(next) && next === again

  async function save(e) {
    e.preventDefault()
    if (!FOUR.test(current) || !FOUR.test(next)) return setNote({ ok: false, text: t('profile.pinNeed') })
    if (next !== again) return setNote({ ok: false, text: t('profile.pinMismatch') })
    setBusy(true)
    try {
      await api('/auth/change-secret', { method: 'POST', body: { current, next } })
      setCurrent(''); setNext(''); setAgain('')
      setNote({ ok: true, text: t('profile.pinSaved') })
    } catch (err) {
      setNote({ ok: false, text: t(`errors.${err.code}`) !== `errors.${err.code}` ? t(`errors.${err.code}`) : t('errors.server_error') })
    } finally {
      setBusy(false)
    }
  }

  return (
    <PatientShell>
      <SubPage title={t('profile.pinTitle')} backLabel={t('profile.back')}>
        <p className="m-0 text-center text-[15px] text-muted">{t('profile.pinSub')}</p>
        <form noValidate onSubmit={save} className="flex flex-col gap-4 rounded-[24px] bg-white p-5 ring-1 ring-line sm:p-6">
          <Field id="pin-current" label={t('profile.currentPin')}><PinInput id="pin-current" value={current} onChange={(v) => { setCurrent(v); setNote(null) }} ok={FOUR.test(current)} autoComplete="current-password" /></Field>
          <Field id="pin-new" label={t('profile.newPin')}><PinInput id="pin-new" value={next} onChange={(v) => { setNext(v); setNote(null) }} ok={FOUR.test(next)} autoComplete="new-password" /></Field>
          <Field id="pin-again" label={t('profile.confirmPin')}><PinInput id="pin-again" value={again} onChange={(v) => { setAgain(v); setNote(null) }} ok={FOUR.test(again) && again === next} autoComplete="new-password" /></Field>
          {again.length === 4 && again !== next && <p className="-mt-2 m-0 text-sm text-danger">{t('profile.pinMismatch')}</p>}
          {note && <p role={note.ok ? 'status' : 'alert'} className={`m-0 text-sm font-semibold ${note.ok ? 'text-[#1d6b3a]' : 'text-rose'}`}>{note.text}</p>}
          <button type="submit" disabled={busy}
            className={`min-h-[54px] rounded-2xl border-0 text-base font-bold ${ready && !busy ? 'cursor-pointer bg-rose text-white hover:bg-rose-dark' : 'cursor-not-allowed bg-[#efe7ec] text-[#6b5a65]'}`}>{busy ? t('common.loading') : t('profile.save')}</button>
        </form>
      </SubPage>
    </PatientShell>
  )
}
