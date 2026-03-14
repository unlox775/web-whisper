import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import App from './App.tsx'
import { markStartupMilestone } from './modules/logging/startup-milestones'

document.title = 'Web Whisper'
markStartupMilestone('main.tsx: first execution')

registerSW({ immediate: true })
markStartupMilestone('main.tsx: registerSW called')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
