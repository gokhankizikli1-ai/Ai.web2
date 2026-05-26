import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router'
import { AppProvider } from '@/contexts/AppContext'
import { ThemeProvider } from '@/contexts/ThemeContext'
import './index.css'
import App from './App.tsx'

const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''))
if (hashParams.get('id_token')) {
  window.history.replaceState(
    null,
    '',
    `${window.location.pathname}${window.location.search}#/login?${window.location.hash.replace(/^#/, '')}`,
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <ThemeProvider>
        <AppProvider>
          <App />
        </AppProvider>
      </ThemeProvider>
    </HashRouter>
  </StrictMode>,
)
