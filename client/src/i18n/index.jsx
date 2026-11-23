import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import en from './en.js'
import pcm from './pcm.js'

export const LANGUAGES = { en, pcm }
const LanguageContext = createContext(null)

const lookup = (dict, path) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), dict)

export function LanguageProvider({ children }) {
  const [lang, setLangState] = useState(() => {
    try {
      const saved = localStorage.getItem('oma_lang')
      return saved in LANGUAGES ? saved : 'en'
    } catch {
      return 'en'
    }
  })

  const setLang = useCallback((l) => {
    if (!(l in LANGUAGES)) return
    setLangState(l)
    document.documentElement.lang = l === 'pcm' ? 'pcm' : l
    try { localStorage.setItem('oma_lang', l) } catch { /* private mode: ignore */ }
  }, [])

  // Falls back to English so a missing translation never shows a blank.
  const t = useCallback((path) => lookup(LANGUAGES[lang], path) ?? lookup(en, path) ?? path, [lang])
  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t])
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
}

export const useT = () => useContext(LanguageContext)
