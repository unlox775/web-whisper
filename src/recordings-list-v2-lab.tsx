import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { RecordingsListV2 } from './components/RecordingsListV2'

document.title = 'Recordings List V2 Lab'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RecordingsListV2 />
  </StrictMode>,
)
