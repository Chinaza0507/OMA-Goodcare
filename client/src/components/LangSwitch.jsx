import { LANGUAGES, useT } from '../i18n/index.jsx'

export default function LangSwitch({ className = '' }) {
  const { lang, setLang } = useT()
  return (
    <div className={`inline-flex rounded-full border border-line bg-white p-1 text-sm font-semibold ${className}`} role="group" aria-label="Language">
      {Object.entries(LANGUAGES).map(([code, l]) => (
        <button
          key={code}
          type="button"
          aria-pressed={lang === code}
          onClick={() => setLang(code)}
          className={`min-h-9 rounded-full px-3 ${lang === code ? 'bg-plum text-white' : 'text-muted hover:bg-blush'}`}
        >
          {l.langName}
        </button>
      ))}
    </div>
  )
}
