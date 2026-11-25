// Alert sounds for "your turn is close". All made in the browser (no sound files), original
// patterns in the style of Nigerian instruments: talking drum, agogo bell, shekere, highlife.

// ---- instruments ----
// Talking drum: a hit whose pitch slides down ("gan-gan" sound).
function talkingDrum(ctx, at, from = 240, to = 140, len = 0.35) {
  const o = ctx.createOscillator()
  const g = ctx.createGain()
  o.type = 'sine'
  o.frequency.setValueAtTime(from, at)
  o.frequency.exponentialRampToValueAtTime(to, at + len * 0.8)
  g.gain.setValueAtTime(0.0001, at)
  g.gain.exponentialRampToValueAtTime(0.5, at + 0.01)
  g.gain.exponentialRampToValueAtTime(0.0001, at + len)
  o.connect(g).connect(ctx.destination)
  o.start(at)
  o.stop(at + len + 0.05)
}
// Agogo: a bright metal bell (two partials, quick decay).
function agogo(ctx, at, freq = 1180, len = 0.25) {
  for (const [mult, vol] of [[1, 0.18], [2.7, 0.06]]) {
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    o.type = 'triangle'
    o.frequency.value = freq * mult
    g.gain.setValueAtTime(0.0001, at)
    g.gain.exponentialRampToValueAtTime(vol, at + 0.005)
    g.gain.exponentialRampToValueAtTime(0.0001, at + len)
    o.connect(g).connect(ctx.destination)
    o.start(at)
    o.stop(at + len + 0.05)
  }
}
// Shekere: a short burst of filtered noise (beads on a gourd).
function shekere(ctx, at, len = 0.09, vol = 0.25) {
  const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * len), ctx.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length)
  const src = ctx.createBufferSource()
  const hp = ctx.createBiquadFilter()
  const g = ctx.createGain()
  src.buffer = buf
  hp.type = 'highpass'
  hp.frequency.value = 5000
  g.gain.value = vol
  src.connect(hp).connect(g).connect(ctx.destination)
  src.start(at)
}
// Plucked note (highlife guitar).
function pluck(ctx, at, freq, len = 0.35) {
  const o = ctx.createOscillator()
  const g = ctx.createGain()
  o.type = 'triangle'
  o.frequency.value = freq
  g.gain.setValueAtTime(0.0001, at)
  g.gain.exponentialRampToValueAtTime(0.25, at + 0.008)
  g.gain.exponentialRampToValueAtTime(0.0001, at + len)
  o.connect(g).connect(ctx.destination)
  o.start(at)
  o.stop(at + len + 0.05)
}
function chimeNote(ctx, at, freq, len) {
  const o = ctx.createOscillator()
  const g = ctx.createGain()
  o.frequency.value = freq
  g.gain.setValueAtTime(0.0001, at)
  g.gain.exponentialRampToValueAtTime(0.22, at + 0.02)
  g.gain.exponentialRampToValueAtTime(0.0001, at + len)
  o.connect(g).connect(ctx.destination)
  o.start(at)
  o.stop(at + len + 0.05)
}

// ---- tones ----
export const TONES = {
  talkingDrum: {
    label: 'Talking drum',
    play: (ctx, t) => { talkingDrum(ctx, t, 260, 150); talkingDrum(ctx, t + 0.22, 200, 130); talkingDrum(ctx, t + 0.44, 300, 170, 0.5) },
  },
  agogo: {
    label: 'Agogo bell',
    play: (ctx, t) => { [[0, 1180], [0.18, 880], [0.36, 1180], [0.54, 1180], [0.72, 880]].forEach(([d, f]) => agogo(ctx, t + d, f)) },
  },
  shekere: {
    label: 'Shekere',
    play: (ctx, t) => { [0, 0.12, 0.24, 0.42, 0.54, 0.66].forEach((d, i) => shekere(ctx, t + d, i % 3 === 2 ? 0.14 : 0.08)) },
  },
  highlife: {
    label: 'Highlife guitar',
    play: (ctx, t) => { [[0, 392], [0.12, 494], [0.24, 587], [0.36, 784], [0.6, 659], [0.72, 784]].forEach(([d, f]) => pluck(ctx, t + d, f)) },
  },
  owambe: {
    label: 'Owambe',
    play: (ctx, t) => {
      talkingDrum(ctx, t, 220, 140); agogo(ctx, t, 1180)
      shekere(ctx, t + 0.15); talkingDrum(ctx, t + 0.3, 260, 160); agogo(ctx, t + 0.3, 880)
      shekere(ctx, t + 0.45); talkingDrum(ctx, t + 0.6, 220, 140); agogo(ctx, t + 0.6, 1180)
    },
  },
  chime: {
    label: 'Chime',
    play: (ctx, t) => { chimeNote(ctx, t, 660, 0.3); chimeNote(ctx, t + 0.18, 880, 0.35) },
  },
}

const KEY = 'oma_tone'
export const getTone = () => { try { const k = localStorage.getItem(KEY); return TONES[k] ? k : 'talkingDrum' } catch { return 'talkingDrum' } }
export const setTone = (name) => { try { localStorage.setItem(KEY, name) } catch { /* ignore */ } }

export function playTone(name = getTone()) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    ;(TONES[name] ?? TONES.chime).play(ctx, ctx.currentTime + 0.02)
    setTimeout(() => ctx.close(), 2500)
  } catch { /* sound not available */ }
}
