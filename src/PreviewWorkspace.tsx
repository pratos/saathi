import { useEffect, useRef, useState, type FormEvent } from 'react'
import {
  ArrowLeft,
  Bell,
  Check,
  ExternalLink,
  Folder,
  Languages,
  Mail,
  MessageSquareText,
  Mic,
  Send,
  ShieldCheck,
  Sparkles,
  Square,
  Volume2,
  X,
} from 'lucide-react'
import './App.css'

type VoiceState = 'idle' | 'recording' | 'ready'

export function PreviewWorkspace({ onExit }: { onExit: () => void }) {
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

  useEffect(() => () => {
    clearTimer()
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
    stopTracks()
    objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url))
  }, [])

  return (
    <main className="saath-workspace seeded-workspace">
      <aside className="workspace-rail" aria-label="Main navigation">
        <div className="workspace-logo">स</div>
        <button className="rail-action active"><MessageSquareText /><span>Chats</span></button>
        <button className="rail-action"><Bell /><span>Updates</span></button>
        <button className="rail-action"><Folder /><span>Files</span></button>
        <button className="rail-profile" onClick={onExit} aria-label="Exit preview">AS</button>
      </aside>

      <aside className="conversation-list">
        <h1>Asha Family</h1>
        <span className="list-heading">Family chats</span>
        <button className="conversation-link selected"><i /><span>Weekend in Mysuru</span><b>4</b></button>
        <button className="conversation-link"><i /><span>Home</span></button>
        <button className="conversation-link"><i /><span>School notice</span></button>
        <span className="list-heading section-gap">Only me</span>
        <button className="conversation-link"><i /><span>Ask Saathi</span></button>
        <span className="list-heading section-gap">My reading language</span>
        <div className="language-setting"><strong>English</strong><button>Change</button></div>
      </aside>

      <section className="conversation-pane">
        <header className="conversation-header">
          <button className="mobile-chat-back" onClick={onExit} aria-label="Back"><ArrowLeft /></button>
          <div>
            <div className="title-line"><h2>Weekend in Mysuru</h2><span className="preview-label"><Sparkles size={14} /> Seeded preview</span></div>
            <p>3 family members · translated for you</p>
          </div>
          <div className="participant-stack" aria-label="Asha, Appa, and Riya"><span>AS</span><span>AP</span><span>RG</span></div>
        </header>

        <div className="conversation-feed">
          <article className="outgoing-message">
            <span>You · 10:42</span>
            <p>Can we leave Friday after office?</p>
          </article>

          <article className="person-message">
            <span className="message-avatar appa">AP</span>
            <div><h3>Appa <small>· Hindi original · 10:44</small></h3>
              <div className="translation-card">
                <p lang="hi">शुक्रवार को ट्रैफिक बहुत होगा। शनिवार सुबह निकलें?</p>
                <div className="translation-copy"><span>English translation</span><p>Friday traffic will be heavy. Should we leave Saturday morning?</p></div>
                <div className="card-actions"><button><Volume2 /> Listen</button><button><Languages /> Language</button></div>
              </div>
            </div>
          </article>

          <article className="person-message email-person desktop-only-message">
            <span className="message-avatar email"><Mail /></span>
            <div><h3>Riya <small>· joined by email · 10:47</small></h3><div className="simple-message">I can hold the homestay until 6 PM today.</div></div>
          </article>

          <article className="person-message assistant-message">
            <span className="message-avatar assistant">S</span>
            <div><h3>Saathi <small>· checked 3 current sources</small></h3>
              <div className="assistant-card">
                <p><span className="desktop-assistant-copy">Saturday morning looks calmer. Leave Bengaluru around 6:30 AM. The drive is usually close to three hours before longer breakfast stops.</span><span className="mobile-assistant-copy">Saturday morning looks calmer. Leave around 6:30 AM.</span></p>
                <div className="card-actions desktop-source-actions"><button><ExternalLink /> Traffic advisory</button><button><ExternalLink /> Route report</button><button><ExternalLink /> Weather</button></div>
                <div className="card-actions mobile-source-action"><button><ExternalLink /> View sources</button></div>
              </div>
            </div>
          </article>

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
        <section><span>Confirmed plan</span><p className="confirmed"><Check /> Leave Saturday at 6:30 AM</p></section>
        <section><span>Still to decide</span><p>Book Riya’s homestay before 6 PM?</p></section>
        <section><span>Saathi’s work</span><p className="status-row"><i /> Checked 3 current sources</p><p className="status-row"><ShieldCheck /> Sources saved with the answer</p></section>
        <section><span>This month’s allowance</span><p>18 of 100 AI requests used</p><div className="usage-bar"><i /></div></section>
      </aside>
    </main>
  )
}

function formatDuration(durationMs: number) {
  const seconds = Math.ceil(durationMs / 1000)
  return `0:${String(seconds).padStart(2, '0')}`
}
