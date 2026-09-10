import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Archive,
  ArrowLeft,
  AtSign,
  Bell,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  FileText,
  Inbox,
  Languages,
  Menu,
  MessageCircleMore,
  Mic,
  MoreHorizontal,
  Paperclip,
  Plus,
  ReceiptText,
  Reply,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Tag,
  WalletCards,
  Square,
  X,
} from 'lucide-react'
import './App.css'

type Category = 'All' | 'Bills' | 'School' | 'Travel' | 'Subscriptions'

type InboxItem = {
  id: string
  sender: string
  senderEmail: string
  initials: string
  subject: string
  preview: string
  category: Exclude<Category, 'All'>
  time: string
  unread?: boolean
  accent: string
  language: string
  translation: string
  original: string
  amount?: string
  due?: string
}

type LocalVoiceNote = {
  id: string
  url: string
  durationMs: number
}

function formatDuration(durationMs: number) {
  const seconds = Math.ceil(durationMs / 1000)
  return `0:${String(seconds).padStart(2, '0')}`
}

const families = [
  { id: 'kapoor', name: 'Kapoor family', avatar: 'K', email: 'kapoor-family@saath.email' },
  { id: 'parents', name: 'Parents’ home', avatar: 'P', email: 'parents-home@saath.email' },
]

const inboxItems: InboxItem[] = [
  {
    id: 'school-trip',
    sender: 'Vidya Valley School',
    senderEmail: 'notices@vidyavalley.edu.in',
    initials: 'VV',
    subject: 'कक्षा 8 जयपुर शैक्षणिक यात्रा',
    preview: 'सहमति पत्र और यात्रा शुल्क 18 सितंबर तक जमा करें…',
    category: 'School',
    time: '9:42 AM',
    unread: true,
    accent: '#d97745',
    language: 'Hindi',
    translation:
      'The Grade 8 educational trip to Jaipur is scheduled for 4–6 October. Please submit the signed consent form and trip fee by 18 September.',
    original:
      'प्रिय अभिभावक, कक्षा 8 की जयपुर शैक्षणिक यात्रा 4 से 6 अक्टूबर तक आयोजित की जाएगी। कृपया हस्ताक्षरित सहमति पत्र और ₹4,850 यात्रा शुल्क 18 सितंबर तक जमा करें।',
    amount: '₹4,850',
    due: '18 Sep',
  },
  {
    id: 'electricity',
    sender: 'MSEDCL',
    senderEmail: 'noreply@mahadiscom.in',
    initials: 'ME',
    subject: 'Electricity bill for September',
    preview: 'Your bill of ₹2,340 is due on 21 September…',
    category: 'Bills',
    time: 'Yesterday',
    unread: true,
    accent: '#5f7d8f',
    language: 'English',
    translation: 'Your electricity bill of ₹2,340 is due on 21 September. No previous balance is pending.',
    original: 'Your electricity bill for consumer no. 1700198421 is ₹2,340.00 and is payable by 21/09/2026.',
    amount: '₹2,340',
    due: '21 Sep',
  },
  {
    id: 'netflix',
    sender: 'Netflix',
    senderEmail: 'info@account.netflix.com',
    initials: 'N',
    subject: 'Your plan price is changing',
    preview: 'Your monthly price will change to ₹649 from October…',
    category: 'Subscriptions',
    time: 'Mon',
    accent: '#9b4d52',
    language: 'English',
    translation: 'Your monthly plan will increase from ₹549 to ₹649 starting 2 October—a ₹100 (18%) increase.',
    original: 'Your Standard plan price will change from ₹549/month to ₹649/month on your next billing date, 2 October 2026.',
    amount: '₹649/mo',
    due: '2 Oct',
  },
  {
    id: 'hotel',
    sender: 'The Haveli Jaipur',
    senderEmail: 'reservations@thehaveli.in',
    initials: 'HJ',
    subject: 'Re: Family room availability',
    preview: 'We can hold the courtyard room until Friday…',
    category: 'Travel',
    time: 'Sun',
    accent: '#76714a',
    language: 'English',
    translation: 'The hotel can hold a courtyard family room until Friday. Breakfast and station pickup are included.',
    original: 'We are happy to hold one courtyard family room until Friday, 6 PM. The rate includes breakfast and railway station pickup.',
    amount: '₹8,200',
    due: 'Friday',
  },
]

