import { useState, type FormEvent } from 'react'
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
import { LiveWorkspace } from './LiveWorkspace'
import { PreviewWorkspace } from './PreviewWorkspace'
import './App.css'

type ExperienceMode = 'choose' | 'preview' | 'live'

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

  const chooseMode = (nextMode: ExperienceMode) => {
    setModeInUrl(nextMode)
    setMode(nextMode)
  }

  if (mode === 'preview') return <PreviewWorkspace onExit={() => chooseMode('choose')} />
  if (mode === 'live' && backendAvailable) return <LiveExperience onExit={() => chooseMode('choose')} />
  if (mode === 'live') return <BackendUnavailable onBack={() => chooseMode('choose')} />
  return <ModeChooser onChoose={chooseMode} backendAvailable={backendAvailable} />
}

function ModeChooser({
  onChoose,
  backendAvailable,
}: {
  onChoose: (mode: ExperienceMode) => void
  backendAvailable: boolean
}) {
  return (
    <main className="welcome-page">
      <section className="welcome-story">
        <div className="auth-brand"><span className="brand-mark">स</span> Saath</div>
        <div className="welcome-copy">
          <span className="eyebrow light">A calmer family inbox</span>
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
          <span className="eyebrow">Choose how to begin</span>
          <h2 id="mode-title">Welcome to Saath</h2>
          <p className="mode-intro">Explore safely with sample information, or open your private family workspace.</p>

          <button className="mode-card live-card" onClick={() => onChoose('live')} disabled={!backendAvailable}>
            <span className="mode-icon"><LockKeyhole size={25} /></span>
            <span className="mode-card-copy">
              <strong>Open my family workspace</strong>
              <small>Sign in with a secure code sent to your email. Your real family information appears here.</small>
              {!backendAvailable && <em>Live mode needs a connected Convex deployment.</em>}
            </span>
            <ArrowRight size={22} />
          </button>

          <button className="mode-card preview-card" onClick={() => onChoose('preview')}>
            <span className="mode-icon"><Eye size={25} /></span>
            <span className="mode-card-copy">
              <strong>Explore a guided preview</strong>
              <small>Replay a seeded family inbox. No sign-in, email, or personal information required.</small>
              <em>Sample data · nothing is sent</em>
            </span>
            <ArrowRight size={22} />
          </button>

          <p className="privacy-note"><ShieldCheck size={17} /> Preview and live information never mix.</p>
        </div>
      </section>
    </main>
  )
}

function LiveExperience({ onExit }: { onExit: () => void }) {
  const { isLoading, isAuthenticated } = useConvexAuth()

  if (isLoading) return <FullPageStatus message="Opening Saath securely…" />
  if (!isAuthenticated) return <EmailOtpSignIn onBack={onExit} />
  return <LiveWorkspace onExit={onExit} />
}

function EmailOtpSignIn({ onBack }: { onBack: () => void }) {
  const { signIn } = useAuthActions()
  const [step, setStep] = useState<'email' | 'code' | 'verifying'>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const requestCode = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await signIn('saath-email', { email: email.trim().toLowerCase() })
      setStep('code')
    } catch {
      setError('We could not send a code. Check the address and try again.')
    } finally {
      setBusy(false)
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
      <section className="live-auth-card">
        <div className="auth-brand dark"><span className="brand-mark">स</span> Saath</div>
        <span className="mode-badge live"><LockKeyhole size={15} /> Live workspace</span>
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
            <button className="primary large" type="submit" disabled={busy}>{busy ? 'Sending your code…' : 'Email me a code'} <ArrowRight size={20} /></button>
          </form>
        )}

        {step === 'code' && (
          <form onSubmit={verifyCode}>
            <label htmlFor="live-code">One-time code</label>
            <div className="field-with-icon"><KeyRound size={20} /><input id="live-code" className="otp-input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))} placeholder="000000" required autoFocus /></div>
            <button className="primary large" type="submit" disabled={busy || code.length !== 6}>{busy ? 'Checking code…' : 'Verify and continue'} <ArrowRight size={20} /></button>
            <button className="text-button" type="button" onClick={() => { setStep('email'); setCode(''); setError('') }}>Use a different email</button>
          </form>
        )}

        {step === 'verifying' && <div className="status-spinner" aria-label="Signing in" />}
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="security-note"><ShieldCheck size={18} /><span><strong>Private by design</strong>Your code expires after 10 minutes and can only be used once.</span></div>
      </section>
    </main>
  )
}

function BackendUnavailable({ onBack }: { onBack: () => void }) {
  return (
    <main className="centered-status">
      <LockKeyhole size={34} />
      <h1>Live mode is not connected</h1>
      <p>Set the browser-safe <code>VITE_CONVEX_URL</code> for this environment, then reload Saath.</p>
      <button className="secondary large" onClick={onBack}><ArrowLeft size={19} /> Back to choices</button>
    </main>
  )
}

function FullPageStatus({ message }: { message: string }) {
  return <main className="centered-status"><div className="status-spinner" /><p>{message}</p></main>
}
