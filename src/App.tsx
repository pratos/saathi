import { lazy, Suspense, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { useAuthActions, useConvexAuth } from '@convex-dev/auth/react'
import { LazyMotion, domAnimation, m, useReducedMotion } from 'motion/react'
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
import { Input } from './components/ui/input'
import { Label } from './components/ui/label'
import { Spinner } from './components/ui/spinner'
import './App.css'

type ExperienceMode = 'choose' | 'preview' | 'live'

const PreviewWorkspace = lazy(() => import('./PreviewWorkspace').then(module => ({ default: module.PreviewWorkspace })))
const LiveWorkspace = lazy(() => import('./LiveWorkspace').then(module => ({ default: module.LiveWorkspace })))
const AgentSignalField = lazy(() => import('./components/visuals/agent-signal-field').then(module => ({ default: module.AgentSignalField })))

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

  if (mode === 'preview') return <Suspense fallback={<FullPageStatus message="Opening the guided preview…" />}><PreviewWorkspace onExit={() => chooseMode('choose')} onOpenLive={() => chooseMode('live')} /></Suspense>
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
  const reduceMotion = useReducedMotion()
  const showShader = useDesktopShader()
  const enter = reduceMotion ? {} : { opacity: 1, y: 0 }
  const initial = reduceMotion ? false : { opacity: 0, y: 14 }

  return (
    <LazyMotion features={domAnimation} strict>
      <main className="relative min-h-dvh overflow-hidden bg-[#e8edef] text-[#11222d] lg:grid lg:grid-cols-[minmax(360px,34%)_minmax(0,1fr)]">
        <section className="relative flex min-h-[320px] flex-col overflow-hidden bg-[#07151e] p-5 text-white lg:min-h-dvh lg:p-[clamp(28px,3.4vw,52px)]">
          {showShader && <div className="pointer-events-none absolute inset-0 opacity-80"><Suspense fallback={null}><AgentSignalField /></Suspense></div>}
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(255,255,255,.045)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.045)_1px,transparent_1px)] bg-[size:36px_36px] [mask-image:linear-gradient(to_bottom_right,#000,transparent_76%)]" />

          <m.div className="relative flex items-center gap-2.5 text-[17px] font-bold tracking-[-.02em]" initial={initial} animate={enter} transition={{ duration: .42 }}>
            <span className="grid size-9 place-items-center rounded-[3px] bg-[#61d6bd] text-lg font-extrabold text-[#092c27]">स</span>
            Saathi
          </m.div>

          <m.div className="relative mt-10 lg:my-auto lg:mt-0" initial={initial} animate={enter} transition={{ duration: .5, delay: .08 }}>
            <Badge className="mb-3 rounded-[3px] border-[#36505e] bg-[#102631]/70 px-2 py-1 font-mono text-[9px] font-bold tracking-[.1em] text-[#78dec8]">SAATHI / FAMILY AGENT</Badge>
            <h1 className="max-w-[500px] text-[clamp(36px,3.6vw,52px)] leading-[1.01] font-[720] tracking-[-.055em] text-[#f7fafb]">Keep the whole family in the loop.</h1>
            <p className="mt-4 max-w-[470px] text-[15px] leading-[1.5] text-[#b5c1c8]">Bills, school notes, travel plans, and family conversations—understood in the language each person prefers.</p>
            <div className="mt-6 hidden grid-cols-3 gap-px overflow-hidden rounded-[3px] border border-[#2c3e49] bg-[#2c3e49] lg:grid">
              {[[ShieldCheck, 'Private family spaces'], [Check, 'You approve anything sent'], [Sparkles, 'Saathi helps when asked']].map(([Icon, label]) => {
                const TrustIcon = Icon as typeof ShieldCheck
                return <span className="flex min-h-16 flex-col items-start gap-2 bg-[#10232d]/90 p-2.5 text-[11px] leading-snug text-[#d6dfe3]" key={label as string}><TrustIcon size={18} className="text-[#61d6bd]" />{label as string}</span>
              })}
            </div>
          </m.div>

          <m.div className="relative mt-auto hidden gap-2 font-mono text-[10px] tracking-[.06em] text-[#718692] lg:flex" initial={initial} animate={enter} transition={{ duration: .45, delay: .18 }}><span>नमस्ते</span><span>·</span><span>Hello</span><span>·</span><span>नमस्कार</span></m.div>
        </section>

        <section className="flex items-center p-3.5 py-7 sm:p-8 lg:p-[clamp(28px,4.5vw,72px)]" aria-labelledby="mode-title">
          <m.div className="mx-auto grid w-full max-w-[820px] gap-2" initial={initial} animate={enter} transition={{ duration: .48, delay: .12 }}>
            <span className="font-mono text-[10px] font-bold tracking-[.12em] text-[#397064]">WORKSPACE ACCESS</span>
            <h2 id="mode-title" className="text-[clamp(32px,3.2vw,44px)] leading-[1.05] font-[730] tracking-[-.045em]">Welcome to Saathi</h2>
            <p className="mb-3 max-w-[560px] text-sm leading-relaxed text-[#61707a]">Explore safely with sample information, or open your private family workspace.</p>

            <PwaInstallCard controller={pwaInstall} />

            <div className="grid gap-2 md:grid-cols-2">
              <ExperienceCard
                icon={<LockKeyhole size={22} />}
                title="Open my family workspace"
                description="Sign in with a secure code sent to your email. Your authorized family information appears here."
                detail={!backendAvailable ? 'The live workspace is still being set up on this site.' : 'Private data · secure sign-in'}
                tone="live"
                disabled={!backendAvailable}
                onClick={() => onChoose('live')}
                reduceMotion={Boolean(reduceMotion)}
              />
              <ExperienceCard
                icon={<Eye size={22} />}
                title="Explore a guided preview"
                description="Complete a seeded family workflow. No sign-in, email, or personal information required."
                detail="Sample data · nothing is sent"
                tone="preview"
                onClick={() => onChoose('preview')}
                reduceMotion={Boolean(reduceMotion)}
              />
            </div>

            <p className="mt-3 flex items-center gap-2 text-xs text-[#61707a]"><ShieldCheck size={16} /> Preview and live information never mix.</p>
          </m.div>
        </section>
      </main>
    </LazyMotion>
  )
}