const categories: { label: Category; icon: typeof Inbox; count: number }[] = [
  { label: 'All', icon: Inbox, count: 4 },
  { label: 'Bills', icon: ReceiptText, count: 1 },
  { label: 'School', icon: FileText, count: 1 },
  { label: 'Travel', icon: CalendarDays, count: 1 },
  { label: 'Subscriptions', icon: WalletCards, count: 1 },
]

function SignIn({ onDemo }: { onDemo: () => void }) {
  const [email, setEmail] = useState('')
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [code, setCode] = useState('')

  return (
    <main className="auth-page">
      <section className="auth-story">
        <div className="auth-brand"><span className="brand-mark">स</span> Saath</div>
        <div className="story-copy">
          <span className="eyebrow light">A calmer family inbox</span>
          <h1>Everything your family needs to know, in a language they understand.</h1>
          <p>Bring bills, school notes, travel plans, and conversations together—with Saathi helping only when you ask.</p>
        </div>
        <div className="language-line"><span>नमस्ते</span><span>•</span><span>Hello</span><span>•</span><span>नमस्कार</span></div>
      </section>
      <section className="auth-panel">
        <div className="auth-card">
          <span className="eyebrow">Private by design</span>
          <h2>{step === 'email' ? 'Welcome to Saath' : 'Check your inbox'}</h2>
          <p>{step === 'email' ? 'Enter your email. We’ll send a one-time code—no password or social profile needed.' : `We sent a six-digit code to ${email}.`}</p>
          {step === 'email' ? (
            <form onSubmit={(event) => { event.preventDefault(); if (email) setStep('code') }}>
              <label htmlFor="email">Email address</label>
              <input id="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" required />
              <button className="primary wide" type="submit">Send me a code <ChevronRight size={17} /></button>
            </form>
          ) : (
            <form onSubmit={(event) => { event.preventDefault(); if (code.length === 6) onDemo() }}>
              <label htmlFor="code">One-time code</label>
              <input id="code" className="otp-input" inputMode="numeric" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))} placeholder="000000" required />
              <button className="primary wide" type="submit">Verify and continue <ChevronRight size={17} /></button>
              <button className="text-button" type="button" onClick={() => setStep('email')}>Use a different email</button>
            </form>
          )}
          <div className="demo-note"><Sparkles size={15} /><span>Preview mode: use any six digits to explore the product.</span></div>
        </div>
      </section>
    </main>
  )
}

