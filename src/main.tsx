import '@fontsource/rajdhani/400.css'
import '@fontsource/rajdhani/500.css'
import '@fontsource/rajdhani/600.css'
import '@fontsource/rajdhani/700.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles.css'
import { munusConfig } from './config'
import { configureNimRateFetcher } from './hooks/useNimRate'
import { createPublicNimRateFetcher } from './persistence/publicRates'

// Global market data starts loading at application bootstrap — before
// session restore, wallet readiness, balances, profiles, and routes.
// The rate loop is independent of all of them and shared by every
// surface; Home and Pay subscribe to the same store instance.
configureNimRateFetcher(createPublicNimRateFetcher(munusConfig.apiBaseUrl))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
