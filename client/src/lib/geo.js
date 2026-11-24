// The patient's position, only if they allow it. Kept for 30 minutes in this tab so we
// don't ask the browser again on every page.
const KEY = 'oma_pos'
const MAX_AGE = 30 * 60 * 1000

export function cachedPosition() {
  try {
    const p = JSON.parse(sessionStorage.getItem(KEY))
    return p && Date.now() - p.at < MAX_AGE ? p : null
  } catch {
    return null
  }
}

// Why location failed, so the screen can say something useful:
// 'insecure' (http link: browsers only share location with https sites), 'blocked'
// (the person or browser said no), or 'unavailable' (no signal / timed out / no GPS).
export function locationError(err) {
  if (!window.isSecureContext) return 'insecure'
  if (err?.code === 1) return 'blocked'
  return 'unavailable'
}

export function getPosition() {
  return new Promise((resolve, reject) => {
    if (!window.isSecureContext) return reject(Object.assign(new Error('insecure'), { code: 0 }))
    if (!navigator.geolocation) return reject(new Error('unsupported'))
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const p = { lat: pos.coords.latitude, lng: pos.coords.longitude, at: Date.now() }
        try { sessionStorage.setItem(KEY, JSON.stringify(p)) } catch { /* private mode */ }
        resolve(p)
      },
      (err) => reject(err),
      { enableHighAccuracy: false, timeout: 12000, maximumAge: 5 * 60 * 1000 },
    )
  })
}
