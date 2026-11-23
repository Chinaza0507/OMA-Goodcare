// Small fetch wrapper. Errors always carry the server's error code so the screen can
// show it in the user's language.
export class ApiError extends Error {
  constructor(code, status) {
    super(code)
    this.code = code
    this.status = status
  }
}

export const getToken = () => {
  try { return localStorage.getItem('oma_token') } catch { return null }
}
export const setToken = (token) => {
  try {
    if (token) localStorage.setItem('oma_token', token)
    else localStorage.removeItem('oma_token')
  } catch { /* ignore */ }
}

export async function api(path, { method = 'GET', body } = {}) {
  const token = getToken()
  let res
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new ApiError('network', 0)
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new ApiError(data.error || 'server_error', res.status)
  return data
}
