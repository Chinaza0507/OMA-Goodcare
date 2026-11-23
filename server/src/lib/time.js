// Nigeria is on WAT (UTC+1) all year with no daylight saving.
const TZ = 'Africa/Lagos'

export const todayLagos = (now = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(now) // YYYY-MM-DD

export function nowMinutesLagos(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(now)
  const [h, m] = parts.split(':').map(Number)
  return h * 60 + m
}

export const toMinutes = (time) => {
  const [h, m] = time.split(':')
  return Number(h) * 60 + Number(m)
}

export const fromMinutes = (n) =>
  `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`

// The exact moment a date + local slot time happens.
export const slotInstant = (date, time) => new Date(`${date}T${time.slice(0, 5)}:00+01:00`)

export const addDays = (date, days) => {
  const d = new Date(`${date}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

// Every slot start time ('HH:MM') that fits between opening and closing.
export function generateSlots(opensAt, closesAt, slotMinutes) {
  const slots = []
  const close = toMinutes(closesAt)
  for (let t = toMinutes(opensAt); t + slotMinutes <= close; t += slotMinutes) {
    slots.push(fromMinutes(t))
  }
  return slots
}
