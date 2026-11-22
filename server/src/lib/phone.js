// Accepts 080..., +23480..., 23480... and returns +23480XXXXXXXX, or null if invalid.
export function normalizePhone(input) {
  let s = String(input ?? '').replace(/[\s\-()]/g, '')
  if (s.startsWith('+')) s = s.slice(1)
  if (s.startsWith('234')) s = s.slice(3)
  else if (s.startsWith('0')) s = s.slice(1)
  return /^[789]\d{9}$/.test(s) ? `+234${s}` : null
}

export const firstName = (name) => String(name).trim().split(/\s+/)[0]
