import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import SkiPinDashboard from './App'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <SkiPinDashboard />
  </StrictMode>,
)
