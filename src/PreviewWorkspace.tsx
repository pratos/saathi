import { useEffect, useRef, useState, type FormEvent } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  Bell,
  Check,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Folder,
  Languages,
  Mail,
  MessageSquareText,
  Mic,
  Pause,
  Play,
  RefreshCcw,
  Send,
  ShieldCheck,
  Sparkles,
  Square,
  Volume2,
  X,
} from 'lucide-react'
import './App.css'

type VoiceState = 'idle' | 'recording' | 'ready'
type PreviewFamily = 'asha' | 'parents'

const demoSteps = [
  { title: 'Email sign-in', caption: 'Enter a sample address safely. No email is sent.' },
  { title: 'One-time code', caption: 'Replay the six-digit verification used by live mode.' },
  { title: 'Create a family', caption: 'Start a separate space for each part of your family.' },
  { title: 'Read together', caption: 'See one conversation in each person’s preferred language.' },
  { title: 'Send a message', caption: 'Share a seeded message without touching live family data.' },
  { title: 'Family inbox', caption: 'Connect sample mail and see an incoming family update.' },
  { title: 'Switch families', caption: 'Move between families without mixing their information.' },
  { title: 'Decide with Saath', caption: 'Review sourced guidance and the decision still to make.' },
] as const

export function PreviewWorkspace({ onExit }: { onExit: () => void }) {
  const [demoStep, setDemoStep] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [previewEmail, setPreviewEmail] = useState('asha@example.com')
  const [previewCode, setPreviewCode] = useState('248613')
  const [familyName, setFamilyName] = useState('Asha Family')
  const [selectedFamily, setSelectedFamily] = useState<PreviewFamily>('asha')
  const [inboxConnected, setInboxConnected] = useState(false)
  const [message, setMessage] = useState('')
  const [sentMessages, setSentMessages] = useState<string[]>([])
  const [voiceState, setVoiceState] = useState<VoiceState>('idle')
  const [voiceUrl, setVoiceUrl] = useState('')
  const [voiceDuration, setVoiceDuration] = useState(0)
  const [voiceError, setVoiceError] = useState('')
  const [sharedVoice, setSharedVoice] = useState<{ url: string; duration: number } | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<number | null>(null)
  const startedAtRef = useRef(0)
  const discardRef = useRef(false)
  const objectUrlsRef = useRef<string[]>([])
  const feedRef = useRef<HTMLDivElement | null>(null)

  const goToStep = (nextStep: number) => {
    const step = Math.max(0, Math.min(demoSteps.length - 1, nextStep))
    setDemoStep(step)
    setSelectedFamily(step === 6 ? 'parents' : 'asha')
    setSentMessages(step >= 4 ? ['Saturday at 6:30 works for me.'] : [])
    setInboxConnected(step >= 5)
  }

  const restartDemo = () => {
    setIsPlaying(false)
    setDemoStep(0)
    setSelectedFamily('asha')
    setInboxConnected(false)
    setSentMessages([])
    setMessage('')
    setPreviewCode('248613')
    cancelVoice()
  }

  const stopTracks = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
  }

  const clearTimer = () => {
    if (timerRef.current !== null) window.clearInterval(timerRef.current)
    timerRef.current = null
  }

  const startRecording = async () => {
    setVoiceError('')
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setVoiceError('Voice recording is not supported in this browser.')
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mediaType = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus'].find(MediaRecorder.isTypeSupported)
      const recorder = new MediaRecorder(stream, mediaType ? { mimeType: mediaType } : undefined)
      recorderRef.current = recorder
      streamRef.current = stream
      chunksRef.current = []
      startedAtRef.current = Date.now()
      discardRef.current = false
      setVoiceDuration(0)
      setVoiceState('recording')
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunksRef.current.push(event.data)
      }
      recorder.onstop = () => {
        clearTimer()
        stopTracks()
        const duration = Math.min(Date.now() - startedAtRef.current, 30_000)
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' })
        chunksRef.current = []
        if (discardRef.current) {
          setVoiceState('idle')
          return
        }
        if (blob.size === 0 || duration < 250) {
          setVoiceState('idle')
          setVoiceError('That recording was too short. Please try again.')
          return
        }
        const url = URL.createObjectURL(blob)
        objectUrlsRef.current.push(url)
        setVoiceUrl(url)
        setVoiceDuration(duration)
        setVoiceState('ready')
      }
      recorder.start(250)
      timerRef.current = window.setInterval(() => {
        const duration = Math.min(Date.now() - startedAtRef.current, 30_000)
        setVoiceDuration(duration)
        if (duration >= 30_000 && recorder.state === 'recording') recorder.stop()
      }, 200)
    } catch {
      stopTracks()
      setVoiceState('idle')
      setVoiceError('Allow microphone access to record a voice note.')
    }
  }

  const cancelVoice = () => {
    discardRef.current = true
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
    if (voiceUrl) URL.revokeObjectURL(voiceUrl)
    setVoiceUrl('')
    setVoiceDuration(0)
    setVoiceState('idle')
  }

  const shareVoice = () => {
    if (!voiceUrl) return
    setSharedVoice({ url: voiceUrl, duration: voiceDuration })
    setVoiceUrl('')
    setVoiceState('idle')
  }

  const sendMessage = (event: FormEvent) => {
    event.preventDefault()
    const text = message.trim()
    if (!text) return
    setSentMessages((current) => [...current, text])
    setMessage('')
  }

  useEffect(() => {
    if (demoStep < 3) return
    const frame = window.requestAnimationFrame(() => {
      if (feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight
    })
    return () => window.cancelAnimationFrame(frame)
  }, [demoStep, selectedFamily, sentMessages, sharedVoice])

  useEffect(() => {
    if (!isPlaying) return
    if (demoStep === demoSteps.length - 1) return
    const timer = window.setTimeout(() => {
      const nextStep = demoStep + 1
      goToStep(nextStep)
      if (nextStep === demoSteps.length - 1) setIsPlaying(false)
    }, 4_200)
    return () => window.clearTimeout(timer)
  }, [demoStep, isPlaying])

  useEffect(() => {
    const handleVisibility = () => {
      if (document.hidden) setIsPlaying(false)
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [])

  useEffect(() => () => {
    clearTimer()
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
    stopTracks()
    objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url))
  }, [])

  return (
    <main className="preview-demo-shell">
      <DemoControls step={demoStep} isPlaying={isPlaying} onPlay={() => {
        if (demoStep === demoSteps.length - 1) {
          restartDemo()
          window.setTimeout(() => setIsPlaying(true), 0)
        } else setIsPlaying((current) => !current)
      }} onStep={goToStep} onRestart={restartDemo} onExit={onExit} />

      {demoStep === 0 && (
        <section className="preview-demo-stage preview-auth-stage">
          <button className="back-link" onClick={onExit}><ArrowLeft size={19} /> Exit preview</button>
          <form className="live-auth-card preview-flow-card" onSubmit={(event) => { event.preventDefault(); goToStep(1) }}>
            <div className="auth-brand dark"><span className="brand-mark">स</span> Saath</div>
            <span className="mode-badge preview-flow-badge"><Sparkles size={15} /> Simulated preview</span>
            <h1>Sign in with your email</h1>
            <p>In live mode, Saath emails a one-time code. Here, we’ll safely replay that step without sending anything.</p>
            <label htmlFor="preview-email">Sample email address</label>
            <div className="field-with-icon"><Mail size={20} /><input id="preview-email" type="email" value={previewEmail} onChange={(event) => setPreviewEmail(event.target.value)} required /></div>
            <button className="primary large" type="submit">Email me a sample code <ArrowRight size={20} /></button>
            <div className="security-note"><ShieldCheck size={18} /><span><strong>Sample data only</strong>No account is created and no email leaves Saath.</span></div>
          </form>
        </section>
      )}

      {demoStep === 1 && (
        <section className="preview-demo-stage preview-auth-stage">
          <form className="live-auth-card preview-flow-card" onSubmit={(event) => { event.preventDefault(); goToStep(2) }}>
            <span className="mode-badge preview-flow-badge"><Sparkles size={15} /> Simulated preview</span>
            <h1>Enter your six-digit code</h1>
            <p>A sample code was prepared for {previewEmail}. Nothing was delivered to an inbox.</p>
            <label htmlFor="preview-code">Sample one-time code</label>
            <div className="field-with-icon"><ShieldCheck size={20} /><input id="preview-code" className="otp-input" inputMode="numeric" maxLength={6} value={previewCode} onChange={(event) => setPreviewCode(event.target.value.replace(/\D/g, ''))} required /></div>
            <button className="primary large" type="submit" disabled={previewCode.length !== 6}>Verify sample code <ArrowRight size={20} /></button>
            <button className="text-button" type="button" onClick={() => goToStep(0)}>Use a different email</button>
          </form>
        </section>
      )}

      {demoStep === 2 && (
        <section className="preview-demo-stage preview-auth-stage">
          <form className="onboarding-card preview-flow-card" onSubmit={(event) => { event.preventDefault(); goToStep(3) }}>
            <span className="mode-badge preview-flow-badge"><Sparkles size={15} /> Simulated preview</span>
            <h1>Create your first family space</h1>
            <p>Each family keeps its conversations, inbox, members, and Saath context separate.</p>
            <label htmlFor="preview-family-name">What should we call this family?</label>
            <input id="preview-family-name" value={familyName} onChange={(event) => setFamilyName(event.target.value)} minLength={2} maxLength={80} required />
            <button className="primary large" type="submit">Create sample family <ArrowRight size={20} /></button>
            <div className="security-note"><ShieldCheck size={18} /><span><strong>Nothing is saved</strong>This family exists only for this preview.</span></div>
          </form>
        </section>
      )}

      {demoStep >= 3 && <section className="saath-workspace seeded-workspace">
      <aside className="workspace-rail" aria-label="Main navigation">
        <div className="workspace-logo">स</div>
        <button className="rail-action active"><MessageSquareText /><span>Chats</span></button>
        <button className="rail-action"><Bell /><span>Updates</span></button>
        <button className="rail-action"><Folder /><span>Files</span></button>
        <button className="rail-profile" onClick={onExit} aria-label="Exit preview">AS</button>
      </aside>

      <aside className="conversation-list">
        <h1>{selectedFamily === 'asha' ? familyName : 'Parents’ Home'}</h1>
        <label className="family-select-label" htmlFor="preview-family-switcher">Current family</label>
        <select id="preview-family-switcher" className="dark-family-select" value={selectedFamily} onChange={(event) => { setIsPlaying(false); setSelectedFamily(event.target.value as PreviewFamily) }}>
          <option value="asha">{familyName}</option>
          <option value="parents">Parents’ Home</option>
        </select>
        <span className="list-heading">Family chats</span>
        <button className="conversation-link selected"><i /><span>{selectedFamily === 'asha' ? 'Weekend in Mysuru' : 'Parents’ medicines'}</span><b>{selectedFamily === 'asha' ? 4 : 2}</b></button>
        <button className="conversation-link" onClick={() => setMessage('Is everything sorted at home?')}><i /><span>Home</span></button>
        <button className="conversation-link" onClick={() => setMessage('I read the school notice.')}><i /><span>School notice</span></button>
        <span className="list-heading section-gap">Only me</span>
        <button className="conversation-link"><i /><span>Ask Saathi</span></button>
        <span className="list-heading section-gap">My reading language</span>
        <div className="language-setting"><strong>English</strong><button>Change</button></div>
      </aside>

      <section className="conversation-pane">
        <header className="conversation-header">
          <button className="mobile-chat-back" onClick={onExit} aria-label="Back"><ArrowLeft /></button>
          <div>
            <div className="title-line"><h2>{selectedFamily === 'asha' ? 'Weekend in Mysuru' : 'Parents’ medicines'}</h2><span className="preview-label"><Sparkles size={14} /> Seeded preview</span></div>
            <p>{selectedFamily === 'asha' ? '3 family members · translated for you' : '2 family members · separate family space'}</p>
          </div>
          <div className="participant-stack" aria-label="Asha, Appa, and Riya"><span>AS</span><span>AP</span><span>RG</span></div>
        </header>

        <div className="conversation-feed" ref={feedRef}>
          <article className="outgoing-message">
            <span>You · 10:42</span>
            <p>{selectedFamily === 'asha' ? 'Can we leave Friday after office?' : 'Did the blood-pressure tablets arrive?'}</p>
          </article>

          <article className="person-message">
            <span className="message-avatar appa">AP</span>
            <div><h3>Appa <small>· Hindi original · 10:44</small></h3>
              <div className="translation-card">
                <p lang="hi">{selectedFamily === 'asha' ? 'शुक्रवार को ट्रैफिक बहुत होगा। शनिवार सुबह निकलें?' : 'हाँ, दवाइयाँ आज सुबह आ गईं।'}</p>
                <div className="translation-copy"><span>English translation</span><p>{selectedFamily === 'asha' ? 'Friday traffic will be heavy. Should we leave Saturday morning?' : 'Yes, the medicines arrived this morning.'}</p></div>
                <div className="card-actions"><button><Volume2 /> Listen</button><button><Languages /> Language</button></div>
              </div>
            </div>
          </article>

          {demoStep >= 5 && <article className="person-message email-person desktop-only-message">
            <span className="message-avatar email"><Mail /></span>
            <div><h3>{selectedFamily === 'asha' ? 'Riya' : 'Pharmacy'} <small>· joined by email · 10:47</small></h3><div className="simple-message">{selectedFamily === 'asha' ? 'I can hold the homestay until 6 PM today.' : 'Your monthly prescription has been delivered.'}</div></div>
          </article>}

          {demoStep >= 7 && selectedFamily === 'asha' && <article className="person-message assistant-message demo-reveal">
            <span className="message-avatar assistant">S</span>
            <div><h3>Saathi <small>· checked 3 current sources</small></h3>
              <div className="assistant-card">
                <p><span className="desktop-assistant-copy">Saturday morning looks calmer. Leave Bengaluru around 6:30 AM. The drive is usually close to three hours before longer breakfast stops.</span><span className="mobile-assistant-copy">Saturday morning looks calmer. Leave around 6:30 AM.</span></p>
                <div className="card-actions desktop-source-actions"><button><ExternalLink /> Traffic advisory</button><button><ExternalLink /> Route report</button><button><ExternalLink /> Weather</button></div>
                <div className="card-actions mobile-source-action"><button><ExternalLink /> View sources</button></div>
              </div>
            </div>
          </article>}

          {sentMessages.map((text, index) => <article className="outgoing-message" key={`${text}-${index}`}><span>You · Just now</span><p>{text}</p></article>)}
          {sharedVoice && (
            <article className="outgoing-message voice-note-message"><span>You · Voice note · {formatDuration(sharedVoice.duration)}</span><audio controls src={sharedVoice.url}>Your browser cannot play this recording.</audio></article>
          )}
        </div>

        <footer className="conversation-composer">
          {voiceState === 'recording' && <div className="recording-strip"><span><i /> Recording · {formatDuration(voiceDuration)} / 0:30</span><button onClick={() => recorderRef.current?.stop()}><Square fill="currentColor" /> Stop</button></div>}
          {voiceState === 'ready' && <div className="recording-strip"><span>Voice note ready to share</span><div><button onClick={cancelVoice}><X /> Remove</button><button onClick={shareVoice}><Send /> Share</button></div></div>}
          <form onSubmit={sendMessage}>
            <textarea value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Write a message…" aria-label="Message" />
            <button className="composer-mic" type="button" onClick={voiceState === 'idle' ? startRecording : cancelVoice} aria-label={voiceState === 'idle' ? 'Record a voice note' : 'Cancel voice note'}><Mic /></button>
            <button className="composer-send" type="submit" disabled={!message.trim()}>Send <Send /></button>
          </form>
          {voiceError && <p className="dark-form-error" role="alert">{voiceError}</p>}
        </footer>
      </section>

      <aside className="conversation-context">
        <div className="context-title"><h2>This conversation</h2><button onClick={onExit}>Exit preview</button></div>
        <section><span>{selectedFamily === 'asha' ? 'Confirmed plan' : 'Latest update'}</span><p className="confirmed"><Check /> {selectedFamily === 'asha' ? 'Leave Saturday at 6:30 AM' : 'Medicines delivered this morning'}</p></section>
        <section><span>Still to decide</span><p>{selectedFamily === 'asha' ? 'Book Riya’s homestay before 6 PM?' : 'Schedule the next doctor visit?'}</p></section>
        {selectedFamily === 'asha' && <section><span>Family inbox</span>{inboxConnected ? <p className="confirmed"><Check /> Sample AgentMail inbox connected</p> : <button className="preview-connect-button" onClick={() => goToStep(Math.max(demoStep, 5))}><Mail /> Connect sample inbox</button>}</section>}
        <section><span>Saathi’s work</span><p className="status-row"><i /> Checked 3 current sources</p><p className="status-row"><ShieldCheck /> Sources saved with the answer</p></section>
        <section><span>This month’s allowance</span><p>18 of 100 AI requests used</p><div className="usage-bar"><i /></div></section>
      </aside>
      </section>}
    </main>
  )
}

