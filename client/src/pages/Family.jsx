import { useCallback, useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import PatientShell from '../components/PatientShell.jsx'
import ConfirmBox from '../components/ConfirmBox.jsx'
import { api } from '../api.js'
import { useAuth } from '../auth.jsx'
import { useT } from '../i18n/index.jsx'

const initials = (name) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('')
const field = 'min-h-12 w-full rounded-[14px] border-[1.5px] border-line bg-white px-3.5 text-base text-ink'

export default function Family() {
  const { t } = useT()
  const { user, checking } = useAuth()
  const [members, setMembers] = useState(null)
  const [form, setForm] = useState({ name: '', age: '' })
  const [editing, setEditing] = useState(null) // { id, name, age }
  const [removing, setRemoving] = useState(null) // member
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState(null) // { ok, text }

  const msg = (code) => (t(`errors.${code}`) !== `errors.${code}` ? t(`errors.${code}`) : t('errors.server_error'))
  const load = useCallback(async () => setMembers((await api('/family')).members), [])
  useEffect(() => { if (user) load().catch(() => setNote({ ok: false, text: t('dash.loadError') })) }, [user, load, t])

  const ageValue = (v) => (v === '' || v == null ? undefined : Number(v))

  async function add(e) {
    e.preventDefault()
    if (form.name.trim().length < 2) { setNote({ ok: false, text: t('famPage.needName') }); return }
    setBusy(true)
    try {
      await api('/family', { method: 'POST', body: { name: form.name.trim(), age: ageValue(form.age) } })
      setNote({ ok: true, text: t('famPage.added').replace('{name}', form.name.trim()) })
      setForm({ name: '', age: '' })
      await load()
    } catch (err) {
      setNote({ ok: false, text: msg(err.code) })
    } finally {
      setBusy(false)
    }
  }

  async function save() {
    if (editing.name.trim().length < 2) { setNote({ ok: false, text: t('famPage.needName') }); return }
    setBusy(true)
    try {
      await api(`/family/${editing.id}`, { method: 'PATCH', body: { name: editing.name.trim(), age: ageValue(editing.age) } })
      setEditing(null)
      setNote(null)
      await load()
    } catch (err) {
      setNote({ ok: false, text: msg(err.code) })
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    const m = removing
    setBusy(true)
    try {
      await api(`/family/${m.id}`, { method: 'DELETE' })
      setRemoving(null)
      await load()
    } catch (err) {
      setRemoving(null)
      setNote({ ok: false, text: msg(err.code) })
    } finally {
      setBusy(false)
    }
  }

  if (checking) return null
  if (!user) return <Navigate to="/login" replace />

  return (
    <PatientShell>
      <div className="flex flex-col gap-5">
        <div>
          <h1 className="m-0 text-[30px] font-extrabold leading-tight">{t('famPage.title')}</h1>
          <p className="m-0 mt-1 text-[15px] text-muted">{t('famPage.sub')}</p>
        </div>

        {note && (
          <p role={note.ok ? 'status' : 'alert'} className={`m-0 rounded-2xl px-4 py-3 text-[15px] font-semibold ${note.ok ? 'bg-[#e9f7ee] text-[#1d6b3a]' : 'bg-blush text-rose'}`}>{note.text}</p>
        )}

        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
          <section className="rounded-[24px] bg-white p-5 ring-1 ring-line sm:p-6">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="m-0 text-lg font-bold">{t('famPage.title')}</h2>
              {members && <span className="text-sm font-semibold text-muted">{t('famPage.count').replace('{n}', members.length)}</span>}
            </div>
            {members === null ? (
              <div aria-hidden="true" className="h-40 animate-pulse rounded-2xl bg-[#efe7ec]" />
            ) : (
              <ul className="m-0 flex list-none flex-col divide-y divide-line p-0">
                {members.map((m) => (
                  <li key={m.id} className="py-3.5 first:pt-0 last:pb-0">
                    {editing?.id === m.id ? (
                      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-end">
                        <label className="flex flex-1 flex-col gap-1">
                          <span className="text-sm font-semibold">{t('famPage.name')}</span>
                          <input className={field} value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
                        </label>
                        <label className="flex w-full flex-col gap-1 sm:w-24">
                          <span className="text-sm font-semibold">{t('famPage.age')}</span>
                          <input className={field} inputMode="numeric" value={editing.age ?? ''} onChange={(e) => setEditing({ ...editing, age: e.target.value.replace(/\D/g, '').slice(0, 3) })} />
                        </label>
                        <div className="flex gap-2">
                          <button type="button" onClick={() => setEditing(null)} className="min-h-12 cursor-pointer rounded-xl border border-line bg-white px-4 font-semibold text-muted hover:bg-cream">{t('famPage.cancel')}</button>
                          <button type="button" disabled={busy} onClick={save} className="min-h-12 cursor-pointer rounded-xl border-0 bg-plum px-5 font-bold text-white hover:bg-plum-dark disabled:opacity-60">{t('famPage.save')}</button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-3">
                        <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-bold ${m.isSelf ? 'bg-plum text-white' : 'bg-plum-soft text-plum-deep'}`}>{initials(m.name)}</span>
                        <span className="min-w-0 flex-1">
                          <b className="block truncate text-[16px]">{m.name}</b>
                          <span className="text-sm text-muted">{m.isSelf ? t('famPage.you') : m.age != null ? `${m.age} ${t('famPage.years')}` : '—'}</span>
                        </span>
                        <button type="button" onClick={() => { setNote(null); setEditing({ id: m.id, name: m.name, age: m.age ?? '' }) }}
                          className="min-h-10 cursor-pointer rounded-xl border border-line bg-white px-3.5 text-sm font-semibold text-plum hover:bg-plum-tint">{t('famPage.edit')}</button>
                        {!m.isSelf && (
                          <button type="button" onClick={() => setRemoving(m)} className="min-h-10 cursor-pointer rounded-xl border border-line bg-white px-3.5 text-sm font-semibold text-rose hover:bg-blush">{t('famPage.remove')}</button>
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <form onSubmit={add} className="flex flex-col gap-4 rounded-[24px] bg-white p-5 ring-1 ring-line sm:p-6">
            <h2 className="m-0 text-lg font-bold">{t('famPage.addTitle')}</h2>
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-semibold">{t('famPage.name')}</span>
              <input className={field} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={t('famPage.namePh')} autoComplete="off" />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-semibold">{t('famPage.ageLabel')}</span>
              <input className={field} inputMode="numeric" value={form.age} onChange={(e) => setForm({ ...form, age: e.target.value.replace(/\D/g, '').slice(0, 3) })} placeholder="e.g. 6" />
            </label>
            <button type="submit" disabled={busy}
              className={`min-h-[52px] rounded-2xl border-0 text-base font-bold ${form.name.trim().length >= 2 && !busy ? 'cursor-pointer bg-rose text-white hover:bg-rose-dark' : 'cursor-not-allowed bg-[#efe7ec] text-[#6b5a65]'}`}>
              {busy ? t('common.loading') : t('famPage.add')}
            </button>
          </form>
        </div>
      </div>

      {removing && (
        <ConfirmBox title={t('famPage.removeTitle').replace('{name}', removing.name)} body={t('famPage.removeBody')}
          yes={t('famPage.removeYes')} no={t('famPage.cancel')} danger busy={busy}
          onYes={remove} onNo={() => setRemoving(null)} />
      )}
    </PatientShell>
  )
}
