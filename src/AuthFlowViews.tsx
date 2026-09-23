import type { FormEvent, ReactNode } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  KeyRound,
  LockKeyhole,
  LogOut,
  Mail,
  MessageSquareText,
  ShieldCheck,
} from 'lucide-react'
import { Badge } from './components/ui/badge'
import { Button } from './components/ui/button'
import { Card } from './components/ui/card'
import { Input } from './components/ui/input'
import { Label } from './components/ui/label'
import { Spinner } from './components/ui/spinner'

export type EmailOtpStep = 'email' | 'code' | 'verifying'

export function EmailOtpSignInView({ step, email, code, busy, resending, error, notice, onEmailChange, onCodeChange, onRequestCode, onVerifyCode, onResendCode, onUseDifferentEmail, onBack, previewNote }: {
  step: EmailOtpStep
  email: string
  code: string
  busy: boolean
  resending: boolean
  error?: string
  notice?: string
  onEmailChange: (value: string) => void
  onCodeChange: (value: string) => void
  onRequestCode: (event: FormEvent) => void
  onVerifyCode: (event: FormEvent) => void
  onResendCode: () => void
  onUseDifferentEmail: () => void
  onBack: () => void
  previewNote?: ReactNode
}) {
  return <main className="live-auth-page email-otp-auth">
    <Button variant="bare" size="content" className="back-link" onClick={onBack}><ArrowLeft size={19} /> Back</Button>
    <Card className="live-auth-card gap-0">
      <div className="auth-card-top">
        <div className="auth-brand dark"><span className="brand-mark">स</span> Saathi</div>
        <Badge className="mode-badge live"><LockKeyhole size={15} /> Live workspace</Badge>
      </div>
      <h1>{step === 'email' ? 'Sign in with your email' : step === 'code' ? 'Enter your six-digit code' : 'Opening your family space'}</h1>
      <p>{step === 'email'
        ? 'We’ll email you a one-time code. There is no password to remember.'
        : step === 'code'
          ? `We sent a sign-in code to ${email}.`
          : 'Your code is verified. This may take a moment.'}</p>

      {step === 'email' && <form onSubmit={onRequestCode}>
        <Label htmlFor="live-email">Email address</Label>
        <div className="field-with-icon"><Mail size={20} /><Input className="h-full border-0 bg-transparent px-0 shadow-none focus-visible:ring-0" id="live-email" type="email" autoComplete="email" value={email} onChange={event => onEmailChange(event.target.value)} placeholder="you@example.com" required autoFocus /></div>
        <Button className="primary large" type="submit" disabled={busy}>{busy ? 'Sending your code…' : 'Email me a code'} <ArrowRight size={20} /></Button>
      </form>}

      {step === 'code' && <form onSubmit={onVerifyCode}>
        <Label htmlFor="live-code">One-time code</Label>
        <div className="field-with-icon"><KeyRound size={20} /><Input id="live-code" className="otp-input h-full border-0 bg-transparent px-0 shadow-none focus-visible:ring-0" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={event => onCodeChange(event.target.value.replace(/\D/g, ''))} placeholder="000000" required autoFocus /></div>
        <Button className="primary large" type="submit" disabled={busy || resending || code.length !== 6}>{busy ? 'Checking code…' : 'Verify and continue'} <ArrowRight size={20} /></Button>
        <div className="auth-secondary-actions">
          <Button variant="link" className="text-button" type="button" onClick={onResendCode} disabled={busy || resending}>{resending ? 'Sending a new code…' : 'Request a new code'}</Button>
          <Button variant="link" className="text-button" type="button" onClick={onUseDifferentEmail} disabled={busy || resending}>Use a different email</Button>
        </div>
      </form>}

      {step === 'verifying' && <Spinner className="mx-auto my-7 size-8 text-primary" aria-label="Signing in" />}
      {notice && !error && <p className="form-notice" role="status">{notice}</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      {previewNote}
      <div className="security-note"><ShieldCheck size={18} /><span><strong>Private by design</strong>Your code expires after 10 minutes and can only be used once.</span></div>
    </Card>
  </main>
}

export function UsernameSetupView({ username, busy, error, onUsernameChange, onSubmit, onExit, previewNote }: {
  username: string
  busy: boolean
  error?: string
  onUsernameChange: (value: string) => void
  onSubmit: (event: FormEvent) => void
  onExit: () => void
  previewNote?: ReactNode
}) {
  return <main className="onboarding-page username-onboarding">
    <Button variant="bare" size="content" className="back-link" onClick={onExit}><ArrowLeft /> Leave live mode</Button>
    <section className="onboarding-card">
      <Badge className="mode-badge live"><MessageSquareText size={15} /> Your username</Badge>
      <h1>Choose your username</h1>
      <p>Choose a short username for family chats. People can type it after @ when they want your attention.</p>
      <form onSubmit={onSubmit}>
        <label htmlFor="username">Your username</label>
        <div className="username-field"><span aria-hidden="true">@</span><Input id="username" value={username} onChange={event => onUsernameChange(event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))} placeholder="priya_shah" minLength={3} maxLength={24} pattern="[a-z][a-z0-9_]{2,23}" autoComplete="username" required autoFocus /></div>
        <small className="username-help">Use 3–24 letters, numbers, or underscores. Start with a letter.</small>
        <Button className="primary large" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Continue'} <ArrowRight /></Button>
      </form>
      {error && <p className="form-error" role="alert">{error}</p>}
      {previewNote}
      <div className="security-note"><ShieldCheck /><span><strong>Visible only where you belong</strong>Your username appears to people in your shared family chats.</span></div>
    </section>
  </main>
}

