// When to alert: when N people are ahead (saved on the account, default 2), or N minutes before
// the estimated start (saved on this device).
const KEY = 'oma_alert_mode'
export const ALERT_MINUTES = [10, 15, 20, 30, 45, 60]
export function getAlertMode() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || 'null')
    if (v?.mode === 'minutes' && ALERT_MINUTES.includes(v.minutes)) return v
  } catch { /* ignore */ }
  return { mode: 'people', minutes: 20 }
}
export function setAlertMode(v) { try { localStorage.setItem(KEY, JSON.stringify(v)) } catch { /* ignore */ } }

// Is it time to alert for this live visit?
export function isTurnClose(visit) {
  if (!visit?.queue || visit.status === 'called') return false
  const pref = getAlertMode()
  return pref.mode === 'minutes' ? visit.queue.waitMinutes <= pref.minutes : visit.queue.alertNow
}
