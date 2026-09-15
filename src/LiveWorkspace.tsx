import { useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent, type KeyboardEvent } from 'react'
import { useAuthActions } from '@convex-dev/auth/react'
import { useAction, useMutation, useQuery } from 'convex/react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  ArrowLeft,
  AtSign,
  Bell,
  Bot,
  Check,
  FileText,
  Folder,
  LockKeyhole,
  LogOut,
  Mail,
  MessageSquareText,
  Mic,
  MicOff,
  Paperclip,
  PhoneOff,
  Plus,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  Upload,
  UserPlus,
  X,
} from 'lucide-react'
import { api } from '../convex/_generated/api'
import type { Doc, Id } from '../convex/_generated/dataModel'
import { useLiveVoice } from './useLiveVoice'

type FamilyRow = { membership: Doc<'memberships'>; space: Doc<'spaces'> }
type PendingUpload = { id: string; name: string; status: 'uploading' | 'error'; message?: string }

const ACCEPTED_ATTACHMENTS = 'image/jpeg,image/png,image/webp,image/gif,image/heic,application/pdf,text/plain,text/csv,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation'
const SUPPORTED_ATTACHMENT_TYPES = new Set(ACCEPTED_ATTACHMENTS.split(','))
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024

export function LiveWorkspace({ onExit }: { onExit: () => void }) {
  const ensureCurrent = useMutation(api.users.ensureCurrent)
  const acceptInvitation = useMutation(api.invitations.accept)
  const spaces = useQuery(api.spaces.mine)
  const [selectedSpaceId, setSelectedSpaceId] = useState<Id<'spaces'> | null>(null)
  const [invitationState, setInvitationState] = useState<'idle' | 'accepting' | 'error'>(() => invitationToken() ? 'accepting' : 'idle')
  const [invitationError, setInvitationError] = useState('')

  useEffect(() => {
    void ensureCurrent({}).catch(() => undefined)
  }, [ensureCurrent])

  useEffect(() => {
    const token = invitationToken()
    if (!token || invitationState !== 'accepting') return
    void sha256(token).then(tokenHash => acceptInvitation({ tokenHash })).then(spaceId => {
      setSelectedSpaceId(spaceId)
      clearInvitationToken()
      setInvitationState('idle')
    }).catch(error => {
      const code = convexErrorCode(error)
      setInvitationError(code === 'INVITATION_WRONG_USER'
        ? 'This invitation belongs to a different email address. Sign out and use the address that received it.'
        : code === 'INVITATION_EXPIRED'
          ? 'This invitation has expired. Ask a family owner for a new one.'
          : 'This invitation is invalid or has already been revoked.')
      setInvitationState('error')
    })
  }, [acceptInvitation, invitationState])

  const families = useMemo(() => {
    if (!spaces) return []
    return spaces.flatMap((row) => row.space ? [{ membership: row.membership, space: row.space }] : [])
  }, [spaces])

  if (invitationState === 'accepting') return <LiveStatus message="Adding you to the invited family…" />
  if (invitationState === 'error') return <InvitationError message={invitationError} onDismiss={() => { clearInvitationToken(); setInvitationState('idle') }} />
  if (spaces === undefined) return <LiveStatus message="Loading your private family spaces…" />
  if (families.length === 0) return <CreateFirstFamily onExit={onExit} />

  const family = families.find(({ space }) => space._id === selectedSpaceId) ?? families[0]
  return <LiveFamilyShell families={families} family={family} onSelectFamily={setSelectedSpaceId} onExit={onExit} />
}

