// Colour theme chosen in Settings, remembered on this device and applied before the app draws.
export const THEMES = [
  { id: 'purple', colors: ['#5a2db0', '#8c1d52', '#f8faf1'] },
  { id: 'rose', colors: ['#8c1d52', '#5a2db0', '#f8faf1'] },
  { id: 'olive', colors: ['#56682c', '#8c1d52', '#f7f9ef'] },
  { id: 'ocean', colors: ['#0f6e7a', '#c8475a', '#f4f9f9'] },
]

export function currentTheme() {
  try { return localStorage.getItem('oma_theme') || 'purple' } catch { return 'purple' }
}

export function applyTheme(id) {
  if (id === 'purple') delete document.documentElement.dataset.theme
  else document.documentElement.dataset.theme = id
  try { localStorage.setItem('oma_theme', id) } catch { /* private mode */ }
}
