import { useEffect, useState, type FormEvent } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  Bell,
  Bot,
  Check,
  Copy,
  Eye,
  FileText,
  Folder,
  House,
  KeyRound,
  Link2,
  LockKeyhole,
  Mail,
  MailOpen,
  MessageSquareText,
  Mic,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  UserPlus,
  UserRound,
  UsersRound,
  X,
} from 'lucide-react'
import { Badge } from './components/ui/badge'
import { Button } from './components/ui/button'
import { Input } from './components/ui/input'
import { Progress } from './components/ui/progress'
import { Textarea } from './components/ui/textarea'
import { VoiceCallOverlay } from './LiveWorkspace'
import './PreviewWorkspace.css'

type PreviewPane = 'chats' | 'updates' | 'files' | 'family'

const walkthroughSteps = [
  { title: 'Sign in', detail: 'Email OTP' },
  { title: 'Meet your Saathi', detail: 'Your username' },
  { title: 'Add your family', detail: 'Invite a member' },
  { title: 'Choose AI access', detail: 'Managed or BYOK' },
  { title: 'Connect Gmail', detail: 'Private import' },
  { title: 'Receive useful mail', detail: 'My Saathi DM' },
  { title: 'Share with family', detail: 'Explicit sharing' },
  { title: 'Review extraction', detail: 'Category and amount' },
  { title: 'Add a memory', detail: 'Text mode' },
  { title: 'Ask a question', detail: 'Grounded answer' },
  { title: 'Use voice and tools', detail: 'Browser check' },
  { title: 'Review settings', detail: 'AgentMail and controls' },
] as const

const defaultPane: PreviewPane[] = [
  'chats',
  'chats',
  'family',
  'chats',
  'family',
  'chats',
  'chats',
  'updates',
  'chats',
  'chats',
  'chats',
  'family',
]

