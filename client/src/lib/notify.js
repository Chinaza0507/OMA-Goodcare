// Phone/browser notifications for "your turn is close" and "it's your turn".
// The person turns them on in Profile; the browser then asks for permission once.
const KEY = 'oma_notify'
const supported = () => typeof window !== 'undefined' && 'Notification' in window

// 'on' | 'off' | 'blocked' (the browser said no) | 'unsupported'
export function notifyState() {
  if (!supported()) return 'unsupported'
  if (Notification.permission === 'denied') return 'blocked'
  let pref = null
  try { pref = localStorage.getItem(KEY) } catch { /* ignore */ }
  return Notification.permission === 'granted' && pref !== 'off' ? 'on' : 'off'
}

export async function setNotify(on) {
  if (!supported()) return 'unsupported'
  try { localStorage.setItem(KEY, on ? 'on' : 'off') } catch { /* ignore */ }
  if (on && Notification.permission === 'default') await Notification.requestPermission()
  return notifyState()
}

export function showNotification(title, body) {
  if (notifyState() !== 'on') return
  try { new Notification(title, { body, icon: '/favicon.svg', tag: 'oma-queue' }) } catch { /* some phones need a service worker */ }
}

// Live queue updates: one notification that keeps being replaced with your latest place in line.
const LIVE = 'oma_live_notify'
export const liveState = () => { try { return localStorage.getItem(LIVE) === 'on' } catch { return false } }
export const setLive = (on) => { try { localStorage.setItem(LIVE, on ? 'on' : 'off') } catch { /* ignore */ } }
export function showLive(title, body) {
  if (!liveState() || notifyState() !== 'on') return
  try { new Notification(title, { body, icon: '/favicon.svg', tag: 'oma-live', silent: true }) } catch { /* ignore */ }
}
