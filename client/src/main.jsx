import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import { applyTheme, currentTheme } from './lib/theme.js'

applyTheme(currentTheme())
import App from './App.jsx'
import { LanguageProvider } from './i18n/index.jsx'
import { AuthProvider } from './auth.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <LanguageProvider>
        <AuthProvider>
          <App />
        </AuthProvider>
      </LanguageProvider>
    </BrowserRouter>
  </StrictMode>,
)