export function AiAccessSetupView({ familyName, accountEmail, owner, openRouterKey, busy, switchingAccount, requested, feedback, switchAccountError, onOpenRouterKeyChange, onSaveKey, onRequestAccess, onSwitchAccount, onExit, previewNote }: {
  familyName: string
  accountEmail: string | null
  owner: boolean
  openRouterKey: string
  busy: boolean
  switchingAccount: boolean
  requested: boolean
  feedback?: string
  switchAccountError?: string
  onOpenRouterKeyChange: (value: string) => void
  onSaveKey: (event: FormEvent) => void
  onRequestAccess: () => void
  onSwitchAccount: () => void
  onExit: () => void
  previewNote?: ReactNode
}) {
  return <main className="onboarding-page access-onboarding">
    <Button variant="bare" size="content" className="back-link" onClick={onExit}><ArrowLeft /> Leave live mode</Button>
    <section className="onboarding-card access-setup-card">
      <Badge className="mode-badge live"><KeyRound size={15} /> Choose your AI access</Badge>
      <h1>Set up Saathi access</h1>
      <p>Add an OpenRouter API key for <strong>{familyName}</strong>, or ask the Saathi administrator for access.</p>
      <div className="access-account">
        <span><small>Signed in as</small><strong>{accountEmail ?? 'Current account'}</strong></span>
        <Button variant="outline" type="button" onClick={onSwitchAccount} disabled={busy || switchingAccount}><LogOut /> {switchingAccount ? 'Signing out…' : 'Use a different email'}</Button>
      </div>
      {switchAccountError && <p className="form-error" role="alert">{switchAccountError}</p>}
      {owner ? <form onSubmit={onSaveKey} className="onboarding-key-form">
        <label htmlFor="onboarding-openrouter">OpenRouter API key <small>required for this option</small></label>
        <Input id="onboarding-openrouter" type="password" autoComplete="off" value={openRouterKey} onChange={event => onOpenRouterKeyChange(event.target.value)} placeholder="sk-or-…" disabled={switchingAccount} required />
        <Button className="primary large" type="submit" disabled={busy || switchingAccount || openRouterKey.trim().length < 20}>{busy ? 'Saving securely…' : 'Save key and start'} <ArrowRight /></Button>
      </form> : <p className="form-notice">Ask a family owner to add an OpenRouter key, or request access below.</p>}
      <div className="access-divider"><span>or</span></div>
      <Button variant="secondary" className="secondary large" onClick={onRequestAccess} disabled={busy || switchingAccount || requested}>{requested ? 'Access requested' : 'Request access'}</Button>
      {feedback && <p className="form-notice" role="status">{feedback}</p>}
      {previewNote}
      <ModelCatalog />
      <div className="security-note"><ShieldCheck /><span><strong>Encrypted and private</strong>Keys are encrypted at rest, never returned to the browser, and shared only inside this family.</span></div>
    </section>
  </main>
}

export function ModelCatalog() {
  return <details className="onboarding-models"><summary>Models used by this build</summary><ul>
    <li><strong>Chat:</strong> DeepSeek V4.1 Flash, GPT-5.6 Luna, Grok 4.6, or GPT-5.6 Sol through OpenRouter</li>
    <li><strong>Images:</strong> Meta Muse Image through OpenRouter</li>
    <li><strong>Voice:</strong> GPT Live 1 with GPT-5 mini delegation through OpenAI</li>
    <li><strong>Email and photo extraction:</strong> GPT-5 mini through OpenAI</li>
    <li><strong>Routing and safety:</strong> your selected OpenRouter model for BYOK, or TypeSafe System One for managed access</li>
  </ul></details>
}