function ExperienceCard({ icon, title, description, detail, tone, disabled, onClick, reduceMotion }: {
  icon: ReactNode
  title: string
  description: string
  detail: string
  tone: 'live' | 'preview'
  disabled?: boolean
  onClick: () => void
  reduceMotion: boolean
}) {
  const live = tone === 'live'
  return <m.div whileHover={reduceMotion || disabled ? undefined : { y: -3 }} whileTap={reduceMotion || disabled ? undefined : { scale: .99 }} transition={{ type: 'spring', stiffness: 420, damping: 30 }}>
    <Card className={`h-full overflow-hidden rounded-[4px] border shadow-none ${live ? 'border-[#152630] bg-[#152630] text-white' : 'border-[#cbd4d9] bg-white text-[#14212b]'}`}>
      <Button type="button" variant="ghost" disabled={disabled} onClick={onClick} className="experience-card-button group grid h-full min-h-[142px] w-full grid-cols-[42px_minmax(0,1fr)_18px] content-start items-start gap-3 rounded-none p-4 text-left whitespace-normal hover:bg-transparent">
        <span className={`grid size-[42px] place-items-center rounded-[3px] ${live ? 'bg-[#61d6bd] text-[#092c27]' : 'bg-[#dcecff] text-[#224c79]'}`}>{icon}</span>
        <span className="grid gap-1.5 pt-0.5">
          <strong className={`text-[15px] leading-tight font-bold ${live ? 'text-white' : 'text-[#14212b]'}`}>{title}</strong>
          <small className={`text-xs leading-[1.45] font-normal ${live ? 'text-[#b9c5cb]' : 'text-[#61707a]'}`}>{description}</small>
          <em className={`mt-1 font-mono text-[9px] font-bold tracking-[.04em] not-italic ${live ? 'text-[#74d9c4]' : 'text-[#397064]'}`}>{detail}</em>
        </span>
        <ArrowRight className={`mt-1 size-4 transition-transform group-hover:translate-x-0.5 ${live ? 'text-[#74d9c4]' : 'text-[#397064]'}`} />
      </Button>
    </Card>
  </m.div>
}