function App() {
  const [signedIn, setSignedIn] = useState(true)
  const [activeFamily, setActiveFamily] = useState(families[0])
  const [familyMenu, setFamilyMenu] = useState(false)
  const [activeCategory, setActiveCategory] = useState<Category>('All')
  const [selectedId, setSelectedId] = useState('school-trip')
  const [query, setQuery] = useState('')
  const [showOriginal, setShowOriginal] = useState(false)
  const [showMobileNav, setShowMobileNav] = useState(false)
  const [showMobileDetail, setShowMobileDetail] = useState(false)
  const [reply, setReply] = useState('')
  const [draftReady, setDraftReady] = useState(false)
  const [reviewingReply, setReviewingReply] = useState(false)
  const [sent, setSent] = useState(false)
  const [toast, setToast] = useState('')
  const [voiceState, setVoiceState] = useState<'idle' | 'recording' | 'ready'>('idle')
  const [voiceDurationMs, setVoiceDurationMs] = useState(0)
  const [voiceUrl, setVoiceUrl] = useState('')
  const [voiceError, setVoiceError] = useState('')
  const [sharedVoiceNotes, setSharedVoiceNotes] = useState<LocalVoiceNote[]>([])
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const recordingStartedAtRef = useRef(0)
  const recordingTimerRef = useRef<number | null>(null)
  const discardRecordingRef = useRef(false)
  const objectUrlsRef = useRef<string[]>([])

  const filteredItems = useMemo(() => inboxItems.filter((item) => {
    const inCategory = activeCategory === 'All' || item.category === activeCategory
    const inSearch = `${item.sender} ${item.subject} ${item.preview}`.toLowerCase().includes(query.toLowerCase())
    return inCategory && inSearch
  }), [activeCategory, query])

  const selected = inboxItems.find((item) => item.id === selectedId) ?? inboxItems[0]

  const notify = (message: string) => {
    setToast(message)
    window.setTimeout(() => setToast(''), 2600)
  }

  const clearRecordingTimer = () => {
    if (recordingTimerRef.current !== null) window.clearInterval(recordingTimerRef.current)
    recordingTimerRef.current = null
  }

  const stopMicrophone = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
  }

  const stopVoiceRecording = () => {
    const recorder = recorderRef.current
    if (recorder?.state === 'recording') recorder.stop()
  }

  const cancelVoiceRecording = () => {
    discardRecordingRef.current = true
    if (recorderRef.current?.state === 'recording') {
      recorderRef.current.stop()
    } else {
      setVoiceState('idle')
      setVoiceDurationMs(0)
      setVoiceUrl('')
    }
    setVoiceError('')
  }

  const startVoiceRecording = async () => {
    setVoiceError('')
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setVoiceError('Voice recording is not supported in this browser.')
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const preferredType = [
        'audio/webm;codecs=opus',
        'audio/mp4',
        'audio/ogg;codecs=opus',
      ].find((type) => MediaRecorder.isTypeSupported(type))
      const recorder = new MediaRecorder(stream, preferredType ? { mimeType: preferredType } : undefined)
      chunksRef.current = []
      streamRef.current = stream
      recorderRef.current = recorder
      discardRecordingRef.current = false
      recordingStartedAtRef.current = Date.now()
      setVoiceDurationMs(0)
      setVoiceUrl('')
      setVoiceState('recording')

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data)
      }
      recorder.onstop = () => {
        clearRecordingTimer()
        stopMicrophone()
        recorderRef.current = null
        const durationMs = Math.min(Date.now() - recordingStartedAtRef.current, 30_000)
        if (discardRecordingRef.current) {
          chunksRef.current = []
          setVoiceState('idle')
          setVoiceDurationMs(0)
          return
        }
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' })
        chunksRef.current = []
        if (blob.size === 0 || durationMs < 250) {
          setVoiceState('idle')
          setVoiceError('The recording was too short. Please try again.')
          return
        }
        const url = URL.createObjectURL(blob)
        objectUrlsRef.current.push(url)
        setVoiceUrl(url)
        setVoiceDurationMs(durationMs)
        setVoiceState('ready')
      }
      recorder.start(250)
      recordingTimerRef.current = window.setInterval(() => {
        const elapsed = Math.min(Date.now() - recordingStartedAtRef.current, 30_000)
        setVoiceDurationMs(elapsed)
        if (elapsed >= 30_000 && recorder.state === 'recording') recorder.stop()
      }, 200)
    } catch {
      stopMicrophone()
      setVoiceState('idle')
      setVoiceError('Microphone access is needed to record a voice note.')
    }
  }

  const shareVoiceNote = () => {
    if (!voiceUrl) return
    setSharedVoiceNotes((notes) => [...notes, { id: crypto.randomUUID(), url: voiceUrl, durationMs: voiceDurationMs }])
    setVoiceState('idle')
    setVoiceUrl('')
    setVoiceDurationMs(0)
    notify('Voice note shared with your family')
  }

  useEffect(() => () => {
    clearRecordingTimer()
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
    stopMicrophone()
    objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url))
  }, [])

  if (!signedIn) return <SignIn onDemo={() => setSignedIn(true)} />

  return (
    <main className="app-shell">
      <aside className={`nav-rail ${showMobileNav ? 'mobile-open' : ''}`}>
        <div className="brand-row">
          <div className="brand-mark">स</div>
          <span>Saath</span>
          <button className="mobile-close" aria-label="Close navigation" onClick={() => setShowMobileNav(false)}><X size={20} /></button>
        </div>

        <div className="family-wrap">
          <button className="family-switcher" onClick={() => setFamilyMenu(!familyMenu)}>
            <span className="family-avatar">{activeFamily.avatar}</span>
            <span><small>Current space</small><strong>{activeFamily.name}</strong></span>
            <ChevronDown size={16} />
          </button>
          {familyMenu && (
            <div className="family-menu">
              {families.map((family) => (
                <button key={family.id} onClick={() => { setActiveFamily(family); setFamilyMenu(false); notify(`Switched to ${family.name}`) }}>
                  <span className="family-avatar small">{family.avatar}</span><span>{family.name}</span>{activeFamily.id === family.id && <Check size={16} />}
                </button>
              ))}
              <button className="new-space"><Plus size={16} /> Create a family space</button>
            </div>
          )}
        </div>

        <nav className="main-nav" aria-label="Primary">
          <button className="active"><Inbox size={19} /><span>Family inbox</span><b>2</b></button>
          <button><MessageCircleMore size={19} /><span>Conversations</span></button>
          <button><CheckCircle2 size={19} /><span>Tasks</span><b className="muted-count">3</b></button>
        </nav>

        <div className="nav-label">Inbox views</div>
        <nav className="category-nav" aria-label="Inbox categories">
          {categories.map(({ label, icon: Icon, count }) => (
            <button key={label} className={activeCategory === label ? 'active' : ''} onClick={() => { setActiveCategory(label); setShowMobileNav(false) }}>
              <Icon size={18} /><span>{label === 'All' ? 'Everything' : label}</span><b>{count}</b>
            </button>
          ))}
        </nav>

        <div className="nav-spacer" />
        <button className="help-button" onClick={() => notify('Help center preview opened')}><CircleHelp size={21} /><span><strong>Need help?</strong><small>Simple guides and support</small></span></button>
        <div className="inbox-address"><AtSign size={15} /><span><small>Family address</small>{activeFamily.email}</span></div>
        <button className="profile-row" onClick={() => setSignedIn(false)} title="Open sign-in preview">
          <span className="profile-avatar">AK</span><span><strong>Asha Kapoor</strong><small>Owner · English</small></span><MoreHorizontal size={18} />
        </button>
      </aside>

      <section className="inbox-column">
        <header className="inbox-header">
          <button className="mobile-menu" aria-label="Open navigation" onClick={() => setShowMobileNav(true)}><Menu size={21} /></button>
          <div><span className="eyebrow">{activeFamily.name}</span><h1>Family inbox</h1></div>
          <button className="icon-button labelled" aria-label="Notifications"><Bell size={19} /><span>Alerts</span><i className="alert-dot" /></button>
        </header>
        <div className="search-wrap"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search family mail" /></div>
        <div className="list-toolbar"><span>{activeCategory === 'All' ? 'Everything' : activeCategory}</span><button><Tag size={15} /> Filter</button></div>
        <div className="message-list">
          {filteredItems.map((item) => (
            <button key={item.id} className={`message-row ${selected.id === item.id ? 'selected' : ''}`} onClick={() => { setSelectedId(item.id); setShowOriginal(false); setDraftReady(false); setReviewingReply(false); setSent(false); setShowMobileDetail(true) }}>
              <span className="sender-avatar" style={{ background: item.accent }}>{item.initials}</span>
              <span className="message-content">
                <span className="message-meta"><strong>{item.sender}</strong><time>{item.time}</time></span>
                <span className="message-subject">{item.subject}</span>
                <span className="message-preview">{item.preview}</span>
                <span className="message-tags"><em>{item.category}</em>{item.language !== 'English' && <em className="language-tag"><Languages size={11} /> {item.language}</em>}</span>
              </span>
              {item.unread && <span className="unread-dot" />}
            </button>
          ))}
          {filteredItems.length === 0 && <div className="empty-state"><Search size={26} /><strong>No family mail found</strong><span>Try another category or search.</span></div>}
        </div>
      </section>

      <section className={`detail-column ${showMobileDetail ? 'mobile-visible' : ''}`}>
        <header className="detail-header">
          <button className="mobile-back" aria-label="Back to inbox" onClick={() => setShowMobileDetail(false)}><ArrowLeft size={20} /></button>
          <div className="detail-title"><span className="category-pill">{selected.category}</span><span>Received {selected.time.toLowerCase()}</span></div>
          <div className="detail-actions">
            <button className="icon-button labelled" aria-label="Archive"><Archive size={18} /><span>Archive</span></button>
            <button className="icon-button" aria-label="More options"><MoreHorizontal size={19} /></button>
          </div>
        </header>

        <div className="detail-scroll">
          <article className="email-hero">
            <div className="email-heading">
              <span className="sender-avatar large" style={{ background: selected.accent }}>{selected.initials}</span>
              <div><h2>{selected.subject}</h2><p>From <strong>{selected.sender}</strong> <span>&lt;{selected.senderEmail}&gt;</span></p></div>
            </div>
            <button className="source-toggle" onClick={() => setShowOriginal(!showOriginal)}><Languages size={16} />{showOriginal ? 'View English' : `View original · ${selected.language}`}</button>
            <div className={`email-copy ${showOriginal ? 'original' : ''}`}>
              <span className="derived-label">{showOriginal ? 'Original message' : 'Translated by Saathi'}</span>
              <p>{showOriginal ? selected.original : selected.translation}</p>
            </div>
            <div className="attachment-row"><FileText size={20} /><span><strong>Consent-form.pdf</strong><small>PDF · 184 KB · Original attachment</small></span><button>View</button></div>
          </article>

          <section className="saathi-card">
            <div className="saathi-heading"><span className="saathi-avatar"><Sparkles size={17} /></span><div><strong>Saathi found the important bits</strong><small>Checked against the original message</small></div><span className="confidence"><ShieldCheck size={14} /> High confidence</span></div>
            <div className="fact-grid">
              <div><span className="fact-icon peach"><WalletCards size={17} /></span><span><small>Amount</small><strong>{selected.amount ?? 'Not specified'}</strong></span></div>
              <div><span className="fact-icon blue"><CalendarDays size={17} /></span><span><small>Due date</small><strong>{selected.due ?? 'No deadline'}</strong></span></div>
              <div><span className="fact-icon green"><CheckCircle2 size={17} /></span><span><small>Next step</small><strong>{selected.category === 'School' ? 'Sign and submit' : 'Review together'}</strong></span></div>
            </div>
            <div className="task-suggestion"><div><input type="checkbox" aria-label="Mark task done" /><span><strong>{selected.category === 'School' ? 'Complete the school consent form' : `Review ${selected.subject}`}</strong><small>Suggested for Asha · due {selected.due ?? 'this week'}</small></span></div><button onClick={() => notify('Task added to your family list')}><Plus size={15} /> Add task</button></div>
          </section>

          <section className="conversation">
            <div className="section-heading"><div><MessageCircleMore size={18} /><h3>Family conversation</h3></div><span>3 members can see this</span></div>
            <div className="chat-message"><span className="profile-avatar smallish">RK</span><div><div><strong>Rohan</strong><time>10:03 AM</time></div><p>I think she’ll love this. Should we confirm before tonight?</p></div></div>
            <div className="chat-message saathi"><span className="saathi-avatar smallish"><Sparkles size={14} /></span><div><div><strong>Saathi</strong><em>AI participant</em></div><p>The form is due on 18 September. I can draft a short reply confirming participation, but Asha will review it before anything is sent.</p><button onClick={() => { setDraftReady(true); setReply('Hello, we confirm that Anaya will join the Jaipur educational trip. We will submit the signed consent form and fee by 18 September. Thank you.'); notify('Draft prepared—nothing has been sent') }}><Sparkles size={14} /> Draft a reply</button></div></div>
            {sharedVoiceNotes.map((note) => (
              <div className="chat-message voice-message" key={note.id}>
                <span className="profile-avatar smallish">AK</span>
                <div><div><strong>Asha</strong><time>Just now</time><em>Voice note · {formatDuration(note.durationMs)}</em></div><audio controls preload="metadata" src={note.url}>Your browser cannot play this voice note.</audio><p>Saathi is preparing a transcript in the spoken language.</p></div>
              </div>
            ))}
          </section>
        </div>

        <footer className="composer">
          {sent ? (
            <div className="sent-state"><CheckCircle2 size={19} /><span><strong>Reply queued securely</strong><small>AgentMail will keep it in this email thread.</small></span><button onClick={() => setSent(false)}>Dismiss</button></div>
          ) : (
            <>
              {voiceState === 'idle' && (draftReady || reviewingReply) && <div className="draft-banner"><Sparkles size={14} /> {reviewingReply ? 'Final review · Confirm the recipient and exact message below' : 'Saathi draft · Review the recipient and message before sending'}</div>}
              {voiceState === 'idle' && <div className="recipient-line"><Reply size={15} /><span>Replying to <strong>{selected.sender}</strong> · {selected.senderEmail}</span></div>}
              <div className="compose-box">
                {voiceState === 'idle' ? (
                  <textarea value={reply} onChange={(event) => { setReply(event.target.value); setReviewingReply(false) }} placeholder={`Discuss with family, or type @Saathi…`} />
                ) : (
                  <div className="voice-recorder" role="status" aria-live="polite">
                    <span className={`recording-indicator ${voiceState}`}><Mic size={18} /></span>
                    <span><strong>{voiceState === 'recording' ? 'Recording a family voice note' : 'Voice note ready'}</strong><small>{voiceState === 'recording' ? 'Speak naturally · stops at 30 seconds' : 'Listen before sharing with your family'}</small></span>
                    <b>{formatDuration(voiceDurationMs)} / 0:30</b>
                    {voiceState === 'recording' && <button className="stop-recording" onClick={stopVoiceRecording}><Square size={13} fill="currentColor" /> Stop</button>}
                  </div>
                )}
                {voiceState === 'ready' && <audio className="voice-preview" controls preload="metadata" src={voiceUrl}>Your browser cannot play this voice note.</audio>}
                <div><div><button aria-label="Attach file"><Paperclip size={18} /></button><button className={voiceState !== 'idle' ? 'active-tool' : ''} aria-label={voiceState === 'idle' ? 'Record a family voice note' : 'Cancel voice note'} title={voiceState === 'idle' ? 'Record a family voice note' : 'Cancel voice note'} onClick={voiceState === 'idle' ? startVoiceRecording : cancelVoiceRecording}>{voiceState === 'idle' ? <Mic size={18} /> : <X size={18} />}</button><button aria-label="Ask Saathi"><Sparkles size={18} /></button></div>{voiceState === 'ready' ? <button className="send-button voice-send" onClick={shareVoiceNote}>Share with family <Send size={16} /></button> : voiceState === 'idle' ? <button className="send-button" disabled={!reply.trim()} onClick={() => {
                  if (!reviewingReply) {
                    setReviewingReply(true)
                    notify('Ready for your final confirmation')
                    return
                  }
                  setSent(true)
                  setReply('')
                  setReviewingReply(false)
                  notify('Confirmed and queued with AgentMail')
                }}>{reviewingReply ? 'Confirm send' : 'Review & send'} <Send size={16} /></button> : null}</div>
              </div>
              {voiceError && <p className="voice-error" role="alert">{voiceError}</p>}
              <p className="composer-note"><ShieldCheck size={13} /> {voiceState === 'idle' ? 'Nothing leaves Saath until you review and confirm it.' : 'Only shared with family when you tap Share with family.'}</p>
            </>
          )}
        </footer>
      </section>

      {showMobileNav && <button className="mobile-overlay" aria-label="Close navigation" onClick={() => setShowMobileNav(false)} />}
      {toast && <div className="toast"><CheckCircle2 size={17} />{toast}</div>}
    </main>
  )
}

export default App
