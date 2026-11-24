import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import HospitalShell from '../components/HospitalShell.jsx'
import { api } from '../api.js'
import { useAuth } from '../auth.jsx'

const ACTION = {
  check_in: 'Marked as arrived',
  call: 'Called to the doctor',
  seen: 'Seen by the doctor',
  no_show: 'Marked as no-show',
  move_to_front: 'Moved to the front',
  late_arrival_requeued: 'Arrived late, back in queue',
  walk_in_registered: 'Walk-in added',
  cancelled_by_clinic: 'Visit cancelled by hospital',
  day_cancelled: 'Rest of day cancelled',
  slot_length_changed: 'Slot length changed',
  department_created: 'Department added',
  department_updated: 'Department changed',
  staff_created: 'Staff account added',
  clinic_settings_changed: 'Hospital rules changed',
  clinic_registered: 'Hospital registered',
  clinic_approved: 'Approved by ỌMA',
}
const time = (iso) => new Intl.DateTimeFormat('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Africa/Lagos' }).format(new Date(iso))
const mins = (n) => (n == null ? '—' : `${Math.round(n)} min`)

function Tile({ label, value, tone = 'text-ink' }) {
  return (
    <div className="rounded-[22px] bg-white p-5 ring-1 ring-line">
      <div className="text-sm font-semibold text-muted">{label}</div>
      <div className={`mt-1 font-display text-[34px] font-extrabold leading-none ${tone}`}>{value}</div>
    </div>
  )
}

export default function HospitalStats() {
  const { user, clinic, checking } = useAuth()
  const [stats, setStats] = useState(null)
  const [log, setLog] = useState(null)
  const [students, setStudents] = useState(null)
  const [error, setError] = useState(false)
  const isStaff = user && (user.role === 'manager' || user.role === 'staff')
  const isSchool = clinic?.type === 'school'

  useEffect(() => {
    if (!isStaff) return
    Promise.all([api('/staff/stats'), api('/staff/log')])
      .then(([s, l]) => { setStats(s); setLog(l.entries) })
      .catch(() => setError(true))
  }, [isStaff])
  useEffect(() => { if (isStaff && isSchool) api('/staff/noshows').then((d) => setStudents(d.students)).catch(() => {}) }, [isStaff, isSchool])

  if (checking) return null
  if (!isStaff) return <Navigate to="/hospital/login" replace />

  const tot = stats?.totals
  return (
    <HospitalShell>
      <div className="flex flex-col gap-5">
        <div>
          <p className="m-0 text-sm text-muted">{new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Africa/Lagos' }).format(new Date())}</p>
          <h1 className="m-0 text-[28px] font-extrabold leading-tight">Today’s numbers</h1>
        </div>

        {error && <p role="alert" className="m-0 text-muted">Could not load today’s numbers. Check the connection.</p>}
        {!stats && !error && <div aria-hidden="true" className="h-40 animate-pulse rounded-[24px] bg-[#efe7ec]" />}

        {stats && (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Tile label="Patients seen" value={tot?.patientsSeen ?? 0} tone="text-plum" />
              <Tile label="Average wait" value={mins(tot?.averageWaitMinutes)} />
              <Tile label="Walk-ins" value={tot?.walkIns ?? 0} />
              <Tile label="No-shows" value={tot?.noShows ?? 0} tone="text-rose" />
            </div>

            <section className="overflow-x-auto rounded-[24px] bg-white p-5 ring-1 ring-line">
              <h2 className="m-0 mb-3 text-base font-bold">By department</h2>
              {stats.byDepartment.length === 0 ? <p className="m-0 text-sm text-muted">No departments yet.</p> : (
                <table className="w-full min-w-[640px] border-collapse text-left text-sm">
                  <thead>
                    <tr className="text-muted">
                      {['Department', 'Seen', 'Booked', 'Walk-ins', 'No-shows', 'No-show rate', 'Avg wait', 'Avg visit'].map((h) => <th key={h} className="border-b border-line pb-2 pr-3 font-semibold">{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {stats.byDepartment.map((d) => (
                      <tr key={d.departmentId}>
                        <td className="border-b border-line py-3 pr-3 font-bold">{d.departmentName}</td>
                        <td className="border-b border-line py-3 pr-3">{d.patientsSeen}</td>
                        <td className="border-b border-line py-3 pr-3">{d.booked}</td>
                        <td className="border-b border-line py-3 pr-3">{d.walkIns}</td>
                        <td className="border-b border-line py-3 pr-3">{d.noShows}</td>
                        <td className="border-b border-line py-3 pr-3">{d.noShowRate == null ? '—' : `${d.noShowRate}%`}</td>
                        <td className="border-b border-line py-3 pr-3">{mins(d.averageWaitMinutes)}</td>
                        <td className="border-b border-line py-3 pr-3">{mins(d.averageVisitMinutes)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>

            <div className={`grid items-start gap-5 ${isSchool ? 'lg:grid-cols-[1fr_360px]' : ''}`}>
              <section className="rounded-[24px] bg-white p-5 ring-1 ring-line">
                <h2 className="m-0 text-base font-bold">Action log</h2>
                <p className="m-0 mb-3 mt-1 text-xs text-muted">Every action at the desk is recorded here and can’t be edited.</p>
                {log.length === 0 ? <p className="m-0 rounded-2xl border border-dashed border-line p-5 text-center text-sm text-muted">Nothing has happened yet today.</p> : (
                  <ul className="m-0 flex max-h-[520px] list-none flex-col divide-y divide-line overflow-y-auto p-0">
                    {log.map((e) => (
                      <li key={e.id} className="flex gap-3 py-2.5 text-sm">
                        <span className="w-16 shrink-0 font-semibold text-muted">{time(e.createdAt)}</span>
                        <span className="min-w-0 flex-1">
                          <b>{ACTION[e.action] ?? e.action.replaceAll('_', ' ')}</b>
                          {e.patientName && <> · {e.patientName}</>}
                          {e.reason && <span className="block text-muted">Reason: {e.reason}</span>}
                        </span>
                        <span className="shrink-0 text-xs text-muted">{e.staffName}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {isSchool && (
                <section className="rounded-[24px] bg-white p-5 ring-1 ring-line">
                  <h2 className="m-0 mb-3 text-base font-bold">Students who missed visits</h2>
                  {!students ? <div aria-hidden="true" className="h-24 animate-pulse rounded-2xl bg-[#efe7ec]" /> : students.length === 0 ? (
                    <p className="m-0 text-sm text-muted">No missed visits.</p>
                  ) : (
                    <ul className="m-0 flex list-none flex-col divide-y divide-line p-0">
                      {students.map((s) => (
                        <li key={s.name} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                          <b>{s.name}</b>
                          <span className="text-right">
                            {s.missCount} missed
                            {s.blockedUntil && <span className="block text-xs font-semibold text-rose">Can’t book until {new Date(s.blockedUntil).toLocaleDateString('en-GB')}</span>}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              )}
            </div>
          </>
        )}
      </div>
    </HospitalShell>
  )
}