function CreateFirstFamily({ onExit }: { onExit: () => void }) {
  const createSpace = useMutation(api.spaces.create)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await createSpace({ name, creationKey: crypto.randomUUID().replaceAll('-', '') })
    } catch {
      setError('We could not create this family space. Please try again.')
      setBusy(false)
    }
  }

  return (
    <main className="onboarding-page">
      <button className="back-link" onClick={onExit}><ArrowLeft /> Leave live mode</button>
      <section className="onboarding-card">
        <span className="mode-badge live"><LockKeyhole size={15} /> Live workspace</span>
        <h1>Create your first family space</h1>
        <p>Each family keeps its conversations, inbox, members, and Saathi context separate.</p>
        <form onSubmit={submit}>
          <label htmlFor="family-name">What should we call this family?</label>
          <input id="family-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="For example, Parents’ home" minLength={2} maxLength={80} required autoFocus />
          <button className="primary large" type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create private family space'} <Plus /></button>
        </form>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="security-note"><ShieldCheck /><span><strong>Separate by default</strong>You can belong to multiple families without sharing information between them.</span></div>
      </section>
    </main>
  )
}

function LiveFamilyShell({ families, family, onSelectFamily, onExit }: {
  families: FamilyRow[]
  family: FamilyRow
  onSelectFamily: (spaceId: Id<'spaces'>) => void
  onExit: () => void
}) {
  const { signOut } = useAuthActions()
  const user = useQuery(api.users.current)
  const rooms = useQuery(api.rooms.list, { spaceId: family.space._id })
  const inboxItems = useQuery(api.inbox.list, { spaceId: family.space._id, limit: 20 })
  const [membersOpen, setMembersOpen] = useState(false)
  const sharedRoom = rooms?.find(({ room }) => room?.type === 'shared')?.room ?? rooms?.find(({ room }) => room)?.room ?? null
  const initials = initialsFor(user?.displayName ?? user?.name ?? user?.email ?? 'Family member')

  useEffect(() => {
    if (!membersOpen) return
    const closeOnEscape = (event: globalThis.KeyboardEvent) => event.key === 'Escape' && setMembersOpen(false)
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [membersOpen])

  return (
    <main className="saath-workspace live-conversation-workspace">
      <aside className="workspace-rail" aria-label="Main navigation">
        <div className="workspace-logo">स</div>
        <button className="rail-action active"><MessageSquareText /><span>Chats</span></button>
        <button className="rail-action"><Bell /><span>Updates</span></button>
        <button className="rail-action"><Folder /><span>Files</span></button>
        <button className="rail-profile" onClick={() => void signOut()} aria-label="Sign out">{initials}</button>
      </aside>

      <aside className="conversation-list live-conversation-list">
        <label className="family-select-label" htmlFor="family-switcher">Current family</label>
        <select id="family-switcher" className="dark-family-select" value={family.space._id} onChange={(event) => onSelectFamily(event.target.value as Id<'spaces'>)}>
          {families.map(({ space }) => <option key={space._id} value={space._id}>{space.name}</option>)}
        </select>
        <span className="list-heading">Family chats</span>
        {(rooms ?? []).flatMap(({ room }) => room ? [room] : []).map((room) => (
          <button className={`conversation-link ${room._id === sharedRoom?._id ? 'selected' : ''}`} key={room._id}><i /><span>{room.title}</span></button>
        ))}
        {rooms !== undefined && !sharedRoom && <p className="dark-empty-copy">Your shared family conversation will appear here.</p>}
        <span className="list-heading section-gap">Updates</span>
        <button className="conversation-link"><i /><span>Family inbox</span><b>{inboxItems?.length ?? 0}</b></button>
        <span className="list-heading section-gap">My reading language</span>
        <div className="language-setting"><strong>English</strong><button>Change</button></div>
        <button className="dark-sign-out" onClick={() => void signOut()}><LogOut /> Sign out</button>
      </aside>

      {sharedRoom ? (
        <LiveRoom key={sharedRoom._id} room={sharedRoom} family={family} families={families} onSelectFamily={onSelectFamily} onExit={onExit} onInvite={family.membership.role === 'owner' ? () => setMembersOpen(true) : undefined} />
      ) : (
        <section className="conversation-pane"><header className="conversation-header"><div><h2>{family.space.name}</h2><p>Live · private family data</p></div></header><div className="dark-empty-state"><MessageSquareText /><h2>Your family conversation is getting ready</h2><p>Reload in a moment. New family spaces automatically receive a shared room.</p></div></section>
      )}

      <aside className="conversation-context live-context">
        <div className="context-title"><h2>This family</h2><button onClick={onExit}>Switch mode</button></div>
        <section><span>Privacy</span><p className="confirmed"><ShieldCheck /> Live, authorized family data</p></section>
        <section><span>Family inbox</span>{family.space.agentmailInboxId
          ? <p className="confirmed"><Check /> AgentMail is connected</p>
          : family.membership.role === 'owner'
            ? <ConnectInbox spaceId={family.space._id} />
            : <p>Ask a family owner to connect AgentMail.</p>}</section>
        {family.membership.role === 'owner' && <section><span>Family members</span><InviteMember spaceId={family.space._id} /></section>}
        <section><span>Recent updates</span>{(inboxItems ?? []).slice(0, 3).map((item) => <div className="context-inbox-item" key={item._id}><strong>{item.subject}</strong><small>{displaySender(item.sender)} · {categoryLabel(item.category)}</small></div>)}{inboxItems?.length === 0 && <p>No family mail yet.</p>}</section>
      </aside>
      {membersOpen && <div className="family-dialog-backdrop" role="presentation" onMouseDown={() => setMembersOpen(false)}><section className="family-dialog" role="dialog" aria-modal="true" aria-labelledby="invite-dialog-title" onMouseDown={event => event.stopPropagation()}><header><div><span>Family access</span><h2 id="invite-dialog-title">Invite someone to {family.space.name}</h2></div><button type="button" onClick={() => setMembersOpen(false)} aria-label="Close invitations" autoFocus><X /></button></header><p>They must sign in using the same email address. Invitations expire after seven days.</p><InviteMember spaceId={family.space._id} /></section></div>}
    </main>
  )
}

function LiveRoom({ room, family, families, onSelectFamily, onExit, onInvite }: {
  room: Doc<'rooms'>
  family: FamilyRow
  families: FamilyRow[]
  onSelectFamily: (spaceId: Id<'spaces'>) => void
  onExit: () => void
  onInvite?: () => void
}) {
  const messages = useQuery(api.rooms.messages, { roomId: room._id, limit: 40 })
  const generatedImages = useQuery(api.images.forRoom, { roomId: room._id, limit: 20 })
  const attachments = useQuery(api.attachments.forRoom, { roomId: room._id, limit: 40 })
  const saathi = useQuery(api.agents.forRoom, { roomId: room._id })
  const postMessage = useMutation(api.messages.post)
  const retrySaathi = useMutation(api.agents.send)
  const generateAttachmentUploadUrl = useMutation(api.attachments.generateUploadUrl)
  const submitAttachment = useMutation(api.attachments.submit)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const [error, setError] = useState('')
  const [uploads, setUploads] = useState<PendingUpload[]>([])
  const [dragActive, setDragActive] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dragDepthRef = useRef(0)
  const feedEndRef = useRef<HTMLDivElement>(null)
  const activeJob = saathi?.jobs.find((job) => job.status === 'running') ?? saathi?.jobs.find((job) => job.status === 'queued')
  const failedJob = saathi?.jobs[0]?.status === 'failed' ? saathi.jobs[0] : null
  const attachmentMessageIds = useMemo(() => new Set((attachments ?? []).map((item) => item.messageId)), [attachments])
  const voice = useLiveVoice(room._id)
  const timeline = useMemo(() => [
    ...(messages ?? []).filter((item) => !attachmentMessageIds.has(item._id)).map((item) => ({ kind: 'message' as const, createdAt: item.createdAt, item })),
    ...(generatedImages ?? []).map((item) => ({ kind: 'image' as const, createdAt: item.createdAt, item })),
    ...(attachments ?? []).map((item) => ({ kind: 'attachment' as const, createdAt: item.createdAt, item })),
  ].sort((left, right) => left.createdAt - right.createdAt), [messages, generatedImages, attachments, attachmentMessageIds])

  useEffect(() => {
    feedEndRef.current?.scrollIntoView({ block: 'end' })
  }, [messages?.length, generatedImages?.length, attachments?.length, activeJob?.responseText, activeJob?.status])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const text = message.trim()
    if (!text) return
    setBusy(true)
    setError('')
    try {
      await postMessage({ roomId: room._id, text, language: 'en', clientOperationId: crypto.randomUUID().replaceAll('-', '') })
      setMessage('')
    } catch {
      setError('Your message could not be shared. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
    event.preventDefault()
    event.currentTarget.form?.requestSubmit()
  }

  const addSaathiMention = () => {
    setMessage((current) => /@saathi\b/i.test(current) ? current : `${current}${current && !current.endsWith(' ') ? ' ' : ''}@saathi `)
    requestAnimationFrame(() => textareaRef.current?.focus())
  }

  const retryFailedResponse = async () => {
    if (!saathi || !failedJob) return
    setRetrying(true)
    setError('')
    try {
      await retrySaathi({
        agentId: saathi.agent._id,
        prompt: failedJob.prompt,
        clientOperationId: crypto.randomUUID().replaceAll('-', ''),
      })
    } catch {
      setError('Saathi could not retry that response. Please try again.')
    } finally {
      setRetrying(false)
    }
  }

  const uploadFiles = async (files: File[]) => {
    for (const file of files) {
      const id = crypto.randomUUID()
      const mediaType = attachmentMediaType(file)
      if (file.size <= 0 || file.size > MAX_ATTACHMENT_BYTES) {
        setUploads((current) => [...current, { id, name: file.name, status: 'error', message: 'Files must be smaller than 20 MB.' }])
        continue
      }
      if (!SUPPORTED_ATTACHMENT_TYPES.has(mediaType)) {
        setUploads((current) => [...current, { id, name: file.name, status: 'error', message: 'Choose an image, PDF, text file, or Office document.' }])
        continue
      }
      setUploads((current) => [...current, { id, name: file.name, status: 'uploading' }])
      try {
        const uploadUrl = await generateAttachmentUploadUrl({ roomId: room._id })
        const response = await fetch(uploadUrl, {
          method: 'POST',
          headers: { 'Content-Type': mediaType },
          body: file,
        })
        if (!response.ok) throw new Error('upload failed')
        const payload: unknown = await response.json()
        if (!payload || typeof payload !== 'object' || typeof (payload as { storageId?: unknown }).storageId !== 'string') throw new Error('invalid upload')
        await submitAttachment({
          roomId: room._id,
          storageId: (payload as { storageId: Id<'_storage'> }).storageId,
          fileName: file.name,
          mediaType,
          clientOperationId: id.replaceAll('-', ''),
        })
        setUploads((current) => current.filter((upload) => upload.id !== id))
      } catch {
        setUploads((current) => current.map((upload) => upload.id === id
          ? { ...upload, status: 'error', message: 'Could not upload this file. Check its type and try again.' }
          : upload))
      }
    }
  }

  const chooseFiles = (files: FileList | null) => {
    if (!files?.length) return
    void uploadFiles(Array.from(files))
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleDragEnter = (event: DragEvent<HTMLElement>) => {
    if (!event.dataTransfer.types.includes('Files')) return
    event.preventDefault()
    dragDepthRef.current += 1
    setDragActive(true)
  }

  const handleDragLeave = (event: DragEvent<HTMLElement>) => {
    if (!event.dataTransfer.types.includes('Files')) return
    event.preventDefault()
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
    if (dragDepthRef.current === 0) setDragActive(false)
  }

  const handleDrop = (event: DragEvent<HTMLElement>) => {
    if (!event.dataTransfer.files.length) return
    event.preventDefault()
    dragDepthRef.current = 0
    setDragActive(false)
    chooseFiles(event.dataTransfer.files)
  }

  return (
    <section className={`conversation-pane ${dragActive ? 'is-dragging-files' : ''}`} onDragEnter={handleDragEnter} onDragOver={(event) => event.dataTransfer.types.includes('Files') && event.preventDefault()} onDragLeave={handleDragLeave} onDrop={handleDrop}>
      {dragActive && <div className="file-drop-overlay" role="status"><Upload /><strong>Drop files to share</strong><span>Photos and documents up to 20 MB</span></div>}
      <header className="conversation-header live-room-header">
        <button className="mobile-chat-back" onClick={onExit} aria-label="Back"><ArrowLeft /></button>
        <div><div className="title-line"><h2>{room.title}</h2><span className="live-label"><LockKeyhole /> Live</span></div><p>{family.space.name} · private family conversation</p></div>
        <div className="room-header-actions">{onInvite && <button type="button" className="header-invite" onClick={onInvite}><UserPlus /><span>Invite</span></button>}<div className="participant-stack"><span>YOU</span><span>F</span><span className="saathi-participant" title="Mention @saathi to ask the assistant">S</span></div></div>
        <select className="mobile-family-switcher" aria-label="Current family" value={family.space._id} onChange={(event) => onSelectFamily(event.target.value as Id<'spaces'>)}>{families.map(({ space }) => <option value={space._id} key={space._id}>{space.name}</option>)}</select>
      </header>
      <div className="conversation-feed live-feed">
        {messages === undefined && <div className="dark-loading"><i /><i /><i /></div>}
        {messages && generatedImages && attachments && timeline.length === 0 && <div className="dark-empty-state compact"><Sparkles /><h2>Start with what your family needs to decide</h2><p>Write to your family, share a file, or mention <strong>@saathi</strong> when you want help.</p></div>}
        {timeline.map((entry) => entry.kind === 'image'
          ? entry.item.url && <article className="person-message assistant-message generated-image-message" key={`image-${entry.item._id}`}>
              <span className="message-avatar assistant"><Bot /></span>
              <div><h3>Saathi <small>· generated image</small></h3><figure className="generated-image-card"><img src={entry.item.url} alt={entry.item.prompt} onLoad={() => feedEndRef.current?.scrollIntoView({ block: 'end' })} /><figcaption>{entry.item.prompt}</figcaption></figure></div>
            </article>
          : entry.kind === 'attachment'
            ? <article className="outgoing-message attachment-message" key={`attachment-${entry.item._id}`}>
                <span>You · {formatRelativeTime(entry.item.createdAt)}</span>
                {entry.item.mediaType.startsWith('image/') && entry.item.url
                  ? <a className="shared-image" href={entry.item.url} target="_blank" rel="noreferrer"><img src={entry.item.url} alt={entry.item.fileName} /><small>{entry.item.fileName} · {formatFileSize(entry.item.sizeBytes)}</small></a>
                  : <a className="shared-document" href={entry.item.url ?? undefined} target="_blank" rel="noreferrer" aria-disabled={!entry.item.url}><FileText /><span><strong>{entry.item.fileName}</strong><small>{formatFileSize(entry.item.sizeBytes)}</small></span></a>}
              </article>
          : entry.item.actorType === 'voice_transcript'
            ? entry.item.voiceSpeaker === 'user'
              ? <article className="outgoing-message saved-voice-transcript" key={`message-${entry.item._id}`}><span>You · voice transcript · {formatRelativeTime(entry.item.createdAt)}</span><p>{entry.item.originalText}</p></article>
              : <article className="person-message assistant-message saved-voice-transcript" key={`message-${entry.item._id}`}><span className="message-avatar assistant"><Bot /></span><div><h3>Saathi <small>· voice transcript · {formatRelativeTime(entry.item.createdAt)}</small></h3><div className="assistant-card"><p>{entry.item.originalText}</p></div></div></article>
            : entry.item.actorType === 'user'
            ? <article className="outgoing-message" key={`message-${entry.item._id}`}><span>You · {formatRelativeTime(entry.item.createdAt)}</span><p>{entry.item.originalText}</p></article>
            : <article className={`person-message ${entry.item.actorType === 'assistant' ? 'assistant-message' : ''}`} key={`message-${entry.item._id}`}>
                <span className={`message-avatar ${entry.item.actorType === 'assistant' ? 'assistant' : 'email'}`}>{entry.item.actorType === 'assistant' ? 'S' : <Mail />}</span>
                <div><h3>{entry.item.actorType === 'assistant' ? 'Saathi' : 'Email guest'} <small>· {formatRelativeTime(entry.item.createdAt)}</small></h3><div className={entry.item.actorType === 'assistant' ? 'assistant-card' : 'simple-message'}>{entry.item.actorType === 'assistant' ? <AssistantText text={entry.item.originalText} /> : <p>{entry.item.originalText}</p>}</div></div>
              </article>)}
        {voice.turns.map((turn, index) => turn.role === 'user'
          ? <article className="outgoing-message live-voice-transcript" key={`live-user-${turn.startMs}-${index}`}><span>You · speaking now</span><p>{turn.text}<i className="transcript-cursor" /></p></article>
          : <article className="person-message assistant-message live-voice-transcript" key={`live-assistant-${turn.startMs}-${index}`}><span className="message-avatar assistant"><Bot /></span><div><h3>Saathi <small>· speaking now</small></h3><div className="assistant-card"><p>{turn.text}<i className="transcript-cursor" /></p></div></div></article>)}
        {activeJob?.trigger === 'ambient' && !activeJob.responseText && (
          <div className="ambient-check" role="status"><Sparkles /> Saathi is checking whether help is needed…</div>
        )}
        {activeJob && (activeJob.trigger !== 'ambient' || activeJob.responseText) && (
          <article className="person-message assistant-message saathi-stream" aria-live="polite">
            <span className="message-avatar assistant"><Bot /></span>
            <div>
              <h3>Saathi <small>· {activeJob.status === 'queued' ? 'getting ready' : activeJob.activity === 'searching_web' ? 'searching the web' : activeJob.activity === 'generating_image' ? 'creating an image' : activeJob.responseText ? 'typing' : 'thinking'}</small></h3>
              <div className="assistant-card streaming-card">
                {activeJob.responseText
                  ? <div className="streaming-markdown"><AssistantText text={activeJob.responseText} /></div>
                  : <div className="typing-indicator" aria-label={activeJob.status === 'queued' ? 'Saathi is getting ready' : 'Saathi is thinking'}><i /><i /><i /></div>}
              </div>
            </div>
          </article>
        )}
        {failedJob && failedJob.trigger !== 'ambient' && !activeJob && (
          <article className="person-message assistant-message saathi-failed" role="status">
            <span className="message-avatar assistant"><Bot /></span>
            <div><h3>Saathi <small>· couldn’t respond</small></h3><div className="assistant-card"><p>Something interrupted that response.</p><button type="button" onClick={() => void retryFailedResponse()} disabled={retrying}>{retrying ? 'Retrying…' : 'Try again'}</button></div></div>
          </article>
        )}
        <div ref={feedEndRef} />
      </div>
      <footer className="conversation-composer">
        {uploads.length > 0 && <div className="upload-queue" aria-live="polite">{uploads.map((upload) => <div className={upload.status} key={upload.id}>{upload.status === 'uploading' ? <span className="upload-spinner" /> : <FileText />}<span><strong>{upload.name}</strong><small>{upload.status === 'uploading' ? 'Uploading…' : upload.message}</small></span>{upload.status === 'error' && <button type="button" onClick={() => setUploads((current) => current.filter((item) => item.id !== upload.id))} aria-label={`Dismiss ${upload.name}`}><X /></button>}</div>)}</div>}
        <div className="composer-guidance">
          <div className="composer-guidance-actions">
            <button type="button" onClick={addSaathiMention}><AtSign /> Ask Saathi</button>
            {voice.status === 'idle' || voice.status === 'ended' || voice.status === 'error'
              ? <button type="button" className="voice-start" onClick={() => void voice.start()}><Mic /> Talk to Saathi</button>
              : <><button type="button" className={voice.status === 'muted' ? 'voice-muted' : ''} onClick={voice.toggleMute} disabled={voice.status === 'requesting' || voice.status === 'connecting' || voice.status === 'ending'}>{voice.status === 'muted' ? <MicOff /> : <Mic />} {voice.status === 'requesting' ? 'Allow microphone…' : voice.status === 'connecting' ? 'Connecting…' : voice.status === 'muted' ? 'Unmute' : 'Mute'}</button><button type="button" className="voice-end" onClick={voice.end} disabled={voice.status === 'ending'}><PhoneOff /> {voice.status === 'ending' ? 'Ending…' : 'End'}</button></>}
          </div>
          <span>{voice.status === 'live' ? 'Voice is live · transcript appears here' : 'Enter to send · Drop photos or documents here'}</span>
        </div>
        <form onSubmit={submit}>
          <input ref={fileInputRef} className="visually-hidden" type="file" accept={ACCEPTED_ATTACHMENTS} multiple onChange={(event) => chooseFiles(event.target.files)} />
          <textarea ref={textareaRef} value={message} onChange={(event) => setMessage(event.target.value)} onKeyDown={handleComposerKeyDown} placeholder="Message your family or type @saathi…" aria-label="Message for your family" rows={1} />
          <button className="composer-attachment" type="button" onClick={() => fileInputRef.current?.click()} aria-label="Attach photos or documents"><Paperclip /></button>
          <button className="composer-mention" type="button" onClick={addSaathiMention} aria-label="Mention Saathi"><AtSign /></button>
          <button className="composer-send" type="submit" disabled={busy || !message.trim()}>{busy ? 'Sending…' : 'Send'} <Send /></button>
        </form>
        {error && <p className="dark-form-error" role="alert">{error}</p>}
        {voice.error && <p className="dark-form-error" role="alert">{voice.error}</p>}
      </footer>
    </section>
  )
}

function AssistantText({ text }: { text: string }) {
  return <div className="assistant-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{
    a: ({ href, children }) => href?.startsWith('https://')
      ? <a href={href} target="_blank" rel="noreferrer">{children}</a>
      : <span>{children}</span>,
  }}>{text}</ReactMarkdown></div>
}

function ConnectInbox({ spaceId }: { spaceId: Id<'spaces'> }) {
  const createInbox = useAction(api.agentmailInboxes.createForFamily)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await createInbox({ spaceId })
    } catch (caught) {
      const code = convexErrorCode(caught)
      setError(code === 'AGENTMAIL_PERMISSION'
        ? 'The AgentMail key needs organization-level inbox creation access.'
        : code === 'AGENTMAIL_AUTH'
          ? 'AgentMail rejected the configured API key.'
          : code === 'AGENTMAIL_RATE_LIMIT'
            ? 'AgentMail is busy. Please wait a moment and try again.'
            : 'We could not create the inbox. Check AgentMail setup and try again.')
      setBusy(false)
    }
  }

  return <form className="dark-connect-card" onSubmit={submit}><label><Settings2 /> Family email inbox</label><p>Create a private email address for this family.</p><button type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create inbox'}</button>{error && <small role="alert">{error}</small>}</form>
}