export function PreviewWorkspace({ onExit, onOpenLive }: { onExit: () => void; onOpenLive: () => void }) {
  const [step, setStep] = useState(0)
  const [pane, setPane] = useState<PreviewPane>('chats')
  const [authStage, setAuthStage] = useState<'email' | 'code'>('email')
  const [email, setEmail] = useState('asha@example.com')
  const [code, setCode] = useState('')
  const [username, setUsername] = useState('asha-kapoor')
  const [familyEmail, setFamilyEmail] = useState('appa@example.com')
  const [invited, setInvited] = useState(false)
  const [apiKey, setApiKey] = useState('')
  const [gmailConnected, setGmailConnected] = useState(false)
  const [gmailPromptOpen, setGmailPromptOpen] = useState(false)
  const [emailShared, setEmailShared] = useState(false)
  const [memorySaved, setMemorySaved] = useState(false)
  const [answerShown, setAnswerShown] = useState(false)
  const [voiceMuted, setVoiceMuted] = useState(false)

  const closeGmailPrompt = () => {
    setGmailPromptOpen(false)
    requestAnimationFrame(() => document.getElementById('preview-gmail-trigger')?.focus())
  }

  useEffect(() => {
    if (!gmailPromptOpen) return
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') closeGmailPrompt()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [gmailPromptOpen])

  const goTo = (next: number) => {
    const bounded = Math.max(0, Math.min(walkthroughSteps.length - 1, next))
    setStep(bounded)
    setPane(defaultPane[bounded])
    if (bounded === 4 && !gmailConnected) setGmailPromptOpen(true)
  }

  const handleAuth = (event: FormEvent) => {
    event.preventDefault()
    if (authStage === 'email') {
      setAuthStage('code')
      return
    }
    goTo(1)
  }

  const renderGmailDialog = () => gmailPromptOpen && !gmailConnected ? (
    <div className="family-dialog-backdrop" role="presentation" onMouseDown={closeGmailPrompt}>
      <section className="family-dialog" role="dialog" aria-modal="true" aria-labelledby="preview-gmail-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="family-dialog-header">
          <div>
            <span className="family-dialog-icon"><Mail /></span>
            <span><strong id="preview-gmail-title">Connect Gmail to find useful mail</strong><small>Optional · private by default</small></span>
          </div>
          <Button variant="ghost" size="icon" type="button" onClick={closeGmailPrompt} aria-label="Close Gmail setup" autoFocus><X /></Button>
        </div>
        <p>Saathi can import useful receipts, renewals, and travel mail into your private My Saathi conversation. Nothing reaches your family inbox unless you share it.</p>
        <div className="family-dialog-actions">
          <Button variant="outline" type="button" onClick={closeGmailPrompt}>Not now</Button>
          <Button type="button" onClick={() => {
            setGmailConnected(true)
            setGmailPromptOpen(false)
            goTo(5)
          }}><Link2 /> Connect Gmail</Button>
        </div>
      </section>
    </div>
  ) : null

  const tourBar = (
    <header className="preview-tour-bar">
      <div className="preview-tour-heading">
        <Badge variant="accent"><Eye /> Guided preview</Badge>
        <span><strong>{walkthroughSteps[step].title}</strong><small>{walkthroughSteps[step].detail}</small></span>
      </div>
      <div className="preview-tour-progress">
        <span>Step {step + 1} of {walkthroughSteps.length}</span>
        <Progress value={((step + 1) / walkthroughSteps.length) * 100} />
      </div>
      <div className="preview-tour-actions">
        <Button variant="outline" size="icon" type="button" onClick={() => goTo(step - 1)} disabled={step === 0} aria-label="Previous walkthrough step"><ArrowLeft /></Button>
        {step === walkthroughSteps.length - 1
          ? <Button type="button" onClick={onOpenLive}>Open live workspace <ArrowRight /></Button>
          : <Button type="button" onClick={() => goTo(step + 1)}>Next <ArrowRight /></Button>}
      </div>
    </header>
  )

  if (step === 0) {
    return <main className="preview-walkthrough-shell">
      {tourBar}
      <section className="live-auth-page">
        <div className="live-auth-brand"><span className="live-auth-mark">स</span><strong>Saathi</strong></div>
        <div className="live-auth-card">
          <div className="live-auth-heading"><span className="live-auth-icon"><Mail /></span><span><h1>{authStage === 'email' ? 'Welcome to Saathi' : 'Check your email'}</h1><p>{authStage === 'email' ? 'Sign in to open your private family workspace.' : `Enter the six-digit code sent to ${email}.`}</p></span></div>
          <form className="live-auth-form" onSubmit={handleAuth}>
            {authStage === 'email'
              ? <label><span>Email address</span><Input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" /></label>
              : <label><span>One-time code</span><Input value={code} onChange={(event) => setCode(event.target.value)} inputMode="numeric" autoComplete="one-time-code" placeholder="123456" /></label>}
            <Button type="submit">{authStage === 'email' ? 'Continue with email' : 'Verify and continue'} <ArrowRight /></Button>
            {authStage === 'code' && <Button variant="ghost" type="button" onClick={() => setAuthStage('email')}>Use a different email</Button>}
          </form>
          <small className="preview-sample-note"><Eye /> This guided preview uses sample information and sends no email.</small>
        </div>
      </section>
    </main>
  }

  if (step === 1) {
    return <main className="preview-walkthrough-shell">
      {tourBar}
      <section className="live-onboarding-page">
        <div className="live-onboarding-card">
          <span className="live-onboarding-icon"><UserRound /></span>
          <Badge variant="accent">Your profile</Badge>
          <h1>What should your family call you?</h1>
          <p>Choose a username that family members will recognize in conversations and mentions.</p>
          <form className="live-onboarding-form" onSubmit={(event) => { event.preventDefault(); goTo(2) }}>
            <label><span>Username</span><Input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" /></label>
            <div className="onboarding-preview"><span>AK</span><div><strong>@{username || 'your-name'}</strong><small>Shown in the Kapoor family</small></div></div>
            <Button type="submit">Save and continue <ArrowRight /></Button>
          </form>
        </div>
      </section>
    </main>
  }

  if (step === 3) {
    return <main className="preview-walkthrough-shell">
      {tourBar}
      <section className="live-onboarding-page">
        <div className="live-onboarding-card access-onboarding-card">
          <span className="live-onboarding-icon"><KeyRound /></span>
          <Badge variant="accent">AI access</Badge>
          <h1>Choose how Saathi thinks</h1>
          <p>Use managed Saathi access, or connect your family’s OpenRouter key for text conversations.</p>
          <div className="access-choice-grid">
            <button type="button" className="access-choice-card selected" onClick={() => goTo(4)}><Sparkles /><span><strong>Managed by Saathi</strong><small>Text, voice, and tools are ready.</small></span><Check /></button>
            <div className="access-choice-card byok-card"><KeyRound /><span><strong>Use your own key</strong><small>OpenRouter text access for this family.</small></span><Input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="sk-or-v1-…" aria-label="OpenRouter API key" /><Button variant="outline" type="button" onClick={() => goTo(4)} disabled={!apiKey.trim()}>Save family key</Button></div>
          </div>
          <small className="preview-sample-note"><LockKeyhole /> This preview stores no key. BYOK voice is temporarily unavailable.</small>
        </div>
      </section>
    </main>
  }

  const isFamilyPanel = pane === 'family'
  const isSettingsOverview = step === 11

  return <main className="preview-walkthrough-shell">
    {tourBar}
    <div className={`saathi-workspace live-conversation-workspace is-mobile-${isFamilyPanel ? 'family' : 'detail'}${isFamilyPanel ? ' is-family-open' : ''}`}>
      <aside className="workspace-rail" aria-label="Preview workspace navigation">
        <div className="workspace-logo">स</div>
        <button type="button" className={`rail-action ${pane === 'chats' ? 'active' : ''}`} onClick={() => setPane('chats')}><MessageSquareText /><span>Home</span></button>
        <button type="button" className={`rail-action ${pane === 'updates' ? 'active' : ''}`} onClick={() => setPane('updates')}><Bell /><span>Inbox</span></button>
        <button type="button" className={`rail-action ${pane === 'files' ? 'active' : ''}`} onClick={() => setPane('files')}><Folder /><span>Files</span></button>
        <button type="button" className={`rail-action ${pane === 'family' ? 'active' : ''}`} onClick={() => setPane('family')}><Settings2 /><span>Settings</span></button>
        <button type="button" className="rail-action" onClick={onExit}><ArrowLeft /><span>Exit</span></button>
        <div className="rail-session"><span className="rail-profile" aria-label="Asha Kapoor">AK</span></div>
      </aside>

      <aside className="conversation-list live-conversation-list">
        <div className="mobile-home-header"><div><span>KAPOOR FAMILY</span><h1>Welcome, Asha</h1><p>Your private and family conversations</p></div><span className="preview-mobile-avatar">AK</span></div>
        <span className="family-select-label">Current family</span>
        <div className="family-switcher"><button type="button" className="selected">Kapoor family</button></div>
        <section className="mobile-family-overview" aria-label="Family overview">
          <button type="button" onClick={() => setPane('updates')}><span><Bell /><strong>Inbox</strong></span><small>{emailShared ? '1 shared receipt' : 'No shared mail yet'}</small><ArrowRight /></button>
          <button type="button" onClick={() => setPane('files')}><span><Folder /><strong>Files</strong></span><small>Family documents</small><ArrowRight /></button>
        </section>
        <span className="list-heading">Private</span>
        <button type="button" className={`conversation-link personal-chat-link ${pane === 'chats' ? 'selected' : ''}`} onClick={() => setPane('chats')}><Bot /><span>My Saathi<small>Only you</small></span>{step === 5 && <b className="preview-unread">1</b>}</button>
        <span className="list-heading section-gap">Family chats</span>
        <button type="button" className="conversation-link" onClick={() => setPane('chats')}><i /><span>Kapoor family<small>{emailShared ? 'Receipt shared by Asha' : 'Appa and 2 others'}</small></span></button>
      </aside>

      {!isFamilyPanel && <section className="conversation-pane preview-live-pane">
        <header className="conversation-header live-room-header">
          <button className="mobile-chat-back" type="button" onClick={() => setPane('chats')} aria-label="Back to conversations"><ArrowLeft /></button>
          <div><div className="title-line"><h2>{pane === 'updates' ? 'Family inbox' : pane === 'files' ? 'Files' : 'My Saathi'}</h2><span className="live-label"><Eye /> Preview</span></div><p>{pane === 'updates' ? 'Mail shared with the Kapoor family' : pane === 'files' ? 'Documents shared with your family' : 'Private conversation · only you'}</p></div>
          <div className="live-room-actions"><Button variant="ghost" size="icon" type="button" aria-label="Search conversation"><Search /></Button>{pane === 'chats' && <Button variant="ghost" size="icon" type="button" onClick={() => goTo(10)} aria-label="Start voice preview"><Mic /></Button>}</div>
        </header>

        <div className="conversation-feed preview-conversation-feed">
          {pane === 'files' && <div className="live-empty-state"><span><Folder /></span><h3>Family files stay with their source</h3><p>Forwarded documents and attachments will appear here after you share them.</p></div>}

          {pane === 'updates' && <>
            <article className="updates-card expanded">
              <header><span className="update-source-icon"><MailOpen /></span><div><strong>Grok xAI receipt</strong><small>Shared by Asha · today</small></div><Badge variant="accent">Renewal</Badge></header>
              <p>SuperGrok Plus · paid 15 September 2026</p>
              <dl className="inbox-facts"><div><dt>Category</dt><dd>Subscriptions</dd></div><div><dt>Type</dt><dd>AI service renewal</dd></div><div><dt>Merchant</dt><dd>Grok xAI</dd></div><div><dt>Amount paid</dt><dd>₹9,977.07</dd></div><div><dt>Billing period</dt><dd>15 Sep–15 Oct 2026</dd></div><div><dt>Payment method</dt><dd>•••• 1003</dd></div></dl>
              <div className="update-actions"><Button variant="outline" type="button"><FileText /> View original email</Button><Button type="button" onClick={() => goTo(8)}>Ask Saathi <ArrowRight /></Button></div>
            </article>
            <div className="assistant-card"><Sparkles /><div><strong>Saathi sorted this email</strong><p>The category, merchant, renewal period, and amount came from the original receipt. You can always open the source to verify them.</p></div></div>
          </>}

          {pane === 'chats' && step <= 6 && <>
            <div className="assistant-card"><Sparkles /><div><strong>{step === 4 ? 'Gmail is optional' : 'Useful mail arrives privately first'}</strong><p>{step === 4 ? 'Connect Gmail from Settings. Saathi imports only useful mail into My Saathi.' : 'I found a paid Grok xAI renewal in your Gmail. It is visible only to you until you share it.'}</p></div></div>
            {step >= 5 && <article className="person-message email-guest-message"><span className="message-avatar"><Mail /></span><div><h3>Grok xAI receipt <small>· Imported from Gmail · private</small></h3><div className="simple-message"><p>SuperGrok Plus renewed for ₹9,977.07. Billing period: 15 September–15 October 2026.</p><div className="email-message-actions"><Button variant="outline" type="button"><FileText /> Open source</Button><Button type="button" disabled={emailShared} onClick={() => {
              if (step === 5) {
                goTo(6)
                return
              }
              setEmailShared(true)
              goTo(7)
            }}>{emailShared ? <><Check /> Shared with family</> : step === 5 ? <>Review sharing options <ArrowRight /></> : <><UsersRound /> Share with Kapoor family</>}</Button></div></div></div></article>}
            {step === 6 && <div className="assistant-card"><ShieldCheck /><div><strong>Sharing is explicit</strong><p>The original email and extracted details will move to the Kapoor family inbox only after you choose Share.</p></div></div>}
          </>}

          {pane === 'chats' && step === 8 && <>
            <article className="outgoing-message"><span>You · just now</span><p>Remember that Appa prefers morning appointments and needs step-free access.</p></article>
            <div className="assistant-card"><Sparkles /><div><strong>Save this as a family preference?</strong><p>“Appa prefers morning appointments and needs step-free access.” It will stay scoped to the Kapoor family.</p><Button type="button" disabled={memorySaved} onClick={() => setMemorySaved(true)}>{memorySaved ? <><Check /> Memory saved</> : 'Save memory'}</Button></div></div>
            {memorySaved && <div className="assistant-card success"><Check /><div><strong>Saved for future planning</strong><p>I’ll use this preference when you ask about appointments, travel, or places.</p></div></div>}
          </>}

          {pane === 'chats' && step >= 9 && <>
            <article className="outgoing-message"><span>You · just now</span><p>Find two step-free stays near Mysuru and check whether the road is clear Saturday morning.</p></article>
            <div className="tool-activity-card"><span className="tool-activity-icon"><Search /></span><div><strong>Checking current sources</strong><small>Browser tool · official traffic advisory</small></div><Badge variant="accent">Complete</Badge></div>
            <div className="assistant-card"><Sparkles /><div><strong>Two accessible options are available</strong><p>Garden Courtyard lists a step-free entrance and family room. Lakeview House lists a lift and accessible bathroom. The official advisory shows the primary route open, with intermittent restrictions near Mandya.</p><ol><li><strong>Garden Courtyard</strong> — ₹6,800, step-free entrance</li><li><strong>Lakeview House</strong> — ₹7,250, accessible bathroom</li></ol><Button variant="outline" type="button" onClick={() => setAnswerShown(true)}><Link2 /> {answerShown ? 'Official advisory opened' : 'Open official advisory'}</Button></div></div>
          </>}
        </div>

        {pane === 'chats' && <footer className="conversation-composer"><form onSubmit={(event) => { event.preventDefault(); if (step === 8) setMemorySaved(true); if (step === 9) setAnswerShown(true) }}><Textarea rows={1} placeholder={step === 8 ? 'Tell Saathi what to remember…' : 'Message Saathi…'} aria-label="Message Saathi" /><Button className="composer-send" size="icon" type="submit" aria-label="Send message"><Send /></Button></form><small>Saathi can make mistakes. Check important details.</small></footer>}
      </section>}

      <aside className="conversation-context preview-settings-context">
        <header className="conversation-header live-room-header mobile-family-header"><button className="mobile-chat-back" type="button" onClick={() => setPane('chats')} aria-label="Back to conversations"><ArrowLeft /></button><div><div className="title-line"><h2>Settings</h2><span className="live-label"><Eye /> Preview</span></div><p>Kapoor family</p></div></header>
        <div className="context-title"><div><h2>{step === 2 ? 'Family members' : step === 4 ? 'Connected apps' : 'Settings'}</h2><p>{step === 2 ? 'Invite people to this family.' : step === 4 ? 'Choose which inboxes Saathi can help with.' : 'Manage your profile, family, and integrations.'}</p></div></div>
        <div className="settings-scroll settings-page">
          {step === 2 && <>
            <section className="settings-card"><div className="settings-card-heading"><div><span className="settings-card-icon"><UsersRound /></span><div><h3>Kapoor family</h3><p>2 active members</p></div></div></div><div className="family-member-row"><span className="member-avatar">AK</span><div><strong>Asha Kapoor</strong><small>@{username} · Owner · You</small></div></div><div className="family-member-row"><span className="member-avatar muted">AP</span><div><strong>Appa Kapoor</strong><small>Member</small></div></div></section>
            <section className="settings-card"><div className="settings-card-heading"><div><span className="settings-card-icon"><UserPlus /></span><div><h3>Invite a family member</h3><p>They will receive a secure email invitation.</p></div></div></div><form className="settings-inline-form" onSubmit={(event) => { event.preventDefault(); setInvited(true) }}><Input type="email" value={familyEmail} onChange={(event) => setFamilyEmail(event.target.value)} aria-label="Family member email" /><Button type="submit" disabled={invited}>{invited ? <><Check /> Invitation sent</> : <><Send /> Send invitation</>}</Button></form></section>
          </>}

          {step === 4 && <>
            <section className="settings-card"><div className="settings-card-heading"><div><span className="settings-card-icon"><Mail /></span><div><h3>Gmail</h3><p>Bring useful mail into your private My Saathi conversation.</p></div></div><Badge variant={gmailConnected ? 'accent' : 'secondary'}>{gmailConnected ? 'Connected' : 'Not connected'}</Badge></div><p className="settings-card-copy">Receipts, renewals, travel, and family logistics stay private until you explicitly share them.</p><Button id="preview-gmail-trigger" type="button" disabled={gmailConnected} onClick={() => setGmailPromptOpen(true)}>{gmailConnected ? <><Check /> Gmail connected</> : <><Link2 /> Connect Gmail</>}</Button></section>
            <section className="settings-card"><div className="settings-card-heading"><div><span className="settings-card-icon"><MailOpen /></span><div><h3>Family email</h3><p>Forward mail here when everyone should see it.</p></div></div></div><div className="copy-value"><code>kapoor-family@agentmail.to</code><Button variant="outline" size="icon" type="button" aria-label="Copy family email address"><Copy /></Button></div></section>
          </>}

          {isSettingsOverview && <>
            <section className="settings-card"><div className="settings-card-heading"><div><span className="settings-card-icon"><MailOpen /></span><div><h3>Family email</h3><p>Forward mail directly into the Kapoor family inbox.</p></div></div><Badge variant="accent">Active</Badge></div><div className="copy-value"><code>kapoor-family@agentmail.to</code><Button variant="outline" size="icon" type="button" aria-label="Copy family email address"><Copy /></Button></div><small className="settings-footnote">Sample AgentMail address for this walkthrough.</small></section>
            <section className="settings-card settings-link-list">
              <button type="button"><UserRound /><span><strong>You</strong><small>Profile, language, and appearance</small></span><ArrowRight /></button>
              <button type="button"><UsersRound /><span><strong>Family</strong><small>Members, invitations, and roles</small></span><ArrowRight /></button>
              <button type="button"><Link2 /><span><strong>Connected apps</strong><small>Gmail and family email</small></span><Badge variant="accent">Gmail connected</Badge></button>
              <button type="button"><Bell /><span><strong>Notifications</strong><small>Mentions, new mail, and OTP sharing</small></span><ArrowRight /></button>
              <button type="button"><Sparkles /><span><strong>AI access</strong><small>Managed access or family BYOK</small></span><ArrowRight /></button>
              <button type="button"><ShieldCheck /><span><strong>Privacy and safety</strong><small>Memories, approvals, and account controls</small></span><ArrowRight /></button>
            </section>
          </>}
        </div>
      </aside>

      <nav className="mobile-workspace-nav" aria-label="Preview workspace">
        <button type="button" className={pane === 'chats' ? 'active' : ''} onClick={() => setPane('chats')}><span className="mobile-nav-icon"><House /></span><span>Home</span></button>
        <button type="button" className={pane === 'updates' ? 'active' : ''} onClick={() => setPane('updates')}><span className="mobile-nav-icon"><Bell /></span><span>Inbox</span></button>
        <button type="button" className={pane === 'files' ? 'active' : ''} onClick={() => setPane('files')}><span className="mobile-nav-icon"><Folder /></span><span>Files</span></button>
        <button type="button" className={pane === 'family' ? 'active' : ''} onClick={() => setPane('family')}><span className="mobile-nav-icon"><Settings2 /></span><span>Settings</span></button>
      </nav>

      {renderGmailDialog()}
      {step === 10 && <VoiceCallOverlay
        status={voiceMuted ? 'muted' : 'live'}
        turns={[
          { role: 'user', text: 'Find two step-free stays near Mysuru and check the road for Saturday morning.', startMs: 0 },
          { role: 'assistant', text: 'I found two options. I’m checking the official traffic advisory now.', startMs: 5_000 },
        ]}
        activities={[{
          id: 'preview-browser-check',
          name: 'use_computer',
          title: 'Checking the official traffic advisory',
          detail: 'Opening a public source and reading the latest route status.',
          status: 'complete',
          result: '**Stays:** Garden Courtyard and Lakeview House both list step-free access.\n\n**Route status:** Open Saturday morning. Intermittent restrictions are listed near Mandya.',
        }]}
        computerTool={{
          callId: 'preview-browser-check',
          task: 'Check the official traffic advisory for Saturday morning.',
          controller: 'jev',
          phase: 'voice_handover',
          selectedActionLabel: 'Open official traffic advisory',
        }}
        voiceLevel={0.36}
        voiceSeconds={38}
        onMute={() => setVoiceMuted((current) => !current)}
        onEnd={() => goTo(11)}
      />}
    </div>
  </main>
}
