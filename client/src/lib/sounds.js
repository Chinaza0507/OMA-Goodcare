// Alert sounds for "your turn is close". Made in the browser (no sound files to download).
// Each tone is a list of [frequency Hz, start seconds, length seconds].
export const TONES = {
  chime: { label: 'Chime', notes: [[660, 0, 0.3], [880, 0.18, 0.35]] },
  bell: { label: 'Bell', notes: [[988, 0, 0.9], [1319, 0, 0.6]] },
  marimba: { label: 'Marimba', notes: [[523, 0, 0.2], [659, 0.15, 0.2], [784, 0.3, 0.3]] },
  pulse: { label: 'Pulse', notes: [[740, 0, 0.12], [740, 0.2, 0.12], [740, 0.4, 0.12]] },
  soft: { label: 'Soft', notes: [[440, 0, 0.5], [554, 0.25, 0.6]] },
}
const KEY = 'oma_tone'
export const getTone = () => { try { return TONES[localStorage.getItem(KEY)] ? localStorage.getItem(KEY) : 'chime' } catch { return 'chime' } }
export const setTone = (name) => { try { localStorage.setItem(KEY, name) } catch { /* ignore */ } }

export function playTone(name = getTone()) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    for (const [freq, start, len] of (TONES[name] ?? TONES.chime).notes) {
      const o = ctx.createOscillator()
      const g = ctx.createGain()
      o.type = name === 'bell' ? 'triangle' : 'sine'
      o.frequency.value = freq
      const t0 = ctx.currentTime + start
      g.gain.setValueAtTime(0.0001, t0)
      g.gain.exponentialRampToValueAtTime(0.22, t0 + 0.02)
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + len)
      o.connect(g).connect(ctx.destination)
      o.start(t0)
      o.stop(t0 + len + 0.05)
    }
  } catch { /* sound not available */ }
}
