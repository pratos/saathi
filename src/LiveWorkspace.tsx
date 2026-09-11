import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { useAuthActions } from '@convex-dev/auth/react'
import { useMutation, useQuery } from 'convex/react'
import {
  ArrowLeft,
  AtSign,
  Bell,
  Bot,
  Check,
  Folder,
  LockKeyhole,
  LogOut,
  Mail,
  MessageSquareText,
  Plus,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'
import { api } from '../convex/_generated/api'
import type { Doc, Id } from '../convex/_generated/dataModel'

type FamilyRow = { membership: Doc<'memberships'>; space: Doc<'spaces'> }

export function LiveWorkspace({ onExit }: { onExit: () => void }) {
  const ensureCurrent = useMutation(api.users.ensureCurrent)
  const spaces = useQuery(api.spaces.mine)
  const [selectedSpaceId, setSelectedSpaceId] = useState<Id<'spaces'> | null>(null)

  useEffect(() => {
    void ensureCurrent({}).catch(() => undefined)
  }, [ensureCurrent])

  const families = useMemo(() => {
    if (!spaces) return []
    return spaces.flatMap((row) => row.space ? [{ membership: row.membership, space: row.space }] : [])
  }, [spaces])

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
  const sharedRoom = rooms?.find(({ room }) => room?.type === 'shared')?.room ?? rooms?.find(({ room }) => room)?.room ?? null
  const initials = initialsFor(user?.displayName ?? user?.name ?? user?.email ?? 'Family member')

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
        <LiveRoom room={sharedRoom} family={family} families={families} onSelectFamily={onSelectFamily} onExit={onExit} />
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
        <section><span>Recent updates</span>{(inboxItems ?? []).slice(0, 3).map((item) => <div className="context-inbox-item" key={item._id}><strong>{item.subject}</strong><small>{displaySender(item.sender)} · {categoryLabel(item.category)}</small></div>)}{inboxItems?.length === 0 && <p>No family mail yet.</p>}</section>
      </aside>
    </main>
  )
}

function LiveRoom({ room, family, families, onSelectFamily, onExit }: {
  room: Doc<'rooms'>
  family: FamilyRow
  families: FamilyRow[]
  onSelectFamily: (spaceId: Id<'spaces'>) => void
  onExit: () => void
}) {
  const messages = useQuery(api.rooms.messages, { roomId: room._id, limit: 40 })
  const saathi = useQuery(api.agents.forRoom, { roomId: room._id })
  const postMessage = useMutation(api.messages.post)
  const retrySaathi = useMutation(api.agents.send)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const [error, setError] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const feedEndRef = useRef<HTMLDivElement>(null)
  const activeJob = saathi?.jobs.find((job) => job.status === 'running') ?? saathi?.jobs.find((job) => job.status === 'queued')
  const failedJob = saathi?.jobs[0]?.status === 'failed' ? saathi.jobs[0] : null

  useEffect(() => {
    feedEndRef.current?.scrollIntoView({ block: 'end' })
  }, [messages?.length, activeJob?.responseText, activeJob?.status])

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

  return (
    <section className="conversation-pane">
      <header className="conversation-header live-room-header">
        <button className="mobile-chat-back" onClick={onExit} aria-label="Back"><ArrowLeft /></button>
        <div><div className="title-line"><h2>{room.title}</h2><span className="live-label"><LockKeyhole /> Live</span></div><p>{family.space.name} · private family conversation</p></div>
        <div className="participant-stack"><span>YOU</span><span>F</span><span className="saathi-participant" title="Mention @saathi to ask the assistant">S</span></div>
        <select className="mobile-family-switcher" aria-label="Current family" value={family.space._id} onChange={(event) => onSelectFamily(event.target.value as Id<'spaces'>)}>{families.map(({ space }) => <option value={space._id} key={space._id}>{space.name}</option>)}</select>
      </header>
      <div className="conversation-feed live-feed">
        {messages === undefined && <div className="dark-loading"><i /><i /><i /></div>}
        {messages && messages.length === 0 && <div className="dark-empty-state compact"><Sparkles /><h2>Start with what your family needs to decide</h2><p>Write to your family, or mention <strong>@saathi</strong> when you want help.</p></div>}
        {messages && [...messages].reverse().map((item) => item.actorType === 'user'
          ? <article className="outgoing-message" key={item._id}><span>You · {formatRelativeTime(item.createdAt)}</span><p>{item.originalText}</p></article>
          : <article className={`person-message ${item.actorType === 'assistant' ? 'assistant-message' : ''}`} key={item._id}>
              <span className={`message-avatar ${item.actorType === 'assistant' ? 'assistant' : 'email'}`}>{item.actorType === 'assistant' ? 'S' : <Mail />}</span>
              <div><h3>{item.actorType === 'assistant' ? 'Saathi' : 'Email guest'} <small>· {formatRelativeTime(item.createdAt)}</small></h3><div className={item.actorType === 'assistant' ? 'assistant-card' : 'simple-message'}><p>{item.originalText}</p></div></div>
            </article>)}
        {activeJob?.trigger === 'ambient' && !activeJob.responseText && (
          <div className="ambient-check" role="status"><Sparkles /> Saathi is checking whether help is needed…</div>
        )}
        {activeJob && (activeJob.trigger !== 'ambient' || activeJob.responseText) && (
          <article className="person-message assistant-message saathi-stream" aria-live="polite">
            <span className="message-avatar assistant"><Bot /></span>
            <div>
              <h3>Saathi <small>· {activeJob.status === 'queued' ? 'getting ready' : activeJob.responseText ? 'typing' : 'thinking'}</small></h3>
              <div className="assistant-card streaming-card">
                {activeJob.responseText
                  ? <p>{activeJob.responseText}<i className="streaming-caret" aria-hidden="true" /></p>
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
        <div className="composer-guidance"><button type="button" onClick={addSaathiMention}><AtSign /> Ask Saathi</button><span>Enter to send · Shift + Enter for a new line</span></div>
        <form onSubmit={submit}>
          <textarea ref={textareaRef} value={message} onChange={(event) => setMessage(event.target.value)} onKeyDown={handleComposerKeyDown} placeholder="Message your family or type @saathi…" aria-label="Message for your family" rows={1} />
          <button className="composer-mention" type="button" onClick={addSaathiMention} aria-label="Mention Saathi"><AtSign /></button>
          <button className="composer-send" type="submit" disabled={busy || !message.trim()}>{busy ? 'Sending…' : 'Send'} <Send /></button>
        </form>
        {error && <p className="dark-form-error" role="alert">{error}</p>}
      </footer>
    </section>
  )
}

function ConnectInbox({ spaceId }: { spaceId: Id<'spaces'> }) {
  const configureInbox = useMutation(api.spaces.configureInbox)
  const [inboxId, setInboxId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await configureInbox({ spaceId, inboxId })
    } catch {
      setError('Check the Inbox ID and try again.')
      setBusy(false)
    }
  }

  return <form className="dark-connect-card" onSubmit={submit}><label htmlFor={`inbox-${spaceId}`}><Settings2 /> Connect AgentMail</label><input id={`inbox-${spaceId}`} value={inboxId} onChange={(event) => setInboxId(event.target.value)} placeholder="Inbox ID" minLength={3} maxLength={200} required /><button type="submit" disabled={busy}>{busy ? 'Connecting…' : 'Connect inbox'}</button>{error && <small role="alert">{error}</small>}</form>
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
