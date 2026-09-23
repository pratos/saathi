import { useEffect, useState, type FormEvent } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  Bell,
  Bot,
  Check,
  Copy,
  FileText,
  Folder,
  House,
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
import { AiAccessSetupView, EmailOtpSignInView, UsernameSetupView } from './AuthFlowViews'
import { Badge } from './components/ui/badge'
import { Button } from './components/ui/button'
import { Input } from './components/ui/input'
import { Progress } from './components/ui/progress'
import { Textarea } from './components/ui/textarea'
import { AssistantMessageView, EmailGuestMessageView, OutgoingMessageView, VoiceCallOverlay } from './LiveWorkspace'
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
  const [username, setUsername] = useState('asha_kapoor')
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
      setCode('123456')
      return
    }
    goTo(1)
  }

  const renderGmailDialog = () => gmailPromptOpen && !gmailConnected ? (
    <div className="family-dialog-backdrop" role="presentation" onMouseDown={closeGmailPrompt}>
      <section className="family-dialog gmail-setup-dialog" role="dialog" aria-modal="true" aria-labelledby="preview-gmail-title" onMouseDown={(event) => event.stopPropagation()}>
        <header><div><span>Connected apps</span><h2 id="preview-gmail-title">Connect Gmail to find useful mail</h2></div><button type="button" onClick={closeGmailPrompt} aria-label="Close Gmail setup" autoFocus><X /></button></header>
        <p>Saathi can import useful receipts, renewals, and travel mail into your private My Saathi conversation. Nothing reaches your family inbox unless you share it.</p>
        <div className="status-actions">
          <Button type="button" size="lg" onClick={() => {
            setGmailConnected(true)
            setGmailPromptOpen(false)
            goTo(5)
          }}><Mail /> Connect Gmail</Button>
          <Button type="button" size="lg" variant="secondary" onClick={closeGmailPrompt}>Not now</Button>
        </div>
      </section>
    </div>
  ) : null

  const tourBar = (
    <header className="preview-tour-bar">
      <div className="preview-tour-heading">
        <span className="preview-mode-label">Guided preview</span>
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
    return <div className="preview-walkthrough-shell">
      {tourBar}
      <EmailOtpSignInView
        step={authStage}
        email={email}
        code={code}
        busy={false}
        resending={false}
        onEmailChange={setEmail}
        onCodeChange={setCode}
        onRequestCode={handleAuth}
        onVerifyCode={handleAuth}
        onResendCode={() => setCode('123456')}
        onUseDifferentEmail={() => { setAuthStage('email'); setCode('') }}
        onBack={onExit}
        previewNote={<p className="preview-sample-note">Preview only: no sign-in email is sent.</p>}
      />
    </div>
  }

  if (step === 1) {
    return <div className="preview-walkthrough-shell">
      {tourBar}
      <UsernameSetupView
        username={username}
        busy={false}
        onUsernameChange={setUsername}
        onSubmit={event => { event.preventDefault(); goTo(2) }}
        onExit={onExit}
        previewNote={<p className="preview-sample-note">Preview only: this sample username is not saved.</p>}
      />
    </div>
  }

  if (step === 3) {
    return <div className="preview-walkthrough-shell">
      {tourBar}
      <AiAccessSetupView
        familyName="Kapoor family"
        accountEmail={email}
        owner
        openRouterKey={apiKey}
        busy={false}
        switchingAccount={false}
        requested={false}
        onOpenRouterKeyChange={setApiKey}
        onSaveKey={event => { event.preventDefault(); goTo(4) }}
        onRequestAccess={() => goTo(4)}
        onSwitchAccount={() => goTo(0)}
        onExit={onExit}
        previewNote={<p className="preview-sample-note"><LockKeyhole /> Preview only: no key is stored. BYOK voice is temporarily unavailable.</p>}
      />
    </div>
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

      {!isFamilyPanel && <section className={`conversation-pane preview-live-pane${pane === 'updates' ? ' inbox-pane' : ''}`}>
        <header className="conversation-header live-room-header">
          <button className="mobile-chat-back" type="button" onClick={() => setPane('chats')} aria-label="Back to conversations"><ArrowLeft /></button>
          <div><div className="title-line"><h2>{pane === 'updates' ? 'Family inbox' : pane === 'files' ? 'Files' : 'My Saathi'}</h2><span className="live-label">Preview</span></div><p>{pane === 'updates' ? 'Mail shared with the Kapoor family' : pane === 'files' ? 'Documents shared with your family' : 'Private conversation · only you'}</p></div>
          <div className="live-room-actions"><Button variant="ghost" size="icon" type="button" aria-label="Search conversation"><Search /></Button>{pane === 'chats' && <Button variant="ghost" size="icon" type="button" onClick={() => goTo(10)} aria-label="Start voice preview"><Mic /></Button>}</div>
        </header>

        <div className={`conversation-feed live-feed preview-conversation-feed${pane === 'updates' ? ' inbox-feed' : ''}`}>
          {pane === 'files' && <div className="live-empty-state"><span><Folder /></span><h3>Family files stay with their source</h3><p>Forwarded documents and attachments will appear here after you share them.</p></div>}

          {pane === 'updates' && <>
            <article className="person-message inbox-card">
              <span className="message-avatar email"><Mail /></span>
              <div><h3><button type="button" className="inbox-subject-button">Grok xAI receipt</button><small>Subscriptions · AI service renewal · today</small></h3>
                <div className="simple-message inbox-message-card">
                  <p className="inbox-sender">Grok xAI · shared by Asha</p>
                  <div className="inbox-facts"><p><span>Merchant</span><strong>Grok xAI</strong></p><p><span>Amount</span><strong>₹9,977.07</strong></p><p><span>Period</span><strong>15 Sep–15 Oct 2026</strong></p><p><span>Payment</span><strong>•••• 1003</strong></p></div>
                  <div className="inbox-actions"><Button variant="secondary" type="button"><MailOpen /> Open email</Button><Button type="button" onClick={() => goTo(8)}>Ask Saathi <ArrowRight /></Button></div>
                </div>
              </div>
            </article>
            <AssistantMessageView meta="sorted from the original receipt"><p>The merchant, renewal period, and amount stay linked to the source email so you can verify them.</p></AssistantMessageView>
          </>}

          {pane === 'chats' && step <= 6 && <>
            <AssistantMessageView meta={step === 4 ? 'Gmail setup' : 'private mail summary'}><p>{step === 4 ? 'Connect Gmail from Settings. Useful mail appears privately in My Saathi first.' : 'I found a paid Grok xAI renewal in your Gmail. Only you can see it until you share it.'}</p></AssistantMessageView>
            {step >= 5 && <EmailGuestMessageView title="Grok xAI receipt" meta="Imported from Gmail · private"><p>SuperGrok Plus renewed for ₹9,977.07. Billing period: 15 September–15 October 2026.</p><div className="share-family-mail-row"><Button variant="outline" size="lg" type="button"><FileText /> Open source</Button><Button size="lg" className="share-family-mail" type="button" disabled={emailShared} onClick={() => {
              if (step === 5) {
                goTo(6)
                return
              }
              setEmailShared(true)
              goTo(7)
            }}>{emailShared ? <><Check /> Shared with family</> : step === 5 ? <>Review sharing options <ArrowRight /></> : <><UsersRound /> Share with Kapoor family</>}</Button></div></EmailGuestMessageView>}
            {step === 6 && <AssistantMessageView meta="sharing check"><p>Nothing moves to the Kapoor family inbox until you choose Share with Kapoor family.</p></AssistantMessageView>}
          </>}

          {pane === 'chats' && step === 8 && <>
            <OutgoingMessageView meta="You · just now">Remember that Appa prefers morning appointments and needs step-free access.</OutgoingMessageView>
            <AssistantMessageView meta="memory approval"><p>Save “Appa prefers morning appointments and needs step-free access” for the Kapoor family?</p><Button size="sm" type="button" disabled={memorySaved} onClick={() => setMemorySaved(true)}>{memorySaved ? <><Check /> Memory saved</> : 'Save memory'}</Button></AssistantMessageView>
            {memorySaved && <AssistantMessageView meta="saved"><p>I’ll use this preference when you ask about appointments, travel, or places.</p></AssistantMessageView>}
          </>}

          {pane === 'chats' && step >= 9 && <>
            <OutgoingMessageView meta="You · just now">Find two step-free stays near Mysuru and check whether the road is clear Saturday morning.</OutgoingMessageView>
            <AssistantMessageView meta="browser check complete"><div className="agent-activity"><Search /><span>Checked the official traffic advisory</span></div><p>Garden Courtyard and Lakeview House both list step-free access. The primary route is open, with intermittent restrictions near Mandya.</p><ol><li><strong>Garden Courtyard</strong> — ₹6,800</li><li><strong>Lakeview House</strong> — ₹7,250</li></ol><Button variant="outline" size="sm" type="button" onClick={() => setAnswerShown(true)}><Link2 /> {answerShown ? 'Official advisory opened' : 'Open official advisory'}</Button></AssistantMessageView>
          </>}
        </div>

        {pane === 'chats' && <footer className="conversation-composer"><div className="composer-guidance"><span>Preview conversation · nothing is sent</span></div><form onSubmit={(event) => { event.preventDefault(); if (step === 8) setMemorySaved(true); if (step === 9) setAnswerShown(true) }}><Textarea rows={1} placeholder={step === 8 ? 'Tell Saathi what to remember…' : 'Message Saathi…'} aria-label="Message Saathi" /><Button className="composer-send" type="submit">Send <Send /></Button></form></footer>}
      </section>}

      <aside className="conversation-context preview-settings-context">
        <header className="conversation-header live-room-header mobile-family-header"><button className="mobile-chat-back" type="button" onClick={() => setPane('chats')} aria-label="Back to conversations"><ArrowLeft /></button><div><div className="title-line"><h2>Settings</h2><span className="live-label">Preview</span></div><p>Kapoor family</p></div></header>
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
