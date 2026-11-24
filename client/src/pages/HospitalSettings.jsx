import { useCallback, useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import HospitalShell from '../components/HospitalShell.jsx'
import { api } from '../api.js'
import { useAuth } from '../auth.jsx'

const input = 'min-h-11 w-full rounded-[12px] border-[1.5px] border-line bg-white px-3 text-[15px] text-ink'
const pink = 'min-h-11 cursor-pointer rounded-xl border-0 bg-rose px-5 text-sm font-bold text-white hover:bg-rose-dark disabled:cursor-wait disabled:opacity-60'
const ghost = 'min-h-10 cursor-pointer rounded-xl border border-line bg-white px-3.5 text-sm font-semibold hover:bg-cream'
const ERR = {
  department_exists: 'A department with that name already exists.',
  email_taken: 'That email already has an account.',
  invalid_input: 'Please check the details. Closing time must be after opening time.',
}
const errText = (e) => ERR[e.code] ?? 'Something went wrong. Please try again.'
const num = (v) => (v === '' || v == null ? null : Number(v))
const blankDept = { name: '', opensAt: '08:00', closesAt: '16:00', slotMinutes: 15, avgVisitMinutes: 12, consultationFee: '' }

function Label({ text, hint, children, className = '' }) {
  return (
    <label className={`flex flex-col gap-1.5 ${className}`}>
      <span className="text-sm font-semibold">{text}{hint && <span className="font-normal text-muted"> · {hint}</span>}</span>
      {children}
    </label>
  )
}

function DeptForm({ value, onChange, onSubmit, onCancel, busy, submitText }) {
  const set = (k) => (e) => onChange({ ...value, [k]: e.target.value })
  return (
    <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); onSubmit() }}>
      <Label text="Department name" className="sm:col-span-2"><input className={input} value={value.name} onChange={set('name')} placeholder="e.g. GOPD" /></Label>
      <Label text="Opens"><input type="time" className={input} value={value.opensAt} onChange={set('opensAt')} /></Label>
      <Label text="Closes"><input type="time" className={input} value={value.closesAt} onChange={set('closesAt')} /></Label>
      <Label text="Slot length" hint="minutes"><input type="number" min="5" max="120" className={input} value={value.slotMinutes} onChange={set('slotMinutes')} /></Label>
      <Label text="Average visit" hint="minutes"><input type="number" min="1" max="240" className={input} value={value.avgVisitMinutes} onChange={set('avgVisitMinutes')} /></Label>
      <Label text="Consultation fee" hint="₦, optional" className="sm:col-span-2"><input inputMode="numeric" className={input} value={value.consultationFee ?? ''} onChange={(e) => onChange({ ...value, consultationFee: e.target.value.replace(/\D/g, '') })} placeholder="Leave empty if free" /></Label>
      <div className="flex gap-2 sm:col-span-2">
        {onCancel && <button type="button" onClick={onCancel} className={ghost}>Cancel</button>}
        <button type="submit" disabled={busy} className={pink}>{busy ? 'Saving…' : submitText}</button>
      </div>
    </form>
  )
}

