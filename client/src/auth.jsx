import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { api, getToken, setToken } from './api.js'
import { useT } from './i18n/index.jsx'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const { setLang } = useT()
  const [user, setUser] = useState(null)
  const [clinic, setClinic] = useState(null) // hospital accounts: { id, name, status }
  const [checking, setChecking] = useState(() => !!getToken())

  const refresh = useCallback(async () => {
    const d = await api('/auth/me')
    setUser(d.user)
    setClinic(d.clinic ?? null)
    return d
  }, [])

  useEffect(() => {
    if (!getToken()) return
    refresh()
      .catch(() => setToken(null))
      .finally(() => setChecking(false))
  }, [refresh])

  const accept = useCallback(
    (data) => {
      setToken(data.token)
      setUser(data.user)
      setClinic(data.clinic ?? null)
      if (data.user.language === 'en' || data.user.language === 'pcm') setLang(data.user.language)
      return data
    },
    [setLang],
  )

  // Patients: phone + PIN.
  const login = useCallback(async (phone, secret) => accept(await api('/auth/login', { method: 'POST', body: { phone, secret } })), [accept])
  const register = useCallback(async (body) => accept(await api('/auth/register', { method: 'POST', body })), [accept])
  // Hospitals, staff and admins: email + password.
  const workLogin = useCallback(async (email, password) => accept(await api('/auth/work-login', { method: 'POST', body: { email, password } })), [accept])
  const registerHospital = useCallback(async (body) => accept(await api('/hospitals/register', { method: 'POST', body })), [accept])
  const logout = useCallback(() => {
    setToken(null)
    setUser(null)
    setClinic(null)
  }, [])

  const value = useMemo(
    () => ({ user, clinic, checking, login, register, workLogin, registerHospital, refresh, logout }),
    [user, clinic, checking, login, register, workLogin, registerHospital, refresh, logout],
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export const useAuth = () => useContext(AuthContext)
