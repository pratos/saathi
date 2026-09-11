import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ConvexAuthProvider } from '@convex-dev/auth/react'
import { ConvexReactClient } from 'convex/react'
import './index.css'
import App from './App.tsx'

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
