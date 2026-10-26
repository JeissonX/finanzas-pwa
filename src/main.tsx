import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

const container = document.getElementById('root')!
createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