function InviteMember({ spaceId }: { spaceId: Id<'spaces'> }) {
  const invitations = useQuery(api.invitations.list, { spaceId })
  const createInvitation = useAction(api.invitations.createAndSend)
  const revokeInvitation = useMutation(api.invitations.revoke)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'member' | 'owner'>('member')
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState('')

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setFeedback('')
    try {
      await createInvitation({ spaceId, targetEmail: email, role, clientOperationId: crypto.randomUUID().replaceAll('-', '') })
      setEmail('')
      setFeedback('Invitation sent. They can join after signing in with that email.')
    } catch (error) {
      setFeedback(convexErrorCode(error) === 'RATE_LIMITED'
        ? 'Too many invitations were sent. Please wait and try again.'
        : 'The invitation could not be sent. Check the email and AgentMail setup.')
    } finally {
      setBusy(false)
    }
  }

  const pending = invitations?.filter(invitation => !invitation.acceptedAt && !invitation.revokedAt && !invitation.expired) ?? []
  return <div className="invite-member-card"><form onSubmit={submit}><label htmlFor={`invite-email-${spaceId}`}><UserPlus /> Invite by email</label><input id={`invite-email-${spaceId}`} type="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="family@example.com" required /><div><select value={role} onChange={event => setRole(event.target.value as 'member' | 'owner')} aria-label="Invitation role"><option value="member">Member</option><option value="owner">Owner</option></select><button type="submit" disabled={busy}>{busy ? 'Sending…' : 'Invite'}</button></div></form>{feedback && <small role="status">{feedback}</small>}{pending.map(invitation => <div className="pending-invitation" key={invitation._id}><span><strong>{invitation.targetEmail}</strong><small>{invitation.role} · expires {new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(invitation.expiresAt)}</small></span><button type="button" onClick={() => void revokeInvitation({ invitationId: invitation._id })}>Revoke</button></div>)}</div>
}