function DemoControls({ step, isPlaying, onPlay, onStep, onRestart, onExit }: {
  step: number
  isPlaying: boolean
  onPlay: () => void
  onStep: (step: number) => void
  onRestart: () => void
  onExit: () => void
}) {
  return (
    <header className="demo-controls" aria-label="Guided preview controls">
      <div className="demo-caption" aria-live="polite"><span>Step {step + 1} of {demoSteps.length}</span><strong>{demoSteps[step].title}</strong><small>{demoSteps[step].caption}</small></div>
      <div className="demo-progress" aria-hidden="true"><i style={{ width: `${((step + 1) / demoSteps.length) * 100}%` }} /></div>
      <div className="demo-buttons">
        <button onClick={onRestart} aria-label="Restart preview"><RefreshCcw /></button>
        <button onClick={() => onStep(step - 1)} disabled={step === 0} aria-label="Previous step"><ChevronLeft /></button>
        <button className="demo-play" onClick={onPlay}>{isPlaying ? <Pause /> : <Play fill="currentColor" />}<span>{isPlaying ? 'Pause' : step === demoSteps.length - 1 ? 'Replay' : 'Play'}</span></button>
        <button onClick={() => onStep(step + 1)} disabled={step === demoSteps.length - 1} aria-label="Next step"><ChevronRight /></button>
        <button className="demo-exit" onClick={onExit}>Exit</button>
      </div>
    </header>
  )
}

function formatDuration(durationMs: number) {
  const seconds = Math.ceil(durationMs / 1000)
  return `0:${String(seconds).padStart(2, '0')}`
}
