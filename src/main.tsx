import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ConvexAuthProvider } from '@convex-dev/auth/react'
import { ConvexReactClient } from 'convex/react'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import App from './App.tsx'

registerSW({
  immediate: true,
  onRegisteredSW: (_workerUrl, registration) => {
    if (!registration) return
    const update = () => void registration.update().catch(() => undefined)
    const interval = window.setInterval(update, 60 * 60 * 1_000)
    const updateWhenVisible = () => {
      if (document.visibilityState === 'visible') update()
    }
    document.addEventListener('visibilitychange', updateWhenVisible)
    window.addEventListener('pagehide', () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', updateWhenVisible)
    }, { once: true })
  },
})

const convexUrl = import.meta.env.VITE_CONVEX_URL?.trim()
const app = <App backendAvailable={Boolean(convexUrl)} />

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {convexUrl ? (
      <ConvexAuthProvider client={new ConvexReactClient(convexUrl)}>
        {app}
      </ConvexAuthProvider>
    ) : app}
  </StrictMode>,
)