function useDesktopShader() {
  const [enabled, setEnabled] = useState(false)

  useEffect(() => {
    const media = window.matchMedia('(min-width: 1024px) and (prefers-reduced-motion: no-preference)')
    const update = () => setEnabled(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  return enabled
}

function LiveExperience({ onExit, pwaInstall }: { onExit: () => void; pwaInstall: PwaInstallController }) {
  const { isLoading, isAuthenticated } = useConvexAuth()

  if (isLoading) return <FullPageStatus message="Opening Saathi securely…" />
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
      <Button variant="bare" size="content" className="back-link" onClick={onBack}><ArrowLeft size={19} /> Back</Button>
      <Card className="live-auth-card gap-0">
        <div className="auth-brand dark"><span className="brand-mark">स</span> Saathi</div>
        <Badge className="mode-badge live"><LockKeyhole size={15} /> Live workspace</Badge>
        <h1>{step === 'email' ? 'Sign in with your email' : step === 'code' ? 'Enter your six-digit code' : 'Opening your family space'}</h1>
        <p>{step === 'email'
          ? 'We’ll email you a one-time code. There is no password to remember.'
          : step === 'code'
            ? `We sent a sign-in code to ${email}.`
            : 'Your code is verified. This may take a moment.'}</p>

        {step === 'email' && (
          <form onSubmit={requestCode}>
            <Label htmlFor="live-email">Email address</Label>
            <div className="field-with-icon"><Mail size={20} /><Input className="h-full border-0 bg-transparent px-0 shadow-none focus-visible:ring-0" id="live-email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" required autoFocus /></div>
            <Button className="primary large" type="submit" disabled={busy}>{busy ? 'Sending your code…' : 'Email me a code'} <ArrowRight size={20} /></Button>
          </form>
        )}

        {step === 'code' && (
          <form onSubmit={verifyCode}>
            <Label htmlFor="live-code">One-time code</Label>
            <div className="field-with-icon"><KeyRound size={20} /><Input id="live-code" className="otp-input h-full border-0 bg-transparent px-0 shadow-none focus-visible:ring-0" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))} placeholder="000000" required autoFocus /></div>
            <Button className="primary large" type="submit" disabled={busy || resending || code.length !== 6}>{busy ? 'Checking code…' : 'Verify and continue'} <ArrowRight size={20} /></Button>
            <Button variant="link" className="text-button" type="button" onClick={() => void resendCode()} disabled={busy || resending}>{resending ? 'Sending a new code…' : 'Request a new code'}</Button>
            <Button variant="link" className="text-button" type="button" onClick={() => { setStep('email'); setCode(''); setError(''); setNotice('') }} disabled={busy || resending}>Use a different email</Button>
          </form>
        )}

        {step === 'verifying' && <Spinner className="mx-auto my-7 size-8 text-primary" aria-label="Signing in" />}
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
      <h1>Saathi needs a quick setup</h1>
      <p>This family workspace is not connected yet. Ask the person who set up Saathi to finish the connection, then reload this page.</p>
      <details className="status-details">
        <summary>Setup details</summary>
        <p>Set the browser-safe <code>VITE_CONVEX_URL</code> for this environment.</p>
      </details>
      <Button variant="secondary" size="lg" className="secondary large" onClick={onBack}><ArrowLeft size={19} /> Back to choices</Button>
    </main>
  )
}

function FullPageStatus({ message }: { message: string }) {
  return <main className="centered-status"><Spinner className="size-8 text-primary" /><p>{message}</p></main>
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
