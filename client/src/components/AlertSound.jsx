import { useState } from 'react'
import { ALERT_LENGTHS, TONES, getAlertSeconds, getTone, playTone, setAlertSeconds, setTone } from '../lib/sounds.js'

// Settings card: which sound plays when your turn is close, and for how long.
export default function AlertSound({ t }) {
  const [tone, setToneState] = useState(getTone)
  const [secs, setSecs] = useState(getAlertSeconds)
  const lengthLabel = (n) => (n < 60 ? t('profile.secs').replace('{n}', n) : t('profile.mins').replace('{n}', n / 60))
  const chip = (on) => `min-h-11 cursor-pointer rounded-xl border-[1.5px] px-3 text-sm font-semibold ${on ? 'border-plum bg-plum text-white' : 'border-line bg-white text-ink hover:border-plum-soft'}`
  return (
    <section className="rounded-[24px] bg-white p-5 ring-1 ring-line sm:p-6">
      <h2 className="m-0 text-lg font-bold">{t('profile.tone')}</h2>
      <p className="mb-4 mt-1 text-sm text-muted">{t('profile.toneHelp')}</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {Object.entries(TONES).map(([key, v]) => (
          <button key={key} type="button" aria-pressed={tone === key} onClick={() => { setTone(key); setToneState(key); playTone(key) }}
            className={`${chip(tone === key)} flex items-center gap-1.5 text-left`}><span aria-hidden="true">♪</span>{v.label}</button>
        ))}
      </div>
      <h3 className="m-0 mt-5 text-sm font-semibold">{t('profile.playFor')}</h3>
      <div className="mt-2 flex flex-wrap gap-2">
        {ALERT_LENGTHS.map((n) => (
          <button key={n} type="button" aria-pressed={secs === n} onClick={() => { setAlertSeconds(n); setSecs(n) }} className={`${chip(secs === n)} min-w-[72px]`}>{lengthLabel(n)}</button>
        ))}
      </div>
    </section>
  )
}