export default function HospitalSettings() {
  const { user, checking, refresh } = useAuth()
  const [data, setData] = useState(null)
  const [rules, setRules] = useState(null)
  const [newDept, setNewDept] = useState(null)
  const [editing, setEditing] = useState(null)
  const [staff, setStaff] = useState({ name: '', email: '', password: '' })
  const [busy, setBusy] = useState(null)
  const [toast, setToast] = useState(null)
  const isManager = user?.role === 'manager'

  const flash = (ok, text) => { setToast({ ok, text }); setTimeout(() => setToast(null), 3500) }
  const load = useCallback(async () => {
    const d = await api('/manager/clinic')
    setData(d)
    setRules((r) => r ?? {
      name: d.clinic.name, state: d.clinic.state ?? '', area: d.clinic.area ?? '', address: d.clinic.address ?? '',
      graceMinutes: d.clinic.graceMinutes, cancelWindowMinutes: d.clinic.cancelWindowMinutes,
    })
  }, [])
  useEffect(() => { if (isManager) load().catch(() => flash(false, 'Could not load settings.')) }, [isManager, load])

  async function run(key, fn, okText) {
    setBusy(key)
    try { await fn(); await load(); if (okText) flash(true, okText); return true } catch (e) { flash(false, errText(e)); return false } finally { setBusy(null) }
  }
  const deptBody = (d) => ({
    name: d.name.trim(), opensAt: d.opensAt, closesAt: d.closesAt,
    slotMinutes: Number(d.slotMinutes), avgVisitMinutes: Number(d.avgVisitMinutes), consultationFee: num(d.consultationFee),
  })

  if (checking) return null
  if (!user || (user.role !== 'manager' && user.role !== 'staff')) return <Navigate to="/hospital/login" replace />
  if (!isManager) return <Navigate to="/hospital/home" replace />

  return (
    <HospitalShell>
      <div className="flex flex-col gap-5">
        <div>
          <h1 className="m-0 text-[28px] font-extrabold leading-tight">Settings</h1>
          <p className="m-0 mt-1 text-sm text-muted">Only the manager can change these.</p>
        </div>

        {!data && <div aria-hidden="true" className="h-64 animate-pulse rounded-[24px] bg-[#efe7ec]" />}

        {data && (
          <div className="grid items-start gap-5 lg:grid-cols-[1fr_400px]">
            {/* Departments */}
            <section className="rounded-[24px] bg-white p-5 ring-1 ring-line sm:p-6">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="m-0 text-lg font-bold">Departments</h2>
                {!newDept && <button type="button" onClick={() => { setEditing(null); setNewDept(blankDept) }} className={pink}>+ Add department</button>}
              </div>
              {newDept && (
                <div className="mb-4 rounded-2xl bg-plum-faint p-4 ring-1 ring-line">
                  <DeptForm value={newDept} onChange={setNewDept} busy={busy === 'newDept'} submitText="Add department" onCancel={() => setNewDept(null)}
                    onSubmit={async () => {
                      if (newDept.name.trim().length < 2) return flash(false, 'Please enter a department name.')
                      if (await run('newDept', () => api('/manager/departments', { method: 'POST', body: deptBody(newDept) }), `${newDept.name.trim()} added.`)) setNewDept(null)
                    }} />
                </div>
              )}
              {data.departments.length === 0 && !newDept && (
                <p className="m-0 rounded-2xl border border-dashed border-line p-6 text-center text-sm text-muted">No departments yet. Add your first one so patients can join your queue.</p>
              )}
              <ul className="m-0 flex list-none flex-col divide-y divide-line p-0">
                {data.departments.map((d) => (
                  <li key={d.id} className="py-3.5 first:pt-0 last:pb-0">
                    {editing?.id === d.id ? (
                      <DeptForm value={editing} onChange={setEditing} busy={busy === d.id} submitText="Save" onCancel={() => setEditing(null)}
                        onSubmit={async () => {
                          if (await run(d.id, () => api(`/manager/departments/${d.id}`, { method: 'PATCH', body: deptBody(editing) }), 'Department saved.')) setEditing(null)
                        }} />
                    ) : (
                      <div className={`flex flex-wrap items-center gap-3 ${d.active ? '' : 'opacity-60'}`}>
                        <span className="min-w-0 flex-1">
                          <b className="block text-[16px]">{d.name}{!d.active && <span className="ml-2 rounded-full bg-[#f1edf3] px-2 py-0.5 text-xs text-muted">Off</span>}</b>
                          <span className="text-sm text-muted">{d.opensAt}–{d.closesAt} · {d.slotMinutes}-min slots · {d.consultationFee == null ? 'No fee set' : `₦${d.consultationFee.toLocaleString('en-NG')}`}</span>
                        </span>
                        <button type="button" onClick={() => { setNewDept(null); setEditing({ ...d, consultationFee: d.consultationFee ?? '' }) }} className={`${ghost} text-plum`}>Edit</button>
                        <button type="button" disabled={busy === `t${d.id}`} onClick={() => run(`t${d.id}`, () => api(`/manager/departments/${d.id}`, { method: 'PATCH', body: { active: !d.active } }), d.active ? `${d.name} turned off.` : `${d.name} turned on.`)}
                          className={`${ghost} ${d.active ? 'text-rose' : 'text-[#1d6b3a]'}`}>{d.active ? 'Turn off' : 'Turn on'}</button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </section>

            <div className="flex flex-col gap-5">
              {/* Clinic rules */}
              <form className="flex flex-col gap-3 rounded-[24px] bg-white p-5 ring-1 ring-line sm:p-6" onSubmit={(e) => {
                e.preventDefault()
                run('rules', () => api('/manager/clinic', { method: 'PATCH', body: {
                  name: rules.name.trim(), state: rules.state.trim(), area: rules.area.trim(), address: rules.address.trim(),
                  graceMinutes: Number(rules.graceMinutes), cancelWindowMinutes: Number(rules.cancelWindowMinutes),
                } }).then(() => refresh?.()), 'Hospital details saved.')
              }}>
                <h2 className="m-0 text-lg font-bold">Hospital rules</h2>
                <div className="grid grid-cols-2 gap-3">
                  <Label text="Grace time" hint="min"><input type="number" min="0" max="120" className={input} value={rules.graceMinutes} onChange={(e) => setRules({ ...rules, graceMinutes: e.target.value })} /></Label>
                  <Label text="Cancel window" hint="min"><input type="number" min="0" max="1440" className={input} value={rules.cancelWindowMinutes} onChange={(e) => setRules({ ...rules, cancelWindowMinutes: e.target.value })} /></Label>
                </div>
                <p className="m-0 text-xs leading-relaxed text-muted">Grace time: how long a called patient has before you can mark a no-show. Cancel window: patients who cancel at least this long before their time get their ₦300 back.</p>
                <Label text="Hospital name"><input className={input} value={rules.name} onChange={(e) => setRules({ ...rules, name: e.target.value })} /></Label>
                <div className="grid grid-cols-2 gap-3">
                  <Label text="State"><input className={input} value={rules.state} onChange={(e) => setRules({ ...rules, state: e.target.value })} /></Label>
                  <Label text="Area"><input className={input} value={rules.area} onChange={(e) => setRules({ ...rules, area: e.target.value })} /></Label>
                </div>
                <Label text="Address"><input className={input} value={rules.address} onChange={(e) => setRules({ ...rules, address: e.target.value })} /></Label>
                <button type="submit" disabled={busy === 'rules'} className={pink}>{busy === 'rules' ? 'Saving…' : 'Save'}</button>
              </form>

              {/* Staff */}
              <section className="flex flex-col gap-3 rounded-[24px] bg-white p-5 ring-1 ring-line sm:p-6">
                <h2 className="m-0 text-lg font-bold">Front-desk staff</h2>
                <ul className="m-0 flex list-none flex-col divide-y divide-line p-0">
                  {data.staff.map((s) => (
                    <li key={s.id} className={`flex items-center gap-3 py-2.5 ${s.active ? '' : 'opacity-60'}`}>
                      <span className="min-w-0 flex-1">
                        <b className="block truncate text-[15px]">{s.name}</b>
                        <span className="block truncate text-xs text-muted">{s.email} · {s.role === 'manager' ? 'Manager' : s.active ? 'Front desk' : 'Disabled'}</span>
                      </span>
                      {s.role === 'staff' && (
                        <button type="button" disabled={busy === s.id} onClick={() => run(s.id, () => api(`/manager/staff/${s.id}`, { method: 'PATCH', body: { active: !s.active } }), s.active ? `${s.name} can no longer log in.` : `${s.name} can log in again.`)}
                          className={`${ghost} ${s.active ? 'text-rose' : 'text-[#1d6b3a]'}`}>{s.active ? 'Disable' : 'Enable'}</button>
                      )}
                    </li>
                  ))}
                </ul>
                <form className="flex flex-col gap-2.5 border-t border-line pt-3" onSubmit={async (e) => {
                  e.preventDefault()
                  if (staff.name.trim().length < 2 || !staff.email.includes('@') || staff.password.length < 8) return flash(false, 'Enter a name, an email and a password of at least 8 characters.')
                  if (await run('staff', () => api('/manager/staff', { method: 'POST', body: { name: staff.name.trim(), email: staff.email.trim(), password: staff.password } }), `${staff.name.trim()} can now log in at the front desk.`)) setStaff({ name: '', email: '', password: '' })
                }}>
                  <span className="text-sm font-semibold">Add a staff login</span>
                  <input className={input} placeholder="Full name" value={staff.name} onChange={(e) => setStaff({ ...staff, name: e.target.value })} autoComplete="off" />
                  <input className={input} type="email" placeholder="Work email" value={staff.email} onChange={(e) => setStaff({ ...staff, email: e.target.value })} autoComplete="off" />
                  <input className={input} type="password" placeholder="Password (8+ characters)" value={staff.password} onChange={(e) => setStaff({ ...staff, password: e.target.value })} autoComplete="new-password" />
                  <button type="submit" disabled={busy === 'staff'} className={pink}>{busy === 'staff' ? 'Adding…' : 'Add staff'}</button>
                </form>
              </section>
            </div>
          </div>
        )}
      </div>
      {toast && <div role="status" className={`fixed inset-x-0 bottom-6 z-[60] mx-auto w-fit max-w-[90vw] rounded-full px-5 py-3 text-sm font-semibold text-white shadow-lg ${toast.ok ? 'bg-ink' : 'bg-[#c8102e]'}`}>{toast.text}</div>}
    </HospitalShell>
  )
}
