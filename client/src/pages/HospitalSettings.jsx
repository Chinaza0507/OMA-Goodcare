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
  service_exists: 'This department already has a service with that name.',
  email_taken: 'That email already has an account.',
  invalid_input: 'Please check the details. Closing time must be after opening time.',
}
const errText = (e) => ERR[e.code] ?? 'Something went wrong. Please try again.'
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const daysText = (list) => (list.length === 0 ? 'No booking days yet' : list.length === 7 ? 'Every day' : list.map((d) => DAYS[d]).join(', '))
const naira = (n) => `₦${Number(n).toLocaleString('en-NG')}`
const priceText = (p) => (p == null ? 'Price at hospital' : p === 0 ? 'Free' : naira(p))

function Label({ text, hint, children, className = '' }) {
  return (
    <label className={`flex flex-col gap-1.5 ${className}`}>
      <span className="text-sm font-semibold">{text}{hint && <span className="font-normal text-muted"> · {hint}</span>}</span>
      {children}
    </label>
  )
}

// Booking days (tap to toggle) and booking hours.
function DaysAndHours({ value, onChange }) {
  const toggle = (d) => onChange({ ...value, bookingDays: value.bookingDays.includes(d) ? value.bookingDays.filter((x) => x !== d) : [...value.bookingDays, d].sort() })
  return (
    <div className="flex flex-col gap-3">
      <div>
        <span className="text-sm font-semibold">Booking days <span className="font-normal text-muted">· the days the doctor sees online bookings</span></span>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {DAYS.map((name, d) => (
            <button key={name} type="button" aria-pressed={value.bookingDays.includes(d)} onClick={() => toggle(d)}
              className={`min-h-10 min-w-12 cursor-pointer rounded-xl border-[1.5px] px-2.5 text-sm font-bold ${value.bookingDays.includes(d) ? 'border-plum bg-plum text-white' : 'border-line bg-white text-ink hover:border-plum-soft'}`}>{name}</button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Label text="From"><input type="time" className={input} value={value.opensAt} onChange={(e) => onChange({ ...value, opensAt: e.target.value })} /></Label>
        <Label text="To"><input type="time" className={input} value={value.closesAt} onChange={(e) => onChange({ ...value, closesAt: e.target.value })} /></Label>
      </div>
    </div>
  )
}

function ServiceForm({ value, onChange, onSubmit, onCancel, busy, submitText }) {
  return (
    <form className="grid gap-2.5 sm:grid-cols-[1fr_110px_140px_auto]" onSubmit={(e) => { e.preventDefault(); onSubmit() }}>
      <input className={input} value={value.name} onChange={(e) => onChange({ ...value, name: e.target.value })} placeholder="Service, e.g. Teeth cleaning" aria-label="Service name" />
      <input className={input} type="number" min="5" max="480" value={value.minutes} onChange={(e) => onChange({ ...value, minutes: e.target.value })} aria-label="Minutes it takes" title="Minutes it takes" />
      <input className={input} inputMode="numeric" value={value.price} onChange={(e) => onChange({ ...value, price: e.target.value.replace(/\D/g, '') })} placeholder="Price (optional)" aria-label="Price in naira" />
      <span className="flex gap-2">
        {onCancel && <button type="button" onClick={onCancel} className={ghost}>Cancel</button>}
        <button type="submit" disabled={busy} className={pink}>{busy ? 'Saving…' : submitText}</button>
      </span>
    </form>
  )
}

export default function HospitalSettings() {
  const { user, checking, refresh } = useAuth()
  const [data, setData] = useState(null)
  const [rules, setRules] = useState(null)
  const [newDept, setNewDept] = useState(null)
  const [editDept, setEditDept] = useState(null) // { id, name, bookingDays, opensAt, closesAt }
  const [newService, setNewService] = useState({}) // departmentId -> form
  const [editService, setEditService] = useState(null)
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
  const serviceBody = (sv) => ({ name: sv.name.trim(), minutes: Number(sv.minutes) || 30, price: sv.price === '' ? null : Number(sv.price) })

  if (checking) return null
  if (!user || (user.role !== 'manager' && user.role !== 'staff')) return <Navigate to="/hospital/login" replace />
  if (!isManager) return <Navigate to="/hospital/home" replace />

  return (
    <HospitalShell>
      <div className="flex flex-col gap-5">
        <div>
          <h1 className="m-0 text-[28px] font-extrabold leading-tight">Settings</h1>
          <p className="m-0 mt-1 text-sm text-muted">Set up what patients can book. Only the manager can change these.</p>
        </div>

        {!data && <div aria-hidden="true" className="h-64 animate-pulse rounded-[24px] bg-[#efe7ec]" />}

        {data && (
          <div className="grid items-start gap-5 lg:grid-cols-[1fr_380px]">
            {/* Departments, booking days and services */}
            <section className="flex flex-col gap-4">
              <div className="flex items-center justify-between gap-3">
                <h2 className="m-0 text-lg font-bold">Departments and services</h2>
                {!newDept && <button type="button" onClick={() => setNewDept({ name: '', bookingDays: [1, 2, 3, 4, 5], opensAt: '09:00', closesAt: '16:00' })} className={pink}>+ Add department</button>}
              </div>

              {newDept && (
                <form className="flex flex-col gap-3 rounded-[22px] bg-white p-5 ring-1 ring-line" onSubmit={async (e) => {
                  e.preventDefault()
                  if (newDept.name.trim().length < 2) return flash(false, 'Please enter a department name.')
                  if (await run('newDept', () => api('/manager/departments', { method: 'POST', body: { ...newDept, name: newDept.name.trim() } }), `${newDept.name.trim()} added. Now add its services.`)) setNewDept(null)
                }}>
                  <Label text="Department name"><input className={input} value={newDept.name} onChange={(e) => setNewDept({ ...newDept, name: e.target.value })} placeholder="e.g. Dental, Eye clinic, GOPD" autoFocus /></Label>
                  <DaysAndHours value={newDept} onChange={setNewDept} />
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setNewDept(null)} className={ghost}>Cancel</button>
                    <button type="submit" disabled={busy === 'newDept'} className={pink}>{busy === 'newDept' ? 'Saving…' : 'Add department'}</button>
                  </div>
                </form>
              )}

              {data.departments.length === 0 && !newDept && (
                <p className="m-0 rounded-[22px] border border-dashed border-line bg-white/60 p-6 text-center text-sm text-muted">
                  Add a department (like Dental), choose its booking days, then list its services with how long each takes.
                </p>
              )}

              {data.departments.map((d) => {
                const svForm = newService[d.id]
                return (
                  <article key={d.id} className={`flex flex-col gap-3 rounded-[22px] bg-white p-5 ring-1 ring-line ${d.active ? '' : 'opacity-60'}`}>
                    {editDept?.id === d.id ? (
                      <form className="flex flex-col gap-3" onSubmit={async (e) => {
                        e.preventDefault()
                        const { id, ...body } = editDept
                        if (await run(id, () => api(`/manager/departments/${id}`, { method: 'PATCH', body }), 'Department saved.')) setEditDept(null)
                      }}>
                        <Label text="Department name"><input className={input} value={editDept.name} onChange={(e) => setEditDept({ ...editDept, name: e.target.value })} /></Label>
                        <DaysAndHours value={editDept} onChange={setEditDept} />
                        <div className="flex gap-2">
                          <button type="button" onClick={() => setEditDept(null)} className={ghost}>Cancel</button>
                          <button type="submit" disabled={busy === d.id} className={pink}>Save</button>
                        </div>
                      </form>
                    ) : (
                      <div className="flex flex-wrap items-start gap-3">
                        <span className="min-w-0 flex-1">
                          <b className="block text-[17px]">{d.name}{!d.active && <span className="ml-2 rounded-full bg-[#f1edf3] px-2 py-0.5 text-xs text-muted">Off</span>}</b>
                          <span className="text-sm text-muted">Bookings: {daysText(d.bookingDays)} · {d.opensAt}–{d.closesAt}</span>
                        </span>
                        <button type="button" onClick={() => setEditDept({ id: d.id, name: d.name, bookingDays: d.bookingDays, opensAt: d.opensAt, closesAt: d.closesAt })} className={`${ghost} text-plum`}>Edit</button>
                        <button type="button" disabled={busy === `t${d.id}`} onClick={() => run(`t${d.id}`, () => api(`/manager/departments/${d.id}`, { method: 'PATCH', body: { active: !d.active } }), d.active ? `${d.name} turned off.` : `${d.name} turned on.`)}
                          className={`${ghost} ${d.active ? 'text-rose' : 'text-[#1d6b3a]'}`}>{d.active ? 'Turn off' : 'Turn on'}</button>
                      </div>
                    )}

                    <div className="rounded-2xl bg-plum-faint p-3 ring-1 ring-line">
                      {d.services.length === 0 && <p className="m-0 px-1 pb-2 text-sm text-muted">No services yet. Patients can only book this department once it has at least one.</p>}
                      <ul className="m-0 flex list-none flex-col divide-y divide-line p-0">
                        {d.services.map((sv) => (
                          <li key={sv.id} className={`py-2.5 first:pt-0 ${sv.active ? '' : 'opacity-60'}`}>
                            {editService?.id === sv.id ? (
                              <ServiceForm value={editService} onChange={setEditService} busy={busy === sv.id} submitText="Save" onCancel={() => setEditService(null)}
                                onSubmit={async () => { if (await run(sv.id, () => api(`/manager/services/${sv.id}`, { method: 'PATCH', body: serviceBody(editService) }), 'Service saved.')) setEditService(null) }} />
                            ) : (
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="min-w-0 flex-1 px-1">
                                  <b className="text-[15px]">{sv.name}</b>
                                  <span className="block text-xs text-muted">{sv.minutes} min · {priceText(sv.price)}{!sv.active && ' · Off'}</span>
                                </span>
                                <button type="button" onClick={() => setEditService({ id: sv.id, name: sv.name, minutes: sv.minutes, price: sv.price == null ? '' : String(sv.price) })} className={`${ghost} text-plum`}>Edit</button>
                                <button type="button" onClick={() => run(`s${sv.id}`, () => api(`/manager/services/${sv.id}`, { method: 'PATCH', body: { active: !sv.active } }), sv.active ? `${sv.name} hidden from booking.` : `${sv.name} is bookable again.`)}
                                  className={`${ghost} ${sv.active ? 'text-rose' : 'text-[#1d6b3a]'}`}>{sv.active ? 'Turn off' : 'Turn on'}</button>
                              </div>
                            )}
                          </li>
                        ))}
                      </ul>
                      {svForm ? (
                        <div className="mt-2">
                          <ServiceForm value={svForm} onChange={(v) => setNewService({ ...newService, [d.id]: v })} busy={busy === `n${d.id}`} submitText="Add"
                            onCancel={() => setNewService({ ...newService, [d.id]: null })}
                            onSubmit={async () => {
                              if (svForm.name.trim().length < 2) return flash(false, 'Please name the service.')
                              if (await run(`n${d.id}`, () => api(`/manager/departments/${d.id}/services`, { method: 'POST', body: serviceBody(svForm) }), `${svForm.name.trim()} added.`)) setNewService({ ...newService, [d.id]: null })
                            }} />
                          <p className="m-0 mt-1.5 px-1 text-xs text-muted">Minutes = how long it usually takes. This sets the booking length and the patients’ wait estimates.</p>
                        </div>
                      ) : (
                        <button type="button" onClick={() => setNewService({ ...newService, [d.id]: { name: '', minutes: 30, price: '' } })}
                          className="mt-2 cursor-pointer border-0 bg-transparent px-1 text-sm font-bold text-plum hover:underline">+ Add service</button>
                      )}
                    </div>
                  </article>
                )
              })}
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