function InvitationError({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  const { signOut } = useAuthActions()
  return <main className="centered-status"><Mail size={34} /><h1>Could not accept invitation</h1><p>{message}</p><div className="status-actions"><button className="primary" onClick={() => void signOut()}>Sign in with another email</button><button className="secondary" onClick={onDismiss}>Open my workspace</button></div></main>
}

function LiveStatus({ message }: { message: string }) {
  return <main className="centered-status"><div className="status-spinner" /><p>{message}</p></main>
}

function initialsFor(value: string) {
  const clean = value.includes('<') ? value.split('<')[0].trim() : value.split('@')[0]
  return clean.split(/\s|[._-]/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'F'
}

function displaySender(value: string) {
  return value.match(/^\s*([^<]+)\s*</)?.[1]?.trim() || value
}

function categoryLabel(category: Doc<'inboxItems'>['category']) {
  return category === 'needs_review' ? 'Needs review' : category.charAt(0).toUpperCase() + category.slice(1)
}

function formatRelativeTime(timestamp: number) {
  const elapsed = Date.now() - timestamp
  if (elapsed < 60_000) return 'Just now'
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)} min`
  if (elapsed < 86_400_000) return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(timestamp)
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(timestamp)
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function attachmentMediaType(file: File) {
  if (file.type) return file.type.split(';', 1)[0].toLowerCase()
  const extension = file.name.split('.').pop()?.toLowerCase()
  return ({
    csv: 'text/csv', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    gif: 'image/gif', heic: 'image/heic', jpeg: 'image/jpeg', jpg: 'image/jpeg', pdf: 'application/pdf',
    png: 'image/png', ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    txt: 'text/plain', webp: 'image/webp', xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  } as Record<string, string>)[extension ?? ''] ?? ''
}

function convexErrorCode(error: unknown) {
  if (!error || typeof error !== 'object' || !('data' in error)) return ''
  const data = (error as { data?: unknown }).data
  return data && typeof data === 'object' && 'code' in data && typeof data.code === 'string' ? data.code : ''
}

function invitationToken() {
  return new URLSearchParams(window.location.search).get('invite')?.trim() ?? ''
}

function clearInvitationToken() {
  const url = new URL(window.location.href)
  url.searchParams.delete('invite')
  window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`)
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}
