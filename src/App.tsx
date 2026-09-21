import { lazy, Suspense, useState, type FormEvent } from 'react'
import { useAuthActions, useConvexAuth } from '@convex-dev/auth/react'
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Eye,
  KeyRound,
  LockKeyhole,
  Mail,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'
import { PwaInstallCard, PwaInstallReminder } from './PwaInstallPrompt'
import { usePwaInstall, type PwaInstallController } from './usePwaInstall'
import { Badge } from './components/ui/badge'
import { Button } from './components/ui/button'
import { Card } from './components/ui/card'
import './App.css'

type ExperienceMode = 'choose' | 'preview' | 'live'

const PreviewWorkspace = lazy(() => import('./PreviewWorkspace').then(module => ({ default: module.PreviewWorkspace })))
const LiveWorkspace = lazy(() => import('./LiveWorkspace').then(module => ({ default: module.LiveWorkspace })))

function modeFromUrl(): ExperienceMode {
  const mode = new URLSearchParams(window.location.search).get('mode')
  return mode === 'preview' || mode === 'live' ? mode : 'choose'
}

function setModeInUrl(mode: ExperienceMode) {
  const url = new URL(window.location.href)
  if (mode === 'choose') url.searchParams.delete('mode')
  else url.searchParams.set('mode', mode)
  window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`)
}

export default function App({ backendAvailable }: { backendAvailable: boolean }) {
  const [mode, setMode] = useState<ExperienceMode>(modeFromUrl)
  const pwaInstall = usePwaInstall()

  const chooseMode = (nextMode: ExperienceMode) => {
    setModeInUrl(nextMode)
    setMode(nextMode)
  }

  if (mode === 'preview') return <Suspense fallback={<FullPageStatus message="Opening the guided preview…" />}><PreviewWorkspace onExit={() => chooseMode('choose')} /></Suspense>
  if (mode === 'live' && backendAvailable) return <LiveExperience onExit={() => chooseMode('choose')} pwaInstall={pwaInstall} />
  if (mode === 'live') return <BackendUnavailable onBack={() => chooseMode('choose')} />
  return <ModeChooser onChoose={chooseMode} backendAvailable={backendAvailable} pwaInstall={pwaInstall} />
}

function ModeChooser({
  onChoose,
  backendAvailable,
  pwaInstall,
}: {
  onChoose: (mode: ExperienceMode) => void
  backendAvailable: boolean
  pwaInstall: PwaInstallController
}) {
  return (
    <main className="welcome-page">
      <section className="welcome-story">
        <div className="auth-brand"><span className="brand-mark">स</span> Saath</div>
        <div className="welcome-copy">
          <h1>Keep the whole family in the loop.</h1>
          <p>Bills, school notes, travel plans, and family conversations—understood in the language each person prefers.</p>
          <div className="trust-list">
            <span><ShieldCheck size={19} /> Private family spaces</span>
            <span><Check size={19} /> You approve anything sent</span>
            <span><Sparkles size={19} /> Saathi helps when asked</span>
          </div>
        </div>
        <div className="language-line"><span>नमस्ते</span><span>•</span><span>Hello</span><span>•</span><span>नमस्कार</span></div>
      </section>

      <section className="mode-panel" aria-labelledby="mode-title">
        <div className="mode-picker">
          <h2 id="mode-title">Welcome to Saath</h2>
          <p className="mode-intro">Explore safely with sample information, or open your private family workspace.</p>

          <PwaInstallCard controller={pwaInstall} />

          <Button variant="outline" className="mode-card live-card" onClick={() => onChoose('live')} disabled={!backendAvailable}>
            <span className="mode-icon"><LockKeyhole size={25} /></span>
            <span className="mode-card-copy">
              <strong>Open my family workspace</strong>
              <small>Sign in with a secure code sent to your email. Your real family information appears here.</small>
              {!backendAvailable && <em>The live workspace is still being set up on this site.</em>}
            </span>
            <ArrowRight size={22} />
          </Button>

          <Button variant="outline" className="mode-card preview-card" onClick={() => onChoose('preview')}>
            <span className="mode-icon"><Eye size={25} /></span>
            <span className="mode-card-copy">
              <strong>Explore a guided preview</strong>
              <small>Replay a seeded family inbox. No sign-in, email, or personal information required.</small>
              <em>Sample data · nothing is sent</em>
            </span>
            <ArrowRight size={22} />
          </Button>

          <p className="privacy-note"><ShieldCheck size={17} /> Preview and live information never mix.</p>
        </div>
      </section>
    </main>
  )
}

function LiveExperience({ onExit, pwaInstall }: { onExit: () => void; pwaInstall: PwaInstallController }) {
  const { isLoading, isAuthenticated } = useConvexAuth()

  if (isLoading) return <FullPageStatus message="Opening Saath securely…" />
  if (!isAuthenticated) return <EmailOtpSignIn onBack={onExit} />
  return <>
    <Suspense fallback={<FullPageStatus message="Opening your family space…" />}><LiveWorkspace onExit={onExit} /></Suspense>
    <PwaInstallReminder controller={pwaInstall} />
  </>
}

function EmailOtpSignIn({ onBack }: { onBack: () => void }) {
  const { signIn } = useAuthActions()
  const [step, setStep] = useState<'email' | 'code' | 'verifying'>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [resending, setResending] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const sendCode = async () => {
    await signIn('saath-email', { email: email.trim().toLowerCase() })
    setStep('code')
  }

  const requestCode = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await sendCode()
    } catch (requestError) {
      setError(otpRequestErrorMessage(requestError))
    } finally {
      setBusy(false)
    }
  }

  const resendCode = async () => {
    setResending(true)
    setError('')
    setNotice('')
    setCode('')
    try {
      await sendCode()
      setNotice('A new code is on its way. The previous one will no longer work.')
    } catch (requestError) {
      setError(otpRequestErrorMessage(requestError))
    } finally {
      setResending(false)
    }
  }

  const verifyCode = async (event: FormEvent) => {
    event.preventDefault()
    if (code.length !== 6) return
    setBusy(true)
    setError('')
    try {
      const result = await signIn('saath-email', { email: email.trim().toLowerCase(), code })
      if (!result.signingIn) throw new Error('Sign-in was not completed')
      setStep('verifying')
    } catch {
      setError('That code is incorrect or expired. Request a new code and try again.')
      setBusy(false)
    }
  }

  return (
    <main className="live-auth-page">
      <button className="back-link" onClick={onBack}><ArrowLeft size={19} /> Back</button>
      <Card className="live-auth-card">
        <div className="auth-brand dark"><span className="brand-mark">स</span> Saath</div>
        <Badge className="mode-badge live"><LockKeyhole size={15} /> Live workspace</Badge>
        <h1>{step === 'email' ? 'Sign in with your email' : step === 'code' ? 'Enter your six-digit code' : 'Opening your family space'}</h1>
        <p>{step === 'email'
          ? 'We’ll email you a one-time code. There is no password to remember.'
          : step === 'code'
            ? `We sent a sign-in code to ${email}.`
            : 'Your code is verified. This may take a moment.'}</p>

        {step === 'email' && (
          <form onSubmit={requestCode}>
            <label htmlFor="live-email">Email address</label>
            <div className="field-with-icon"><Mail size={20} /><input id="live-email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" required autoFocus /></div>
            <Button className="primary large" type="submit" disabled={busy}>{busy ? 'Sending your code…' : 'Email me a code'} <ArrowRight size={20} /></Button>
          </form>
        )}

        {step === 'code' && (
          <form onSubmit={verifyCode}>
            <label htmlFor="live-code">One-time code</label>
            <div className="field-with-icon"><KeyRound size={20} /><input id="live-code" className="otp-input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))} placeholder="000000" required autoFocus /></div>
            <Button className="primary large" type="submit" disabled={busy || resending || code.length !== 6}>{busy ? 'Checking code…' : 'Verify and continue'} <ArrowRight size={20} /></Button>
            <button className="text-button" type="button" onClick={() => void resendCode()} disabled={busy || resending}>{resending ? 'Sending a new code…' : 'Request a new code'}</button>
            <button className="text-button" type="button" onClick={() => { setStep('email'); setCode(''); setError(''); setNotice('') }} disabled={busy || resending}>Use a different email</button>
          </form>
        )}

        {step === 'verifying' && <div className="status-spinner" aria-label="Signing in" />}
        {notice && !error && <p className="form-notice" role="status">{notice}</p>}
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="security-note"><ShieldCheck size={18} /><span><strong>Private by design</strong>Your code expires after 10 minutes and can only be used once.</span></div>
      </Card>
    </main>
  )
}

function BackendUnavailable({ onBack }: { onBack: () => void }) {
  return (
    <main className="centered-status">
      <LockKeyhole size={34} />
      <h1>Saath needs a quick setup</h1>
      <p>This family workspace is not connected yet. Ask the person who set up Saath to finish the connection, then reload this page.</p>
      <details className="status-details">
        <summary>Setup details</summary>
        <p>Set the browser-safe <code>VITE_CONVEX_URL</code> for this environment.</p>
      </details>
      <button className="secondary large" onClick={onBack}><ArrowLeft size={19} /> Back to choices</button>
    </main>
  )
}

function FullPageStatus({ message }: { message: string }) {
  return <main className="centered-status"><div className="status-spinner" /><p>{message}</p></main>
}

function otpRequestErrorMessage(error: unknown) {
  const data = typeof error === 'object' && error !== null && 'data' in error
    ? (error as { data?: unknown }).data
    : null
  if (typeof data !== 'object' || data === null || !('kind' in data)) {
    return 'We could not send a code. Please try again in a moment.'
  }
  const kind = (data as { kind?: unknown }).kind
  if (kind === 'OtpRateLimited') return 'Too many code requests. Please wait before trying again.'
  if (kind === 'OtpConfigurationMissing') return 'Email sign-in is not configured yet.'
  if (kind === 'OtpDeliveryRejected') {
    const status = (data as { status?: unknown }).status
    return `AgentMail rejected the sign-in email${typeof status === 'number' ? ` (status ${status})` : ''}.`
  }
  return 'We could not send a code. Please try again in a moment.'
}
