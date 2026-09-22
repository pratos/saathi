import { useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent, type KeyboardEvent } from 'react'
import { useAuthActions } from '@convex-dev/auth/react'
import { ThinkingState } from '@aicss/react/thinking-state'
import { useAction, useMutation, useQuery } from 'convex/react'
import type { FunctionReturnType } from 'convex/server'
import DOMPurify from 'dompurify'
import { AnimatePresence, LazyMotion, domAnimation, m, useReducedMotion } from 'motion/react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  ArrowLeft,
  ArrowRight,
  AudioLines,
  Bell,
  Bot,
  Camera,
  Check,
  Copy,
  FileText,
  Folder,
  Image as ImageIcon,
  KeyRound,
  LockKeyhole,
  LogOut,
  Mail,
  MailOpen,
  MessageSquareText,
  Mic,
  MicOff,
  Monitor,
  Paperclip,
  PhoneOff,
  Plus,
  RefreshCcw,
  RefreshCw,
  Search,
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
import { IMAGE_PRESET_GROUPS, IMAGE_PRESETS } from '../convex/lib/imageSafety'
import { Badge } from './components/ui/badge'
import { Button } from './components/ui/button'
import { Card } from './components/ui/card'
import { Checkbox } from './components/ui/checkbox'
import { Input } from './components/ui/input'
import { Label } from './components/ui/label'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from './components/ui/select'
import { Textarea } from './components/ui/textarea'
import { AdminDashboard } from './AdminDashboard'
import { VoiceBlob } from './VoiceBlob'
import { emailBodyHtml } from './emailFormatting'
import { useLiveVoice, type VoiceStatus, type VoiceToolActivity, type VoiceTurn } from './useLiveVoice'
import './LiveTools.css'
import './Access.css'
import './WorkspaceModern.css'

type FamilyRow = { membership: Doc<'memberships'>; space: Doc<'spaces'> }
type PendingUpload = { id: string; name: string; status: 'uploading' | 'error'; message?: string }
type ConversationUiAction = NonNullable<Doc<'messages'>['uiActions']>[number]
type MentionCandidate =
  | { kind: 'assistant'; username: 'saathi'; label: string }
  | { kind: 'person'; username: string; label: string; userId: Id<'users'> }

const ACCEPTED_ATTACHMENTS = 'image/jpeg,image/png,image/webp,image/gif,image/heic,application/pdf,text/plain,text/csv,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation'
const SUPPORTED_ATTACHMENT_TYPES = new Set(ACCEPTED_ATTACHMENTS.split(','))
const MAX_IMAGE_BYTES = 20 * 1024 * 1024
const MAX_DOCUMENT_BYTES = 50 * 1024 * 1024

export function LiveWorkspace({ onExit }: { onExit: () => void }) {
  const ensureCurrent = useMutation(api.users.ensureCurrent)
  const acceptInvitation = useMutation(api.invitations.accept)
  const currentUser = useQuery(api.users.current)
  const adminRole = useQuery(api.admin.currentRole)
  const spaces = useQuery(api.spaces.mine)
  const [selectedSpaceId, setSelectedSpaceId] = useState<Id<'spaces'> | null>(() => gmailSpaceFromUrl())
  const [invitationState, setInvitationState] = useState<'idle' | 'accepting' | 'error'>(() => invitationToken() ? 'accepting' : 'idle')
  const [invitationError, setInvitationError] = useState('')

  useEffect(() => {
    void ensureCurrent({}).catch(() => undefined)
  }, [ensureCurrent])

  useEffect(() => {
    const token = invitationToken()
    if (!token || invitationState !== 'accepting' || !currentUser?.username) return
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
  }, [acceptInvitation, currentUser?.username, invitationState])

  const families = useMemo(() => {
    if (!spaces) return []
    return spaces.flatMap((row) => row.space ? [{ membership: row.membership, space: row.space }] : [])
  }, [spaces])

  if (currentUser === undefined || adminRole === undefined) return <LiveStatus message="Preparing your Saathi profile…" />
  if (adminModeFromUrl() && adminRole.isSuperadmin) return <AdminDashboard onClose={closeAdminDashboard} />
  if (!currentUser.username) return <UsernameSetup onExit={onExit} />
  if (invitationState === 'accepting') return <LiveStatus message="Adding you to the invited family…" />
  if (invitationState === 'error') return <InvitationError message={invitationError} onDismiss={() => { clearInvitationToken(); setInvitationState('idle') }} />
  if (spaces === undefined) return <LiveStatus message="Loading your private family spaces…" />
  if (families.length === 0) return <CreateFirstFamily onExit={onExit} isSuperadmin={adminRole.isSuperadmin} />

  const family = families.find(({ space }) => space._id === selectedSpaceId) ?? families[0]
  return <FamilyAccessEntry families={families} family={family} onSelectFamily={setSelectedSpaceId} onExit={onExit} />
}

function FamilyAccessEntry({ families, family, onSelectFamily, onExit }: {
  families: FamilyRow[]
  family: FamilyRow
  onSelectFamily: (spaceId: Id<'spaces'>) => void
  onExit: () => void
}) {
  const access = useQuery(api.spaces.aiAccess, { spaceId: family.space._id })
  if (access === undefined) return <LiveStatus message="Checking AI access…" />
  if (!access.ready) return <AiAccessSetup family={family} access={access} onExit={onExit} />
  return <LiveFamilyShell families={families} family={family} onSelectFamily={onSelectFamily} onExit={onExit} isSuperadmin={access.isSuperadmin} accessSource={access.source} />
}

function AiAccessSetup({ family, access, onExit }: {
  family: FamilyRow
  access: FunctionReturnType<typeof api.spaces.aiAccess>
  onExit: () => void
}) {
  const saveKey = useMutation(api.spaces.saveProviderKey)
  const requestAccess = useMutation(api.users.requestAccess)
  const [openRouterKey, setOpenRouterKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState('')

  const saveKeys = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setFeedback('')
    try {
      await saveKey({ spaceId: family.space._id, provider: 'openrouter', secret: openRouterKey })
      setFeedback('Key saved. Opening your family workspace…')
    } catch {
      setFeedback('A key could not be saved. Check it and try again.')
      setBusy(false)
    }
  }

  const request = async () => {
    setBusy(true)
    setFeedback('')
    try {
      await requestAccess({})
      setFeedback('Request sent. You can sign in anytime to check your access.')
    } catch {
      setFeedback('Your request could not be sent. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  if (access.status === 'blocked') return <main className="onboarding-page"><section className="onboarding-card access-setup-card">
    <Badge className="mode-badge live"><ShieldCheck size={15} /> Account access</Badge>
    <h1>This account is not enabled</h1>
    <p>Contact the person running this Saathi deployment if you think this is a mistake.</p>
    <Button className="secondary large" onClick={onExit}><ArrowLeft /> Leave live mode</Button>
  </section></main>

  return <main className="onboarding-page access-onboarding">
    <Button variant="bare" size="content" className="back-link" onClick={onExit}><ArrowLeft /> Leave live mode</Button>
    <section className="onboarding-card access-setup-card">
      <Badge className="mode-badge live"><KeyRound size={15} /> Choose your AI access</Badge>
      <h1>Bring your keys or request access</h1>
      <p>Your OpenRouter key unlocks chat, images, and structured decisions for <strong>{family.space.name}</strong>. Or request managed access from this deployment's administrator.</p>
      {family.membership.role === 'owner' ? <form onSubmit={saveKeys} className="onboarding-key-form">
        <label htmlFor="onboarding-openrouter">OpenRouter API key <small>required for BYOK</small></label>
        <Input id="onboarding-openrouter" type="password" autoComplete="off" value={openRouterKey} onChange={event => setOpenRouterKey(event.target.value)} placeholder="sk-or-…" required />
        <Button className="primary large" type="submit" disabled={busy || openRouterKey.trim().length < 20}>{busy ? 'Saving securely…' : 'Save key and start'} <ArrowRight /></Button>
      </form> : <p className="form-notice">Ask a family owner to add an OpenRouter key, or request deployment access below.</p>}
      <div className="access-divider"><span>or</span></div>
      <Button className="secondary large" onClick={() => void request()} disabled={busy || access.requestedAt !== null}>{access.requestedAt ? 'Access requested' : 'Request access from the administrator'}</Button>
      {feedback && <p className="form-notice" role="status">{feedback}</p>}
      <ModelCatalog />
      <div className="security-note"><ShieldCheck /><span><strong>Encrypted and private</strong>Keys are encrypted at rest, never returned to the browser, and shared only inside this family.</span></div>
    </section>
  </main>
}

function ModelCatalog() {
  return <details className="onboarding-models"><summary>Models used by this build</summary><ul>
    <li><strong>Chat:</strong> DeepSeek V4.1 Flash, GPT-5.6 Luna, Grok 4.6, or GPT-5.6 Sol through OpenRouter</li>
    <li><strong>Images:</strong> Meta Muse Image through OpenRouter</li>
    <li><strong>Voice:</strong> GPT Live 1 with GPT-5 mini delegation through OpenAI</li>
    <li><strong>Email and photo extraction:</strong> GPT-5 mini through OpenAI</li>
    <li><strong>Routing and safety:</strong> your selected OpenRouter model for BYOK, or TypeSafe System One for managed access</li>
  </ul></details>
}

function UsernameSetup({ onExit }: { onExit: () => void }) {
  const setUsername = useMutation(api.users.setUsername)
  const [username, setUsernameDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await setUsername({ username })
    } catch (caught) {
      const code = convexErrorCode(caught)
      setError(code === 'USERNAME_TAKEN'
        ? 'That username is already being used. Try another one.'
        : code === 'USERNAME_RESERVED'
          ? 'That username is kept for Saathi. Try another one.'
          : 'Start with a letter and use 3–24 letters, numbers, or underscores.')
      setBusy(false)
    }
  }

  return <main className="onboarding-page username-onboarding">
    <Button variant="bare" size="content" className="back-link" onClick={onExit}><ArrowLeft /> Leave live mode</Button>
    <section className="onboarding-card">
      <Badge className="mode-badge live"><MessageSquareText size={15} /> One last step</Badge>
      <h1>How should your family tag you?</h1>
      <p>Choose a short username for family chats. People can type it after @ when they want your attention.</p>
      <form onSubmit={submit}>
        <label htmlFor="username">Your username</label>
        <div className="username-field"><span aria-hidden="true">@</span><Input id="username" value={username} onChange={event => setUsernameDraft(event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))} placeholder="priya_shah" minLength={3} maxLength={24} pattern="[a-z][a-z0-9_]{2,23}" autoComplete="username" required autoFocus /></div>
        <small className="username-help">Start with a letter. Use letters, numbers, or underscores.</small>
        <Button className="primary large" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Continue to chat'} <ArrowRight /></Button>
      </form>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="security-note"><ShieldCheck /><span><strong>Visible only where you belong</strong>Your username appears to people in your shared family chats.</span></div>
    </section>
  </main>
}

function CreateFirstFamily({ onExit, isSuperadmin = false }: { onExit: () => void; isSuperadmin?: boolean }) {
  const createSpace = useMutation(api.spaces.create)
  const createInbox = useAction(api.agentmailInboxes.createForFamily)
  const [name, setName] = useState('')
  const [wantInbox, setWantInbox] = useState(true)
  const [alias, setAlias] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const spaceId = await createSpace({ name, creationKey: crypto.randomUUID().replaceAll('-', '') })
      if (wantInbox) {
        try {
          await createInbox({ spaceId, username: alias.trim() || undefined })
        } catch (caught) {
          setError(familyInboxError(caught))
        }
      }
    } catch {
      setError('We could not create this family space. Please try again.')
      setBusy(false)
    }
  }

  return (
    <main className="onboarding-page">
      <Button variant="bare" size="content" className="back-link" onClick={onExit}><ArrowLeft /> Leave live mode</Button>
      <section className="onboarding-card">
        <Badge className="mode-badge live"><LockKeyhole size={15} /> Live workspace</Badge>
        <h1>Create your first family space</h1>
        <p>Each family keeps its conversations, inbox, members, and Saathi context separate.</p>
        <form onSubmit={submit}>
          <label htmlFor="family-name">What should we call this family?</label>
          <Input id="family-name" value={name} onChange={(event) => { setName(event.target.value); if (!alias || alias === suggestFamilyAliasFromName(name)) setAlias(suggestFamilyAliasFromName(event.target.value)) }} placeholder="For example, Parents’ home" minLength={2} maxLength={80} required autoFocus />
          <Label className="alias-toggle" htmlFor="first-family-inbox"><Checkbox id="first-family-inbox" checked={wantInbox} onCheckedChange={checked => setWantInbox(checked === true)} /> Create a family email address</Label>
          {wantInbox && <FamilyAliasFields alias={alias} onAlias={setAlias} />}
          <Button className="primary large" type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create private family space'} <Plus /></Button>
        </form>
        {error && <p className="form-error" role="alert">{error}</p>}
        {isSuperadmin && <Button className="secondary large" type="button" onClick={openAdminDashboard}><ShieldCheck /> Open superadmin dashboard</Button>}
        <div className="security-note"><ShieldCheck /><span><strong>Separate by default</strong>You can belong to multiple families without sharing information between them.</span></div>
      </section>
    </main>
  )
}

function LiveFamilyShell({ families, family, onSelectFamily, onExit, isSuperadmin, accessSource }: {
  families: FamilyRow[]
  family: FamilyRow
  onSelectFamily: (spaceId: Id<'spaces'>) => void
  onExit: () => void
  isSuperadmin: boolean
  accessSource: 'byok' | 'platform' | 'none'
}) {
  const reduceMotion = useReducedMotion()
  const { signOut } = useAuthActions()
  const user = useQuery(api.users.current)
  const rooms = useQuery(api.rooms.list, { spaceId: family.space._id })
  const ensurePersonalRoom = useMutation(api.rooms.ensurePersonal)
  const inboxItems = useQuery(api.inbox.list, { spaceId: family.space._id, limit: 20 })
  const gmailConnections = useQuery(api.gmailData.mine, { spaceId: family.space._id })
  const reusableGmail = useQuery(api.gmailData.reusable, { spaceId: family.space._id })
  const enableGmailHere = useMutation(api.gmailData.enableForSpace)
  const disableGmailHere = useMutation(api.gmailData.disableForSpace)
  const beginGmailConnection = useAction(api.gmail.beginConnection)
  const confirmGmailConnection = useAction(api.gmail.confirmConnection)
  const checkGmailNow = useAction(api.gmail.checkNow)
  const [membersOpen, setMembersOpen] = useState(false)
  const [selectedRoomId, setSelectedRoomId] = useState<Id<'rooms'> | null>(null)
  const [gmailBusy, setGmailBusy] = useState(false)
  const [gmailMessage, setGmailMessage] = useState('')
  const [pane, setPane] = useState<'chats' | 'updates' | 'files' | 'family'>('chats')
  const [mobileNav, setMobileNav] = useState<'home' | 'detail'>('home')
  const [copiedInbox, setCopiedInbox] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [createFamilyOpen, setCreateFamilyOpen] = useState(false)
  const [jevOpen, setJevOpen] = useState(false)
  const createSpace = useMutation(api.spaces.create)
  const ownedFamilyCount = families.filter(row => row.membership.role === 'owner').length
  const spaceFiles = useQuery(api.attachments.forSpace, { spaceId: family.space._id, limit: 40 })
  const saveProfile = useMutation(api.users.ensureCurrent)
  const gmailCallbackHandled = useRef(false)
  const sharedRoom = rooms?.find(({ room }) => room?.type === 'shared')?.room ?? rooms?.find(({ room }) => room)?.room ?? null
  const personalRoom = rooms?.find(({ room }) => room?.type === 'private')?.room ?? null
  const selectedRoom = rooms?.flatMap(({ room }) => room ? [room] : []).find(room => room._id === selectedRoomId) ?? sharedRoom
  const initials = initialsFor(user?.displayName ?? user?.name ?? user?.email ?? 'Family member')

  useEffect(() => {
    if (rooms === undefined || personalRoom) return
    void ensurePersonalRoom({ spaceId: family.space._id }).catch(() => undefined)
  }, [ensurePersonalRoom, family.space._id, personalRoom, rooms])

  useEffect(() => {
    const callback = gmailCallbackFromUrl()
    if (!callback || callback.spaceId !== family.space._id || gmailCallbackHandled.current) return
    gmailCallbackHandled.current = true
    if (callback.status !== 'success' || !callback.connectedAccountId) {
      // oxlint-disable-next-line react/set-state-in-effect -- The OAuth return URL is the external state being synchronized.
      setGmailMessage('Gmail was not connected. You can try again.')
      clearGmailCallback()
      return
    }
    // oxlint-disable-next-line react/set-state-in-effect -- The OAuth return URL is the external state being synchronized.
    setGmailBusy(true)
    setGmailMessage('Finishing Gmail setup…')
    void confirmGmailConnection({ spaceId: family.space._id, connectedAccountId: callback.connectedAccountId })
      .then(() => setGmailMessage('Gmail connected. Saathi is privately reviewing the last 30 days.'))
      .catch(() => setGmailMessage('Gmail connected at Google, but Saathi could not finish setup. Please try again.'))
      .finally(() => { setGmailBusy(false); clearGmailCallback() })
  }, [confirmGmailConnection, family.space._id])

  const connectGmail = async () => {
    setGmailBusy(true)
    setGmailMessage('Opening Google sign-in…')
    try {
      const { redirectUrl } = await beginGmailConnection({ spaceId: family.space._id })
      window.location.assign(redirectUrl)
    } catch (caught) {
      setGmailBusy(false)
      setGmailMessage(convexErrorCode(caught) === 'COMPOSIO_NOT_CONFIGURED'
        ? 'Gmail connections need a Composio API key on this deployment.'
        : 'Could not start Gmail connection. Please try again.')
    }
  }

  useEffect(() => {
    if (!membersOpen) return
    const closeOnEscape = (event: globalThis.KeyboardEvent) => event.key === 'Escape' && setMembersOpen(false)
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [membersOpen])

  const openHome = () => {
    setPane('chats')
    setMobileNav('home')
  }
  const openRoom = (roomId: Id<'rooms'>) => {
    setSelectedRoomId(roomId)
    setPane('chats')
    setMobileNav('detail')
  }
  const openPane = (next: 'updates' | 'files' | 'family') => {
    setPane(next)
    setMobileNav('detail')
  }
  const mobileScreen = pane === 'family' && mobileNav === 'detail'
    ? 'family'
    : pane === 'updates' || pane === 'files' || mobileNav === 'detail'
      ? 'detail'
      : 'home'
  const workspaceViewKey = pane === 'chats' ? `chat-${selectedRoom?._id ?? 'empty'}` : pane
  const viewMotion = reduceMotion
    ? { initial: { opacity: 1 }, animate: { opacity: 1 }, exit: { opacity: 1 } }
    : { initial: { opacity: 0, x: 18, scale: .995 }, animate: { opacity: 1, x: 0, scale: 1 }, exit: { opacity: 0, x: -12, scale: .995 } }

  return (
    <LazyMotion features={domAnimation}>
    <main data-theme="dark" className={`saathi-workspace live-conversation-workspace is-mobile-${mobileScreen}${pane === 'family' ? ' is-family-open' : ''}`}>
      <aside className="workspace-rail" aria-label="Main navigation">
        <div className="workspace-logo">स</div>
        <button className={`rail-action ${pane === 'chats' ? 'active' : ''}`} onClick={openHome}><MessageSquareText /><span>Home</span></button>
        <button className={`rail-action ${pane === 'updates' ? 'active' : ''}`} onClick={() => openPane('updates')}><Bell /><span>Inbox</span></button>
        <button className={`rail-action ${pane === 'files' ? 'active' : ''}`} onClick={() => openPane('files')}><Folder /><span>Files</span></button>
        <button className={`rail-action ${pane === 'family' ? 'active' : ''}`} onClick={() => openPane('family')} aria-label="Settings"><Settings2 /><span>Settings</span></button>
        {isSuperadmin && <button className={`rail-action ${jevOpen ? 'active' : ''}`} onClick={() => setJevOpen(true)}><Sparkles /><span>Jev Debug</span></button>}
        {isSuperadmin && <button className="rail-action" onClick={openAdminDashboard}><ShieldCheck /><span>Access</span></button>}
        <div className="rail-session">
          <button className="rail-profile" onClick={() => setProfileOpen(open => !open)} aria-expanded={profileOpen} aria-label="Account menu">{initials}</button>
          {profileOpen && <div className="session-menu" role="menu">
            <p>{user?.email ?? user?.displayName ?? 'Signed in'}</p>
            <button type="button" role="menuitem" onClick={() => { setProfileOpen(false); openPane('family') }}><Settings2 /> Settings</button>
            <button type="button" role="menuitem" onClick={() => void signOut()}><LogOut /> Sign out</button>
          </div>}
        </div>
      </aside>

      <aside className="conversation-list live-conversation-list">
        <div className="mobile-home-header">
          <div><span>SAATHI / FAMILY</span><h1>Home</h1></div>
          <m.button type="button" layoutId="mobile-companion-avatar" onClick={() => setProfileOpen(true)} aria-label="Open family and account hub">{initials}</m.button>
        </div>
        <span className="family-select-label" id="family-switcher-label">Current family</span>
        <div className="family-switcher" role="group" aria-labelledby="family-switcher-label">
          {families.map(({ space }) => (
            <button type="button" key={space._id} className={space._id === family.space._id ? 'selected' : ''} onClick={() => onSelectFamily(space._id)}>
              <span>{space.name}</span><FamilyUnreadBadge spaceId={space._id} />
            </button>
          ))}
        </div>
        <span className="list-heading">Private</span>
        {personalRoom
          ? <button className={`conversation-link personal-chat-link ${personalRoom._id === selectedRoom?._id ? 'selected' : ''}`} onClick={() => openRoom(personalRoom._id)}><Bot /><span>My Saathi<small>Only you</small></span></button>
          : <p className="dark-empty-copy">Preparing your private chat…</p>}
        <span className="list-heading section-gap">Family chats</span>
        {(rooms ?? []).flatMap(({ room }) => room && room.type !== 'private' ? [room] : []).map((room) => (
          <button className={`conversation-link ${room._id === selectedRoom?._id ? 'selected' : ''}`} key={room._id} onClick={() => openRoom(room._id)}><i /><span>{room.title}</span></button>
        ))}
        {rooms !== undefined && !sharedRoom && <p className="dark-empty-copy">Your shared family conversation will appear here.</p>}
        <span className="list-heading section-gap">Family activity</span>
        <button className={`conversation-link ${pane === 'updates' ? 'selected' : ''}`} onClick={() => openPane('updates')}><i /><span>Family inbox</span><FamilyUnreadBadge spaceId={family.space._id} /></button>
        <button className="dark-sign-out" onClick={() => void signOut()}><LogOut /> Sign out</button>
      </aside>

      <AnimatePresence mode="wait" initial={false}>
        <m.div className="workspace-view-transition" key={workspaceViewKey} {...viewMotion} transition={{ duration: reduceMotion ? 0 : .22, ease: [.22, 1, .36, 1] }}>
          {pane === 'updates' ? (
            <FamilyUpdates family={family} items={inboxItems} onBack={openHome} />
          ) : pane === 'files' ? (
            <FamilyFiles family={family} files={spaceFiles} onBack={openHome} onOpenRoom={openRoom} />
          ) : selectedRoom ? (
            <LiveRoom key={selectedRoom._id} room={selectedRoom} family={family} families={families} onBack={openHome} onNavigate={openPane} onInvite={selectedRoom.type !== 'private' && family.membership.role === 'owner' ? () => setMembersOpen(true) : undefined} />
          ) : (
            <section className="conversation-pane"><header className="conversation-header"><div><h2>{family.space.name}</h2><p>Live · private family data</p></div></header><div className="dark-empty-state"><MessageSquareText /><h2>Your family conversation is getting ready</h2><p>Reload in a moment. New family spaces automatically receive a shared room.</p></div></section>
          )}
        </m.div>
      </AnimatePresence>

      <aside className="conversation-context live-context">
        <header className="conversation-header live-room-header mobile-family-header">
          <button className="mobile-chat-back" onClick={openHome} aria-label="Back to chats"><ArrowLeft /></button>
          <div><div className="title-line"><h2>Settings</h2><span className="live-label"><LockKeyhole /> Live</span></div><p>{family.space.name}</p></div>
        </header>
        <div className="context-title"><div><h2>Settings</h2><p>Change a control here, or ask Saathi in the conversation.</p></div><button onClick={onExit}>Switch mode</button></div>
        <div className="settings-scroll">
        <Card className="settings-intro">
          <MessageSquareText />
          <div><strong>You can just ask</strong><p>Try “Use Hindi for me” or “Use a watercolor style for images.” Voice works the same way.</p></div>
        </Card>
        <section className="personal-settings"><span>Your preferences</span><p>These choices affect only you.</p>
          <label>Reading language</label>
          <div className="language-setting" role="radiogroup" aria-label="My reading language">
            {(['en', 'hi', 'mr'] as const).map(code => (
              <button type="button" key={code} role="radio" aria-checked={(user?.preferredLanguage ?? 'en') === code} className={(user?.preferredLanguage ?? 'en') === code ? 'selected' : ''} onClick={() => void saveProfile({ preferredLanguage: code })}>
                {languageLabel(code)}
              </button>
            ))}
          </div>
          <label htmlFor="preferred-image-style">Default image style</label>
          <Select value={user?.preferredImageStyle ?? 'warm_family'} onValueChange={value => void saveProfile({ preferredImageStyle: value as (typeof IMAGE_PRESETS)[number]['id'] })}>
            <SelectTrigger id="preferred-image-style" aria-label="Default image style"><SelectValue /></SelectTrigger>
            <SelectContent>{IMAGE_PRESET_GROUPS.map(group => <SelectGroup key={group}>
              <SelectLabel>{imagePresetGroupLabel(group)}</SelectLabel>
              {IMAGE_PRESETS.filter(preset => preset.group === group).map(preset => <SelectItem value={preset.id} key={preset.id}>{preset.label}</SelectItem>)}
            </SelectGroup>)}</SelectContent>
          </Select>
        </section>
        <section>
          <span>Families</span>
          <p>{family.membership.role === 'owner' ? 'You can own up to 3 family spaces.' : 'Connect your Gmail here. Only owners can change family-wide settings.'}</p>
          {family.membership.role === 'owner' && (ownedFamilyCount < 3
            ? <button type="button" className="connect-gmail" onClick={() => setCreateFamilyOpen(true)}><Plus /> Create another family</button>
            : <small className="gmail-status">You already own 3 families.</small>)}
        </section>
        <section><span>Privacy</span><p className="confirmed"><ShieldCheck /> Live, authorized family data</p></section>
        <section className="gmail-connections"><span>Your Gmail</span><p>Useful mail is added privately to My Saathi in the families you allow. Other family members cannot see your connected accounts.</p>
          {(gmailConnections ?? []).map(connection => <div className="gmail-account" key={connection._id}><Mail /><span><strong>{connection.email ?? connection.alias}</strong><small>{connection.lastSyncedAt ? `Checked ${formatRelativeTime(connection.lastSyncedAt)}` : 'Reviewing the last 30 days…'}</small></span><button type="button" className="gmail-disable" onClick={() => { setGmailBusy(true); void disableGmailHere({ spaceId: family.space._id, connectedAccountId: connection.connectedAccountId }).then(() => setGmailMessage('Removed from this family. Mail stays in other families you enabled.')).catch(() => setGmailMessage('Could not update Gmail for this family.')).finally(() => setGmailBusy(false)) }} disabled={gmailBusy}>Remove here</button></div>)}
          {(reusableGmail ?? []).map(account => <button type="button" className="connect-gmail" key={account.connectedAccountId} disabled={gmailBusy} onClick={() => { setGmailBusy(true); void enableGmailHere({ spaceId: family.space._id, connectedAccountId: account.connectedAccountId }).then(() => setGmailMessage(`Added ${account.email ?? account.alias} to this family.`)).catch(() => setGmailMessage('Could not add that Gmail to this family.')).finally(() => setGmailBusy(false)) }}><Plus /> Use {account.email ?? account.alias} here</button>)}
          <button type="button" className="connect-gmail" onClick={() => void connectGmail()} disabled={gmailBusy}><Plus />{gmailConnections?.length ? 'Connect another Gmail' : 'Connect Gmail'}</button>
          {(gmailConnections?.length ?? 0) > 0 && <button type="button" className="connect-gmail secondary icon-action" onClick={() => {
            setGmailBusy(true)
            setGmailMessage('Checking connected Gmail…')
            void checkGmailNow({ spaceId: family.space._id })
              .then(count => setGmailMessage(count ? 'Checking inboxes now. New bills and receipts appear in My Saathi first.' : 'No Gmail accounts are connected yet.'))
              .catch(() => setGmailMessage('Could not check Gmail right now.'))
              .finally(() => setGmailBusy(false))
          }} disabled={gmailBusy} aria-label="Check for new mail" title="Check for new mail"><RefreshCw /></button>}
          {gmailMessage && <small className="gmail-status" role="status">{gmailMessage}</small>}
        </section>
        <details className="settings-disclosure">
          <summary><span>Advanced settings</span><small>{accessSource === 'byok' ? 'Family inbox address, AI model, usage, and provider keys' : 'Family inbox address and access controls'}</small></summary>
          <section><span>Family inbox</span>{family.space.agentmailInboxId
          ? <div className="agentmail-id"><p className="confirmed"><Check /> AgentMail is connected</p><code>{family.space.agentmailEmail ?? family.space.agentmailInboxId}</code><button type="button" onClick={() => { void navigator.clipboard.writeText(family.space.agentmailEmail ?? family.space.agentmailInboxId ?? '').then(() => { setCopiedInbox(true); window.setTimeout(() => setCopiedInbox(false), 2_000) }) }}><Copy />{copiedInbox ? 'Copied' : 'Copy'}</button></div>
          : family.membership.role === 'owner'
            ? <ConnectInbox spaceId={family.space._id} />
            : <p>Ask a family owner to connect AgentMail.</p>}</section>
          {family.membership.role === 'owner' && accessSource === 'byok' && <section><span>Models and usage</span><ModelTierControls spaceId={family.space._id} /></section>}
          {family.membership.role === 'owner' && accessSource === 'byok' && <section><span>Your provider keys</span><ByokKeys spaceId={family.space._id} /></section>}
        </details>
        {family.membership.role === 'owner' && <details className="settings-disclosure"><summary><span>Family access</span><small>Invite or manage family members</small></summary><section><InviteMember spaceId={family.space._id} /></section></details>}
        {isSuperadmin && <section className="jev-settings-card"><span>Jev debug</span><p>Preview routing and inspect recent chat, Voice, and Gmail decision logs without adding them to the conversation.</p><button type="button" className="connect-gmail" onClick={() => setJevOpen(true)}><Sparkles /> Open Jev Debug</button></section>}
        {isSuperadmin && <section className="jev-settings-card"><span>Deployment access</span><p>Approve or block accounts that request deployment-funded AI access.</p><button type="button" className="connect-gmail" onClick={openAdminDashboard}><ShieldCheck /> Open access dashboard</button></section>}
        </div>
      </aside>
      <nav className="mobile-workspace-nav" aria-label="Workspace">
        <button type="button" className={pane === 'chats' ? 'active' : ''} onClick={openHome}>{pane === 'chats' && <m.i layoutId="mobile-nav-active" />}<MessageSquareText /><span>Chat</span></button>
        <button type="button" className={pane === 'updates' ? 'active' : ''} onClick={() => openPane('updates')}>{pane === 'updates' && <m.i layoutId="mobile-nav-active" />}<Bell /><span>Updates</span></button>
        <button type="button" className={pane === 'files' ? 'active' : ''} onClick={() => openPane('files')}>{pane === 'files' && <m.i layoutId="mobile-nav-active" />}<Folder /><span>Files</span></button>
        <button type="button" className={pane === 'family' ? 'active' : ''} onClick={() => openPane('family')} aria-label="Settings">{pane === 'family' && <m.i layoutId="mobile-nav-active" />}<Settings2 /><span>Settings</span></button>
      </nav>
      <AnimatePresence>
        {profileOpen && <m.div className="mobile-companion-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setProfileOpen(false)}>
          <m.section className="mobile-companion-hub" role="dialog" aria-modal="true" aria-labelledby="companion-hub-title" initial={reduceMotion ? { opacity: 1 } : { opacity: 0, y: -18, scale: .96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -12, scale: .97 }} transition={{ type: 'spring', stiffness: 410, damping: 34 }} onClick={event => event.stopPropagation()}>
            <header><m.span layoutId="mobile-companion-avatar">{initials}</m.span><div><small>CONNECTED TO</small><h2 id="companion-hub-title">{family.space.name}</h2><p>{user?.displayName ?? user?.email ?? 'Family member'}</p></div><button type="button" onClick={() => setProfileOpen(false)} aria-label="Close account hub"><X /></button></header>
            <div className="companion-hub-status"><i /><span><strong>Saathi is ready</strong><small>Private family memory · live translation</small></span></div>
            <div className="companion-hub-actions"><button type="button" onClick={() => { setProfileOpen(false); openPane('family') }}><Settings2 /><span>Settings</span></button><button type="button" onClick={() => { setProfileOpen(false); setMembersOpen(true) }}><UserPlus /><span>Family</span></button><button type="button" onClick={() => void signOut()}><LogOut /><span>Sign out</span></button></div>
            <section className="companion-hub-overview"><span>TODAY</span><button type="button" onClick={() => { setProfileOpen(false); openPane('updates') }}><Bell /><span><strong>Family updates</strong><small>{inboxItems?.length ?? 0} recent items</small></span><ArrowRight /></button><button type="button" onClick={() => { setProfileOpen(false); openHome() }}><MessageSquareText /><span><strong>Conversations</strong><small>{rooms?.filter(row => row.room).length ?? 0} available chats</small></span><ArrowRight /></button><div><ShieldCheck /><span><strong>Private by design</strong><small>Each family stays separate</small></span><Check /></div></section>
            <footer className="companion-hub-footer"><span>स</span><p>One trusted place for your family’s conversations, updates, and agent work.</p></footer>
          </m.section>
        </m.div>}
      </AnimatePresence>
      {membersOpen && <div className="family-dialog-backdrop" role="presentation" onMouseDown={() => setMembersOpen(false)}><section className="family-dialog" role="dialog" aria-modal="true" aria-labelledby="invite-dialog-title" onMouseDown={event => event.stopPropagation()}><header><div><span>Family access</span><h2 id="invite-dialog-title">Invite someone to {family.space.name}</h2></div><button type="button" onClick={() => setMembersOpen(false)} aria-label="Close invitations" autoFocus><X /></button></header><p>They must sign in using the same email address. Invitations expire after seven days.</p><InviteMember spaceId={family.space._id} /></section></div>}
      {createFamilyOpen && <CreateFamilyDialog ownedCount={ownedFamilyCount} onClose={() => setCreateFamilyOpen(false)} onCreated={(spaceId) => { setCreateFamilyOpen(false); onSelectFamily(spaceId) }} createSpace={createSpace} />}
      {jevOpen && isSuperadmin && <JevLabDrawer spaceId={family.space._id} onClose={() => setJevOpen(false)} />}
    </main>
    </LazyMotion>
  )
}

function JevLabDrawer({ spaceId, onClose }: { spaceId: Id<'spaces'>; onClose: () => void }) {
  const recent = useQuery(api.jev.recent, { spaceId, limit: 30 })
  const evaluate = useAction(api.jev.evaluate)
  const [text, setText] = useState('Book a table for dinner tomorrow')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<{
    route: string
    routeConfidence: number
    routeProbabilities: Record<string, number>
    needsClarification: number
    model: string
    inputTokens: number
    latencyMs: number
  } | null>(null)

  useEffect(() => {
    const closeOnEscape = (event: globalThis.KeyboardEvent) => event.key === 'Escape' && onClose()
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!text.trim()) return
    setBusy(true)
    setError('')
    try {
      setResult(await evaluate({ spaceId, text }))
    } catch (caught) {
      setError(convexErrorCode(caught) === 'JEV_NOT_CONFIGURED'
        ? 'TYPESAFE_API_KEY is not available to this Convex deployment.'
        : 'Jev could not evaluate this request. Try again in a moment.')
    } finally {
      setBusy(false)
    }
  }

  const probabilities = result
    ? Object.entries(result.routeProbabilities).sort((left, right) => right[1] - left[1])
    : []

  return <div className="jev-lab-backdrop" role="presentation" onMouseDown={onClose}>
    <aside className="jev-lab-drawer" role="dialog" aria-modal="true" aria-labelledby="jev-lab-title" onMouseDown={event => event.stopPropagation()}>
      <header><div><span><Sparkles /> Jev debug</span><h2 id="jev-lab-title">Routing and tool logs</h2><p>See where Jev runs and what Saathi did next.</p></div><button type="button" onClick={onClose} aria-label="Close Jev debug" autoFocus><X /></button></header>
      <div className="jev-flow" aria-label="How a request is handled">
        <span><b>1</b>Your request</span><i aria-hidden="true" />
        <span><b>2</b>Jev recommends</span><i aria-hidden="true" />
        <span><b>3</b>Pi acts</span>
      </div>
      <section className="jev-integration-note" aria-labelledby="jev-integration-title">
        <div><strong id="jev-integration-title">Where Jev is integrated</strong><span>Debug visibility, not an execution gate</span></div>
        <ul>
          <li><b>Chat</b><span>Jev recommends a route before Pi. Large-catalog bundle selection is shadow-only, so Pi still sees the full authorized tool set.</span></li>
          <li><b>Voice</b><span>GPT Live uses app tools directly. Jev separately controls browser navigation from page-derived safe actions; completed tool calls are logged without a generic per-tool gate.</span></li>
          <li><b>Gmail</b><span>Jev classifies mail before private inbox extraction and retention rules continue separately.</span></li>
        </ul>
      </section>
      <form className="jev-test-form" onSubmit={submit}>
        <label htmlFor="jev-test-input">Preview a routing decision</label>
        <Textarea id="jev-test-input" value={text} onChange={event => setText(event.target.value)} rows={4} maxLength={12_000} />
        <div className="jev-examples" aria-label="Example languages"><span>Try:</span>{[
          ['English', 'Book a table for dinner tomorrow'],
          ['Hinglish', 'Kal raat ke liye Pune mein family dinner table book karo'],
          ['मराठी', 'उद्या रात्री पुण्यात कुटुंबासाठी टेबल बुक करा'],
        ].map(([label, example]) => <button type="button" key={label} data-active={text === example || undefined} onClick={() => { setText(example); setResult(null); setError('') }}>{label}</button>)}</div>
        <p>This preview asks Jev for advice only. It does not run Pi, Voice, or a tool.</p>
        <button type="submit" disabled={busy || !text.trim()}>{busy ? 'Inspecting…' : 'Inspect routing'}</button>
      </form>
      {error && <p className="jev-lab-error" role="alert">{error}</p>}
      {result && <section className="jev-result" aria-live="polite">
        <div className="jev-result-heading"><span>Recommended next step</span><strong>{jevDecisionLabel('lab', result.route)}</strong><small>{Math.round(result.routeConfidence * 100)}% confidence · {result.latencyMs} ms</small></div>
        <div className="jev-recommendation-note"><b>Preview only</b><span>No action was run from this test.</span></div>
        <div className="jev-clarify"><span>Needs a follow-up question</span><strong>{Math.round(result.needsClarification * 100)}%</strong></div>
        <div className="jev-probability-title">How Jev weighed the options</div>
        <div className="jev-probabilities">{probabilities.map(([label, probability]) => <div key={label}><span>{jevDecisionLabel('lab', label)}</span><i><b style={{ width: `${Math.max(2, probability * 100)}%` }} /></i><strong>{Math.round(probability * 100)}%</strong></div>)}</div>
        <small>{result.model} · {result.inputTokens} input tokens</small>
      </section>}
      <section className="jev-history"><div className="jev-section-title"><div><h3>Recent debug logs</h3><p>Chat recommendations, completed Voice tool calls, and Gmail classifications. Older records may not have an outcome.</p></div><span>{recent?.length ?? 0}</span></div>
        {recent === undefined && <p>Loading decisions…</p>}
        {recent?.length === 0 && <p>No decisions yet. Inspect a route above or ask Saathi something.</p>}
        {recent?.map(item => {
          const outcome = jevExecutionSummary(item.source, item.execution, item.details)
          return <article key={item._id}>
            <div><span>{jevSourceLabel(item.source)}</span><time>{formatRelativeTime(item.createdAt)}</time></div>
            <strong>{jevDecisionLabel(item.source, item.decision)}</strong>
            <p className="jev-history-input">“{item.inputPreview}”</p>
            <div className="jev-outcome" data-tone={outcome.tone}><b>{outcome.label}</b>{outcome.detail && <span>{outcome.detail}</span>}</div>
            <small>{item.confidence === undefined ? '' : `${Math.round(item.confidence * 100)}% confidence · `}{item.latencyMs} ms · {item.inputTokens} tokens</small>
          </article>
        })}
      </section>
    </aside>
  </div>
}

type JevSource = 'chat_turn' | 'chat_tool' | 'voice_tool' | 'voice_browser' | 'gmail' | 'lab'

function jevSourceLabel(source: JevSource) {
  if (source === 'chat_turn') return 'Chat recommendation'
  if (source === 'chat_tool') return 'Chat action check'
  if (source === 'voice_tool') return 'Voice tool result'
  if (source === 'voice_browser') return 'Voice browser decision'
  if (source === 'gmail') return 'Email classification'
  return 'Routing preview'
}

const jevRouteLabels: Record<string, string> = {
  answer: 'Answer normally',
  clarify: 'Ask a follow-up question',
  search: 'Search the web',
  computer: 'Use the browser',
  image: 'Create an image',
  settings: 'Change a setting',
  memory: 'Use memory',
  family_data: 'Read saved family data',
  multi_tool: 'Use multiple tools',
  search_public_web: 'Search public web',
  use_computer: 'Use computer',
  generate_image: 'Generate image',
  set_reading_language: 'Set reading language',
  set_image_style: 'Set image style',
  set_model_tier: 'Set thinking level',
  remember: 'Remember fact',
  recall: 'Recall fact',
  forget_memory: 'Forget fact',
  list_memories: 'List memories',
  find_room_files: 'Find room files',
  search_family_inbox: 'Search family inbox',
  execute: 'Allow the action',
  block: 'Stop the action',
  bills: 'Keep as a bill',
  receipts: 'Keep as a receipt',
  bank: 'Keep as a bank notice',
  ignore: 'Ignore this email',
}

function jevDecisionLabel(_source: JevSource, decision: string) {
  return jevRouteLabels[decision] ?? decision.replaceAll('_', ' ')
}

function jevExecutionSummary(
  source: JevSource,
  execution?: {
    status: 'queued' | 'running' | 'complete' | 'failed'
    trigger?: 'mention' | 'ambient' | 'automatic'
    activity?: 'searching_web' | 'generating_image' | 'using_computer'
    responsePreview?: string
    error?: string
  },
  details?: unknown,
) {
  if (!execution) {
    if (source === 'lab') return { tone: 'neutral', label: 'Preview only', detail: 'This did not start Pi or a tool.' }
    if (source === 'gmail') return { tone: 'neutral', label: 'Classification recorded', detail: 'Email processing continues separately.' }
    if (source === 'voice_tool') {
      const voice = details && typeof details === 'object'
        ? details as { integration?: unknown; ok?: unknown; resultPreview?: unknown }
        : null
      if (voice?.integration !== 'voice_observation') {
        return { tone: 'neutral', label: 'Voice recommendation recorded', detail: 'This older record is not linked to a tool result.' }
      }
      const detail = typeof voice?.resultPreview === 'string' ? voice.resultPreview : 'Voice completed the tool call.'
      return voice?.ok === false
        ? { tone: 'error', label: 'Voice tool failed', detail }
        : { tone: 'success', label: 'Voice tool completed', detail }
    }
    if (source === 'voice_browser') return { tone: 'neutral', label: 'Browser decision recorded', detail: 'Jev selected from page-derived safe actions.' }
    return { tone: 'neutral', label: 'Outcome not available', detail: 'This record was created before outcome tracking was added.' }
  }
  if (execution.status === 'queued') return { tone: 'working', label: 'Waiting for Pi', detail: 'The request is queued.' }
  if (execution.status === 'running') {
    const activity = execution.activity === 'searching_web' ? 'Pi is searching the web.'
      : execution.activity === 'generating_image' ? 'Pi is creating the image.'
        : execution.activity === 'using_computer' ? 'Pi is using the browser.'
          : 'Pi is working on the request.'
    return { tone: 'working', label: 'In progress', detail: activity }
  }
  if (execution.status === 'failed') return { tone: 'error', label: 'Pi failed', detail: execution.error || 'The request did not complete.' }
  if (execution.responsePreview) return { tone: 'success', label: 'Pi replied', detail: execution.responsePreview }
  if (execution.trigger === 'ambient') {
    return { tone: 'neutral', label: 'Pi stayed silent', detail: 'This was an ambient family message, so silence may be intentional. Tag @Saathi when you need a reply.' }
  }
  return { tone: 'warning', label: 'Finished without a reply', detail: 'Pi completed the run but produced no visible answer.' }
}

function LiveRoom({ room, family, families, onBack, onNavigate, onInvite }: {
  room: Doc<'rooms'>
  family: FamilyRow
  families: FamilyRow[]
  onBack: () => void
  onNavigate: (pane: 'updates' | 'files' | 'family') => void
  onInvite?: () => void
}) {
  const messages = useQuery(api.rooms.messages, { roomId: room._id, limit: 40 })
  const mentionCandidates = useQuery(api.mentions.candidates, { roomId: room._id })
  const generatedImages = useQuery(api.images.forRoom, { roomId: room._id, limit: 20 })
  const attachments = useQuery(api.attachments.forRoom, { roomId: room._id, limit: 40 })
  const saathi = useQuery(api.agents.forRoom, { roomId: room._id })
  const postMessage = useMutation(api.messages.post)
  const retrySaathi = useMutation(api.agents.send)
  const generateAttachmentUploadUrl = useMutation(api.attachments.generateUploadUrl)
  const submitAttachment = useMutation(api.attachments.submit)
  const pendingMoney = useQuery(api.gmailData.pendingForRoom, room.type === 'private' ? { roomId: room._id } : 'skip')
  const shareMoney = useMutation(api.gmailData.shareWithFamily)
  const shareMoneyWithSpace = useMutation(api.gmailData.shareWithSpace)
  const [message, setMessage] = useState('')
  const [imageDraft, setImageDraft] = useState('')
  const [imageOpen, setImageOpen] = useState(false)
  const [expandedImage, setExpandedImage] = useState<{ url: string; prompt: string } | null>(null)
  const profile = useQuery(api.users.current)
  const [imageStyle, setImageStyle] = useState<(typeof IMAGE_PRESETS)[number]['id']>(profile?.preferredImageStyle ?? 'warm_family')
  const [busy, setBusy] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const [error, setError] = useState('')
  const [uploads, setUploads] = useState<PendingUpload[]>([])
  const [dragActive, setDragActive] = useState(false)
  const [mentionMatch, setMentionMatch] = useState<{ start: number; end: number; query: string } | null>(null)
  const [activeMention, setActiveMention] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const receiptInputRef = useRef<HTMLInputElement>(null)
  const captureRef = useRef<'library' | 'camera' | 'receipt'>('library')
  const dragDepthRef = useRef(0)
  const feedEndRef = useRef<HTMLDivElement>(null)
  const activeJob = saathi?.jobs.find((job) => job.status === 'running') ?? saathi?.jobs.find((job) => job.status === 'queued')
  const failedJob = saathi?.jobs[0]?.status === 'failed' ? saathi.jobs[0] : null
  const attachmentMessageIds = useMemo(() => new Set((attachments ?? []).map((item) => item.messageId)), [attachments])
  const voice = useLiveVoice(room._id)
  const filteredMentions = useMemo(() => {
    if (!mentionMatch || !mentionCandidates) return []
    return mentionCandidates.filter(candidate =>
      candidate.username.startsWith(mentionMatch.query) || candidate.label.toLowerCase().startsWith(mentionMatch.query),
    ).slice(0, 8)
  }, [mentionCandidates, mentionMatch])
  const timeline = useMemo(() => [
    ...(messages ?? []).filter((item) => !attachmentMessageIds.has(item._id)).map((item) => ({ kind: 'message' as const, createdAt: item.createdAt, item })),
    ...(generatedImages ?? []).map((item) => ({ kind: 'image' as const, createdAt: item.createdAt, item })),
    ...(attachments ?? []).map((item) => ({ kind: 'attachment' as const, createdAt: item.createdAt, item })),
  ].sort((left, right) => left.createdAt - right.createdAt), [messages, generatedImages, attachments, attachmentMessageIds])

  const useUiAction = (action: ConversationUiAction) => {
    if (action.kind === 'open_settings') return onNavigate('family')
    if (action.kind === 'open_inbox') return onNavigate('updates')
    if (action.kind === 'open_files') return onNavigate('files')
    if (action.kind === 'open_image') {
      setImageOpen(true)
      requestAnimationFrame(() => textareaRef.current?.focus())
      return
    }
    if (action.kind === 'start_voice') {
      void voice.start()
      return
    }
    if (action.kind === 'send_prompt' && action.prompt) {
      setMessage(action.prompt)
      requestAnimationFrame(() => textareaRef.current?.focus())
    }
  }

  useEffect(() => {
    feedEndRef.current?.scrollIntoView({ block: 'end' })
  }, [messages?.length, generatedImages?.length, attachments?.length, activeJob?.responseText, activeJob?.status, activeJob?.computerInteractiveLiveViewUrl, activeJob?.computerLiveViewUrl])


  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const text = message.trim()
    if (!text) return
    setBusy(true)
    setError('')
    try {
      await postMessage({ roomId: room._id, text, language: profile?.preferredLanguage ?? 'en', clientOperationId: crypto.randomUUID().replaceAll('-', '') })
      setMessage('')
      setMentionMatch(null)
    } catch {
      setError('Your message could not be shared. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  const updateMentionMatch = (value: string, caret: number | null) => {
    if (caret === null) return setMentionMatch(null)
    const prefix = value.slice(0, caret)
    const match = prefix.match(/(?:^|\s)@([a-zA-Z0-9_]*)$/)
    setMentionMatch(match ? { start: caret - match[1].length - 1, end: caret, query: match[1].toLowerCase() } : null)
    setActiveMention(0)
  }

  const chooseMention = (candidate: MentionCandidate) => {
    if (!mentionMatch) return
    const handle = candidate.kind === 'assistant' ? 'Saathi' : candidate.username
    const next = `${message.slice(0, mentionMatch.start)}@${handle} ${message.slice(mentionMatch.end)}`
    const caret = mentionMatch.start + handle.length + 2
    setMessage(next)
    setMentionMatch(null)
    requestAnimationFrame(() => {
      textareaRef.current?.focus()
      textareaRef.current?.setSelectionRange(caret, caret)
    })
  }

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionMatch && filteredMentions.length) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        setActiveMention(current => (current + (event.key === 'ArrowDown' ? 1 : -1) + filteredMentions.length) % filteredMentions.length)
        return
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault()
        chooseMention(filteredMentions[activeMention] ?? filteredMentions[0])
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        setMentionMatch(null)
        return
      }
    }
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
    event.preventDefault()
    event.currentTarget.form?.requestSubmit()
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

  const uploadFiles = async (files: File[], capture: 'library' | 'camera' | 'receipt' = 'library') => {
    for (const file of files) {
      const id = crypto.randomUUID()
      const mediaType = attachmentMediaType(file)
      const maxBytes = mediaType.startsWith('image/') ? MAX_IMAGE_BYTES : MAX_DOCUMENT_BYTES
      if (file.size <= 0 || file.size > maxBytes) {
        setUploads((current) => [...current, { id, name: file.name, status: 'error', message: mediaType.startsWith('image/') ? 'Images must be smaller than 20 MB.' : 'Documents must be smaller than 50 MB.' }])
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
          capture,
        })
        setUploads((current) => current.filter((upload) => upload.id !== id))
      } catch {
        setUploads((current) => current.map((upload) => upload.id === id
          ? { ...upload, status: 'error', message: 'Could not upload this file. Check its type and try again.' }
          : upload))
      }
    }
  }

  const chooseFiles = (files: FileList | null, capture: 'library' | 'camera' | 'receipt' = captureRef.current) => {
    if (!files?.length) return
    void uploadFiles(Array.from(files), capture)
    if (fileInputRef.current) fileInputRef.current.value = ''
    if (cameraInputRef.current) cameraInputRef.current.value = ''
    if (receiptInputRef.current) receiptInputRef.current.value = ''
    captureRef.current = 'library'
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
      {dragActive && <div className="file-drop-overlay" role="status"><Upload /><strong>Drop files to share</strong><span>Photos up to 20 MB · PDFs up to 50 MB</span></div>}
      <header className="conversation-header live-room-header">
        <button className="mobile-chat-back" onClick={onBack} aria-label="Back to chats"><ArrowLeft /></button>
        <div><div className="title-line"><h2>{room.title}</h2><span className="live-label"><LockKeyhole /> Live</span></div><p>{room.type === 'private' ? 'Only you and Saathi can see this conversation' : `${family.space.name} · private family conversation`}</p></div>
        <div className="room-header-actions">{onInvite && <button type="button" className="header-invite" onClick={onInvite}><UserPlus /><span>Invite member</span></button>}<div className="participant-stack"><span>YOU</span>{room.type !== 'private' && <span>F</span>}<span className="saathi-participant" title="Saathi can help in this conversation"><Sparkles /></span></div></div>
      </header>
      <div className="conversation-feed live-feed">
        {messages === undefined && <div className="dark-loading"><i /><i /><i /></div>}
        {messages && generatedImages && attachments && timeline.length === 0 && !imageOpen && <div className="dark-empty-state compact conversation-starter"><MessageSquareText /><h2>{room.type === 'private' ? 'What can Saathi help with?' : 'Start with what your family needs'}</h2><p>{room.type === 'private' ? 'Talk or type naturally. Your settings, images, research, and plans all happen in this conversation.' : 'Write to your family or ask Saathi in the same conversation.'}</p><div className="starter-prompts">
          {(room.type === 'private'
            ? ['Use Hindi for me', 'Use watercolor for my images', 'Create a Diwali invitation image']
            : ['Help us plan a family dinner', 'Summarize the file I share', 'Find current train options']
          ).map(prompt => <Button type="button" variant="outline" size="sm" key={prompt} onClick={() => { setMessage(prompt); requestAnimationFrame(() => textareaRef.current?.focus()) }}>{prompt}</Button>)}
        </div></div>}
        {timeline.map((entry) => entry.kind === 'image'
          ? entry.item.url && <article className="person-message assistant-message generated-image-message" key={`image-${entry.item._id}`}>
              <span className="message-avatar assistant"><Bot /></span>
              <div><h3>Saathi <small>· {imageKindLabel(entry.item.kind)}</small></h3><figure className="generated-image-card"><button type="button" className="generated-image-open" onClick={() => setExpandedImage({ url: entry.item.url!, prompt: entry.item.prompt })} aria-label={`View generated image full size: ${entry.item.prompt}`}><img src={entry.item.url} alt={entry.item.prompt} onLoad={() => feedEndRef.current?.scrollIntoView({ block: 'end' })} /><span>View full size</span></button><figcaption>{entry.item.prompt}</figcaption></figure></div>
            </article>
          : entry.kind === 'attachment'
            ? <article className="outgoing-message attachment-message" key={`attachment-${entry.item._id}`}>
                <span>You · {formatRelativeTime(entry.item.createdAt)}</span>
                {entry.item.mediaType.startsWith('image/') && entry.item.url
                  ? <a className="shared-image" href={entry.item.url} target="_blank" rel="noreferrer"><img src={entry.item.url} alt={entry.item.fileName} /><small>{entry.item.fileName} · {formatFileSize(entry.item.sizeBytes)}</small></a>
                  : <a className="shared-document" href={entry.item.url ?? undefined} target="_blank" rel="noreferrer" aria-disabled={!entry.item.url}><FileText /><span><strong>{entry.item.fileName}</strong><small>{formatFileSize(entry.item.sizeBytes)}</small></span></a>}
                {entry.item.transcriptStatus === 'pending' && <small className="photo-read-status">Reading with a small model…</small>}
                {entry.item.transcript && <p className="photo-read-text">{entry.item.extractedMerchant ? `${entry.item.extractedMerchant}${entry.item.extractedAmount ? ` · ${entry.item.extractedAmount}` : ''}` : entry.item.transcript}</p>}
              </article>
          : entry.item.actorType === 'voice_transcript'
            ? entry.item.voiceSpeaker === 'user'
              ? <article className="outgoing-message saved-voice-transcript" key={`message-${entry.item._id}`}><span>You · voice transcript · {formatRelativeTime(entry.item.createdAt)}</span><p>{entry.item.originalText}</p></article>
              : entry.item.voiceSpeaker === 'assistant'
                ? <article className="person-message assistant-message saved-voice-transcript" key={`message-${entry.item._id}`}><span className="message-avatar assistant"><Bot /></span><div><h3>Saathi <small>· voice transcript · {formatRelativeTime(entry.item.createdAt)}</small></h3><div className="assistant-card"><p>{entry.item.originalText}</p></div></div></article>
                : <article className="voice-call-summary" key={`message-${entry.item._id}`}><span className="voice-summary-icon"><AudioLines /></span><div><h3>Voice call summary <small>· {formatRelativeTime(entry.item.createdAt)}</small></h3><p>{entry.item.originalText}</p>{entry.item.voiceSeconds !== undefined && <small className="voice-call-cost">{formatVoiceDuration(entry.item.voiceSeconds)} · est. {formatVoiceCost(entry.item.voiceCostUsd ?? 0)} GPT‑Live{entry.item.voiceUsageFinalized === false ? ' · final usage unavailable' : ''}</small>}<ConversationUiActions actions={entry.item.uiActions} onAction={useUiAction} /></div></article>
            : entry.item.actorType === 'user'
            ? <article className="outgoing-message" key={`message-${entry.item._id}`}><span>{entry.item.authorUserId === profile?._id ? 'You' : entry.item.authorUsername ? `@${entry.item.authorUsername}` : 'Family member'} · {formatRelativeTime(entry.item.createdAt)}</span><p><MentionText text={entry.item.originalText} mentions={entry.item.mentions} /></p></article>
            : <article className={`person-message ${entry.item.actorType === 'assistant' ? 'assistant-message' : ''}`} key={`message-${entry.item._id}`}>
                <span className={`message-avatar ${entry.item.actorType === 'assistant' ? 'assistant' : 'email'}`}>{entry.item.actorType === 'assistant' ? <Sparkles /> : <Mail />}</span>
                <div><h3>{entry.item.actorType === 'assistant' ? 'Saathi' : 'Email guest'} <small>· {formatRelativeTime(entry.item.createdAt)}</small></h3><div className={entry.item.actorType === 'assistant' ? 'assistant-card' : 'simple-message'}>{entry.item.actorType === 'assistant' ? <AssistantText text={entry.item.originalText} /> : <p>{entry.item.originalText}</p>}{entry.item.actorType === 'assistant' && <ConversationUiActions actions={entry.item.uiActions} onAction={useUiAction} />}{room.type === 'private' && entry.item.actorType === 'email_guest' && pendingMoney?.some(item => item.agentmailMessageId === entry.item.idempotencyKey) && <ShareFamilyMailButtons item={pendingMoney.find(item => item.agentmailMessageId === entry.item.idempotencyKey)!} family={family} families={families} onShareHere={(inboxItemId) => void shareMoney({ inboxItemId })} onShareThere={(inboxItemId, spaceId) => void shareMoneyWithSpace({ inboxItemId, spaceId })} />}</div></div>
              </article>)}
        {voice.summarizing && (
          <article className="person-message assistant-message saathi-stream" aria-live="polite">
            <span className="message-avatar assistant"><Bot /></span>
            <div>
              <h3>Saathi <small>· writing a call summary</small></h3>
              <div className="assistant-card streaming-card">
                <div className="agent-activity" role="status" aria-label="Writing your voice summary"><ThinkingState /><span aria-hidden="true">· writing your voice summary</span></div>
              </div>
            </div>
          </article>
        )}
        {activeJob?.trigger === 'ambient' && !activeJob.responseText && (
          <div className="ambient-check" role="status"><Sparkles /> Saathi is checking whether help is needed…</div>
        )}
        {activeJob && (activeJob.trigger !== 'ambient' || activeJob.responseText) && (
          <article className="person-message assistant-message saathi-stream" aria-live="polite">
            <span className="message-avatar assistant"><Bot /></span>
            <div>
              <h3>Saathi <small>· {activeJob.status === 'queued' ? 'getting ready' : activeJob.activity === 'searching_web' ? 'searching the web' : activeJob.activity === 'generating_image' ? 'creating an image' : activeJob.activity === 'using_computer' ? 'using a live browser' : activeJob.responseText ? 'typing' : 'thinking'}</small></h3>
              <div className="assistant-card streaming-card">
                {computerViewUrl(activeJob) && (
                  <div className="computer-live-view">
                    <div className="computer-live-view-header"><Monitor /><span>Live browser</span><small>Sign in here if needed. Saathi keeps site cookies, not your password.</small></div>
                    <iframe title="Saathi live browser" src={computerViewUrl(activeJob)} allow="clipboard-write" referrerPolicy="no-referrer" />
                  </div>
                )}
                <AgentStreamingResponse status={activeJob.status} activity={activeJob.activity} responseText={activeJob.responseText} />
              </div>
            </div>
          </article>
        )}
        {failedJob && failedJob.trigger !== 'ambient' && !activeJob && (
          <article className="person-message assistant-message saathi-failed" role="status">
            <span className="message-avatar assistant"><Bot /></span>
            <div><h3>Saathi <small>· couldn’t respond</small></h3><div className="assistant-card"><p>Something interrupted that response.</p><button type="button" className="icon-action" onClick={() => void retryFailedResponse()} disabled={retrying} aria-label={retrying ? 'Retrying response' : 'Try response again'} title={retrying ? 'Retrying…' : 'Try again'}><RefreshCcw /></button></div></div>
          </article>
        )}
        <div ref={feedEndRef} />
      </div>
      <footer className="conversation-composer">
        {uploads.length > 0 && <div className="upload-queue" aria-live="polite">{uploads.map((upload) => <div className={upload.status} key={upload.id}>{upload.status === 'uploading' ? <span className="upload-spinner" /> : <FileText />}<span><strong>{upload.name}</strong><small>{upload.status === 'uploading' ? 'Uploading…' : upload.message}</small></span>{upload.status === 'error' && <button type="button" onClick={() => setUploads((current) => current.filter((item) => item.id !== upload.id))} aria-label={`Dismiss ${upload.name}`}><X /></button>}</div>)}</div>}
        <div className="composer-guidance">
          <div className="composer-guidance-actions">
            <Button type="button" variant="ghost" size="sm" className="voice-start" onClick={() => void voice.start()} disabled={!['idle', 'ended', 'error'].includes(voice.status)}><Mic /> {['idle', 'ended', 'error'].includes(voice.status) ? 'Talk to Saathi' : 'Voice call open'}</Button>
            <Button type="button" variant="ghost" size="sm" className={imageOpen ? 'is-active' : ''} onClick={() => setImageOpen(current => !current)}><ImageIcon /> Create image</Button>
            <details className="composer-more">
              <summary><Plus /> Add</summary>
              <div>
                <button type="button" onClick={() => { captureRef.current = 'library'; fileInputRef.current?.click() }}><Folder /> Photos or files</button>
                <button type="button" onClick={() => cameraInputRef.current?.click()}><Camera /> Take a photo</button>
                <button type="button" onClick={() => receiptInputRef.current?.click()}><FileText /> Scan a receipt</button>
              </div>
            </details>
          </div>
          <span>Type @ to tag someone or ask @Saathi.</span>
        </div>
        {imageOpen && <ImagePromptBox
          prompt={imageDraft}
          style={imageStyle}
          onPrompt={setImageDraft}
          onStyle={setImageStyle}
          onCancel={() => setImageOpen(false)}
          onApprove={() => {
            const text = imageDraft.trim()
            if (!text) return
            const preset = IMAGE_PRESETS.find(item => item.id === imageStyle)
            setMessage(`@saathi Create an image in the ${preset?.label ?? 'Warm household'} style: ${text}`)
            setImageOpen(false)
            setImageDraft('')
            requestAnimationFrame(() => textareaRef.current?.focus())
          }}
        />}
        <form onSubmit={submit}>
          <Input ref={fileInputRef} className="visually-hidden" type="file" accept={ACCEPTED_ATTACHMENTS} multiple onChange={(event) => chooseFiles(event.target.files, 'library')} />
          <Input ref={cameraInputRef} className="visually-hidden" type="file" accept="image/*" capture="environment" onChange={(event) => chooseFiles(event.target.files, 'camera')} />
          <Input ref={receiptInputRef} className="visually-hidden" type="file" accept="image/*,application/pdf" onChange={(event) => chooseFiles(event.target.files, 'receipt')} />
          {mentionMatch && <div className="mention-menu" role="listbox" aria-label="People you can mention">
            {mentionCandidates === undefined && <span className="mention-loading">Finding people…</span>}
            {mentionCandidates !== undefined && filteredMentions.length === 0 && <span className="mention-empty">No matching person in this chat</span>}
            {filteredMentions.map((candidate, index) => <button type="button" role="option" aria-selected={index === activeMention} className={index === activeMention ? 'active' : ''} key={`${candidate.kind}-${candidate.username}`} onMouseDown={event => event.preventDefault()} onClick={() => chooseMention(candidate)}>
              <b>{candidate.kind === 'assistant' ? <Bot /> : initialsFor(candidate.label)}</b><span><strong>@{candidate.kind === 'assistant' ? 'Saathi' : candidate.username}</strong><small>{candidate.kind === 'assistant' ? 'Family assistant' : candidate.label}</small></span>
            </button>)}
          </div>}
          <Textarea ref={textareaRef} value={message} onChange={(event) => { setMessage(event.target.value); updateMentionMatch(event.target.value, event.target.selectionStart) }} onSelect={(event) => updateMentionMatch(event.currentTarget.value, event.currentTarget.selectionStart)} onKeyDown={handleComposerKeyDown} placeholder={room.type === 'private' ? 'Ask Saathi anything… Type @ to tag' : 'Message your family… Type @ to tag'} aria-label="Message for your family" aria-autocomplete="list" aria-expanded={Boolean(mentionMatch)} rows={1} />
          <Button className="composer-attachment" variant="ghost" size="icon" type="button" onClick={() => fileInputRef.current?.click()} aria-label="Attach photos or documents"><Paperclip /></Button>
          <Button className="composer-send" type="submit" disabled={busy || !message.trim()}>{busy ? 'Sending…' : 'Send'} <Send /></Button>
        </form>
        {error && <p className="dark-form-error" role="alert">{error}</p>}
        {voice.error && <p className="dark-form-error" role="alert">{voice.error}</p>}
      </footer>
      {expandedImage && <GeneratedImageLightbox image={expandedImage} onClose={() => setExpandedImage(null)} />}
      {isVoiceCallOpen(voice.status) && <VoiceCallOverlay
        status={voice.status}
        turns={voice.turns}
        activities={voice.activities}
        computerTool={voice.computerTool}
        voiceLevel={voice.voiceLevel}
        voiceSeconds={voice.voiceSeconds}
        onMute={voice.toggleMute}
        onEnd={voice.end}
      />}
    </section>
  )
}

function ConversationUiActions({ actions, onAction }: {
  actions: ConversationUiAction[] | undefined
  onAction: (action: ConversationUiAction) => void
}) {
  if (!actions?.length) return null
  return <div className="conversation-ui-actions" aria-label="Suggested next actions">
    <span><Sparkles /> Suggested next steps</span>
    <div>{actions.map(action => <button type="button" key={`${action.kind}-${action.label}`} onClick={() => onAction(action)}>{action.label}</button>)}</div>
  </div>
}

function GeneratedImageLightbox({ image, onClose }: {
  image: { url: string; prompt: string }
  onClose: () => void
}) {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [onClose])

  return <div className="image-lightbox" role="presentation" onMouseDown={onClose}>
    <section className="image-lightbox-panel" role="dialog" aria-modal="true" aria-label="Generated image preview" onMouseDown={event => event.stopPropagation()}>
      <header><strong>Generated image</strong><span><a href={image.url} target="_blank" rel="noreferrer">Open original</a><button type="button" onClick={onClose} aria-label="Close image preview" autoFocus><X /></button></span></header>
      <div className="image-lightbox-canvas"><img src={image.url} alt={image.prompt} /></div>
      <p>{image.prompt}</p>
    </section>
  </div>
}

function AgentStreamingResponse({ status, activity, responseText }: {
  status: 'queued' | 'running' | 'complete' | 'failed'
  activity?: 'searching_web' | 'generating_image' | 'using_computer'
  responseText?: string
}) {
  const activityLabel = status === 'queued'
    ? 'Preparing context'
    : activity === 'searching_web'
      ? 'Checking public sources'
      : activity === 'generating_image'
        ? 'Creating your image'
        : activity === 'using_computer'
          ? 'Working in the live browser'
          : responseText ? 'Writing the answer' : 'Reasoning privately'
  const hasText = Boolean(responseText)

  return <div className={`agent-stream-response ${hasText ? 'has-text' : ''}`}>
    <details className="agent-reasoning-trace" open={!hasText}>
      <summary aria-label={`${activityLabel}. ${hasText ? 'Response is streaming' : 'In progress'}`}>
        <span className="agent-stream-pulse"><ThinkingState /></span>
        <strong>{activityLabel}</strong>
        <span>{hasText ? 'STREAMING' : 'IN PROGRESS'}</span>
      </summary>
      <div className="agent-stream-steps" aria-label="Saathi activity">
        <span className="done"><Check /> Request understood</span>
        <span className={hasText ? 'done' : 'active'}>{hasText ? <Check /> : <i />} {activityLabel}</span>
        <span className={hasText ? 'active' : ''}><i /> Writing response</span>
      </div>
      <p>Private reasoning is not shown. Tool use, sources, and consequential actions remain visible.</p>
    </details>
    {responseText && <div className="streaming-markdown"><AssistantText text={responseText} /><i className="response-stream-cursor" aria-hidden="true" /></div>}
  </div>
}

function VoiceCallOverlay({ status, turns, activities, computerTool, voiceLevel, voiceSeconds, onMute, onEnd }: {
  status: VoiceStatus
  turns: VoiceTurn[]
  activities: VoiceToolActivity[]
  computerTool: {
    callId: string
    task: string
    liveViewUrl?: string
    interactiveLiveViewUrl?: string
    phase?: string
    selectedActionLabel?: string
    decisionConfidence?: number
    controller?: 'jev'
  } | null | undefined
  voiceLevel: number
  voiceSeconds: number
  onMute: () => void
  onEnd: () => void
}) {
  const transcriptEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' })
  }, [turns])

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previousOverflow }
  }, [])

  const statusText = status === 'requesting'
    ? 'Waiting for microphone access…'
    : status === 'connecting'
      ? 'Connecting securely…'
      : status === 'ending'
        ? 'Finishing your call…'
        : status === 'muted'
          ? 'Microphone muted'
          : turns.at(-1)?.role === 'assistant' ? 'Saathi is speaking' : 'Listening'
  return <div className="voice-call-backdrop" role="dialog" aria-modal="true" aria-labelledby="voice-call-title">
    <section className={`voice-call-sheet voice-state-${status}`}>
      <header className="voice-call-header">
        <div><span>VOICE SESSION / GPT LIVE</span><h2 id="voice-call-title">Talking with Saathi</h2></div>
        <div className="voice-call-status-group"><span className={`voice-call-status ${status === 'muted' ? 'is-muted' : ''}`}><i />{statusText}</span><small>{formatVoiceDuration(voiceSeconds)} · est. {formatVoiceCost(voiceSeconds / 60 * 0.05)}</small></div>
      </header>
      <div className={`voice-call-body ${activities.length ? 'has-activity' : ''}`}>
        <div className="voice-call-presence">
          <div className="voice-orb-stage">
            <VoiceBlob level={voiceLevel} muted={status === 'muted'} />
          </div>
          <div className="voice-live-transcript" aria-live="polite" aria-label="Live call transcript">
            {turns.length === 0
              ? <div className="voice-transcript-placeholder"><AudioLines /><p>{status === 'live' || status === 'muted' ? 'Start speaking. Your words will appear here.' : 'Your live transcript will appear here.'}</p></div>
              : turns.map((turn, index) => <div className={`voice-caption ${turn.role}`} key={`${turn.role}-${turn.startMs}-${index}`}>
                  <strong>{turn.role === 'user' ? 'You' : 'Saathi'}</strong>
                  <p>{turn.text}{index === turns.length - 1 && <i className="transcript-cursor" />}</p>
                </div>)}
            <div ref={transcriptEndRef} />
          </div>
        </div>
        {activities.length > 0 && <VoiceActivityPanel activities={activities} computerTool={computerTool} />}
      </div>
      <footer className="voice-call-controls">
        <button type="button" className={status === 'muted' ? 'is-muted' : ''} onClick={onMute} disabled={!['live', 'muted'].includes(status)} aria-label={status === 'muted' ? 'Unmute microphone' : 'Mute microphone'}>
          {status === 'muted' ? <MicOff /> : <Mic />}<span>{status === 'muted' ? 'Unmute' : 'Mute'}</span>
        </button>
        <button type="button" className="end-call-control" onClick={onEnd} disabled={status === 'ending'} aria-label="End voice call">
          <PhoneOff /><span>{status === 'ending' ? 'Ending…' : 'End call'}</span>
        </button>
      </footer>
    </section>
  </div>
}

function VoiceActivityPanel({ activities, computerTool }: {
  activities: VoiceToolActivity[]
  computerTool: {
    callId: string
    task: string
    liveViewUrl?: string
    interactiveLiveViewUrl?: string
    phase?: string
    selectedActionLabel?: string
    decisionConfidence?: number
    controller?: 'jev'
  } | null | undefined
}) {
  const activityListRef = useRef<HTMLDivElement>(null)
  const hasRunningActivity = activities.some(activity => activity.status === 'running')

  useEffect(() => {
    const list = activityListRef.current
    const current = list?.querySelector('.voice-activity-card.running') ?? list?.lastElementChild
    current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [activities, computerTool?.liveViewUrl, computerTool?.interactiveLiveViewUrl])

  return <aside className="voice-activity-panel" aria-label="Saathi actions" aria-live="polite">
    <header><span>Working with you</span><small>Actions and handoffs stay in this call</small></header>
    <div className="voice-activity-list" ref={activityListRef}>
      {activities.map(activity => {
        const liveViewUrl = computerTool?.callId === activity.id
          ? computerTool.interactiveLiveViewUrl || computerTool.liveViewUrl
          : ''
        const compact = hasRunningActivity && activity.status === 'complete'
        return <article className={`voice-activity-card ${activity.status} ${compact ? 'compact' : ''}`} key={activity.id}>
          <div className="voice-activity-heading">
            <span className="voice-activity-icon">{voiceActivityIcon(activity.name)}</span>
            <span><strong>{activity.title}</strong><small>{activity.status === 'running' ? 'In progress' : activity.status === 'complete' ? 'Done' : 'Needs attention'}</small></span>
            {activity.status === 'running' ? <i className="voice-activity-spinner" /> : activity.status === 'complete' ? <Check /> : <X />}
          </div>
          {!compact && activity.detail && <p className="voice-activity-detail">{activity.detail}</p>}
          {computerTool?.callId === activity.id && computerTool.controller === 'jev' && <p className="voice-browser-decision">
            <strong>Jev browser controller</strong>
            <span>{voiceBrowserPhaseLabel(computerTool.phase)}{computerTool.selectedActionLabel ? ` · ${computerTool.selectedActionLabel}` : ''}</span>
          </p>}
          {liveViewUrl && <div className="voice-computer-handoff">
            <div><Monitor /><span><strong>Your turn in the browser</strong><small>Sign in here if needed. Saathi never asks for your password.</small></span></div>
            <a href={liveViewUrl} target="_blank" rel="noreferrer">Open full browser</a>
            <iframe title="Saathi voice live browser" src={liveViewUrl} allow="clipboard-write" referrerPolicy="no-referrer" />
          </div>}
          {!compact && activity.imageUrl && <figure className="voice-generated-image"><img src={activity.imageUrl} alt={activity.detail} /><figcaption>Created and saved in this conversation</figcaption></figure>}
          {!compact && activity.result && activity.name === 'search_public_web'
            ? <div className="voice-activity-result"><AssistantText text={activity.result} /></div>
            : !compact && activity.result && <p className="voice-activity-result">{activity.result}</p>}
        </article>
      })}
    </div>
  </aside>
}

function voiceActivityIcon(name: VoiceToolActivity['name']) {
  if (name === 'search_public_web') return <Search />
  if (name === 'generate_image') return <ImageIcon />
  if (name === 'use_computer') return <Monitor />
  if (name === 'remember' || name === 'recall') return <Sparkles />
  return <Settings2 />
}

function voiceBrowserPhaseLabel(phase: string | undefined) {
  if (phase === 'awaiting_human_login') return 'Waiting for you to sign in'
  if (phase === 'awaiting_confirmation') return 'Waiting for confirmation'
  if (phase === 'voice_handover') return 'Handed back to voice'
  if (phase === 'observing') return 'Reading the page'
  if (phase === 'deciding') return 'Choosing a safe action'
  if (phase === 'executing') return 'Applying the selected action'
  return 'Ready for your next instruction'
}

function isVoiceCallOpen(status: VoiceStatus) {
  return status === 'requesting' || status === 'connecting' || status === 'live' || status === 'muted' || status === 'ending'
}

function AssistantText({ text }: { text: string }) {
  return <div className="assistant-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{
    a: ({ href, children }) => href?.startsWith('https://')
      ? <a href={href} target="_blank" rel="noreferrer">{children}</a>
      : <span>{children}</span>,
  }}>{text}</ReactMarkdown></div>
}

function MentionText({ text, mentions }: { text: string; mentions?: Doc<'messages'>['mentions'] }) {
  if (!mentions?.length) return text
  const handles = new Set(mentions.map(mention => mention.username.toLowerCase()))
  return text.split(/(@[a-z][a-z0-9_]*)/gi).map((part, index) => {
    const username = part.startsWith('@') ? part.slice(1).toLowerCase() : ''
    return handles.has(username) ? <mark className="chat-mention" key={`${part}-${index}`}>{part}</mark> : part
  })
}

function ImagePromptBox({ prompt, style, onPrompt, onStyle, onCancel, onApprove }: {
  prompt: string
  style: (typeof IMAGE_PRESETS)[number]['id']
  onPrompt: (value: string) => void
  onStyle: (value: (typeof IMAGE_PRESETS)[number]['id']) => void
  onCancel: () => void
  onApprove: () => void
}) {
  const selected = IMAGE_PRESETS.find(preset => preset.id === style)
  return <Card className="image-prompt-box" role="dialog" aria-label="Create an image">
    <label htmlFor="image-prompt">What should Saathi draw?</label>
    <Textarea id="image-prompt" value={prompt} onChange={event => onPrompt(event.target.value)} rows={2} placeholder="A family rangoli by the door, in Hindi labels…" />
    <details className="image-style-disclosure">
      <summary>Style: {selected?.label ?? 'Warm household'} <small>Optional</small></summary>
      <label id="image-style-label">Choose a style</label>
      <Select value={style} onValueChange={value => onStyle(value as (typeof IMAGE_PRESETS)[number]['id'])}>
        <SelectTrigger aria-labelledby="image-style-label"><SelectValue /></SelectTrigger>
        <SelectContent>{IMAGE_PRESET_GROUPS.map(group => <SelectGroup key={group}>
          <SelectLabel>{imagePresetGroupLabel(group)}</SelectLabel>
          {IMAGE_PRESETS.filter(preset => preset.group === group).map(preset => <SelectItem value={preset.id} key={preset.id}>{preset.label} — {preset.hint}</SelectItem>)}
        </SelectGroup>)}</SelectContent>
      </Select>
    </details>
    <div className="inbox-actions">
      <Button type="button" size="sm" onClick={onApprove} disabled={!prompt.trim()}>Add prompt to message</Button>
      <Button type="button" size="sm" variant="secondary" onClick={onCancel}>Cancel</Button>
    </div>
  </Card>
}

function ShareFamilyMailButtons({ item, family, families, onShareHere, onShareThere }: {
  item: Doc<'inboxItems'>
  family: FamilyRow
  families: FamilyRow[]
  onShareHere: (inboxItemId: Id<'inboxItems'>) => void
  onShareThere: (inboxItemId: Id<'inboxItems'>, spaceId: Id<'spaces'>) => void
}) {
  const others = families.filter(row => row.space._id !== family.space._id && !item.forwardedSpaceIds?.includes(row.space._id))
  return <div className="share-family-mail-row">
    {!item.sharedAt && <button type="button" className="share-family-mail" onClick={() => onShareHere(item._id)}>Share with {family.space.name}</button>}
    {others.map(row => <button type="button" className="share-family-mail" key={row.space._id} onClick={() => onShareThere(item._id, row.space._id)}>Also share with {row.space.name}</button>)}
  </div>
}

function CreateFamilyDialog({ ownedCount, onClose, onCreated, createSpace }: {
  ownedCount: number
  onClose: () => void
  onCreated: (spaceId: Id<'spaces'>) => void
  createSpace: (args: { name: string; creationKey: string }) => Promise<Id<'spaces'>>
}) {
  const createInbox = useAction(api.agentmailInboxes.createForFamily)
  const [name, setName] = useState('')
  const [wantInbox, setWantInbox] = useState(true)
  const [alias, setAlias] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const spaceId = await createSpace({ name, creationKey: crypto.randomUUID().replaceAll('-', '') })
      if (wantInbox) {
        try {
          await createInbox({ spaceId, username: alias.trim() || undefined })
        } catch (caught) {
          setError(familyInboxError(caught))
        }
      }
      onCreated(spaceId)
    } catch (caught) {
      setError(convexErrorCode(caught) === 'FAMILY_LIMIT'
        ? 'You can own up to 3 families.'
        : 'We could not create this family. Please try again.')
      setBusy(false)
    }
  }
  return <div className="family-dialog-backdrop" role="presentation" onMouseDown={onClose}>
    <section className="family-dialog" role="dialog" aria-modal="true" aria-labelledby="create-family-title" onMouseDown={event => event.stopPropagation()}>
      <header><div><span>New family</span><h2 id="create-family-title">Create another family space</h2></div><Button variant="ghost" size="icon" type="button" onClick={onClose} aria-label="Close"><X /></Button></header>
      <p>You own {ownedCount} of 3 families. Each family keeps its chats, inbox, and Saathi separate.</p>
      <form className="dark-connect-card" onSubmit={submit}>
        <label htmlFor="new-family-name">Family name</label>
        <Input id="new-family-name" value={name} onChange={event => { setName(event.target.value); if (!alias || alias === suggestFamilyAliasFromName(name)) setAlias(suggestFamilyAliasFromName(event.target.value)) }} minLength={2} maxLength={80} required autoFocus />
        <Label className="alias-toggle" htmlFor="additional-family-inbox"><Checkbox id="additional-family-inbox" checked={wantInbox} onCheckedChange={checked => setWantInbox(checked === true)} /> Create a family email address</Label>
        {wantInbox && <FamilyAliasFields alias={alias} onAlias={setAlias} />}
        <Button type="submit" disabled={busy || name.trim().length < 2}>{busy ? 'Creating…' : 'Create family'}</Button>
        {error && <small role="alert">{error}</small>}
      </form>
    </section>
  </div>
}

function ConnectInbox({ spaceId }: { spaceId: Id<'spaces'> }) {
  const createInbox = useAction(api.agentmailInboxes.createForFamily)
  const [alias, setAlias] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await createInbox({ spaceId, username: alias.trim() || undefined })
    } catch (caught) {
      setError(familyInboxError(caught))
      setBusy(false)
    }
  }

  return <form className="dark-connect-card" onSubmit={submit}><label><Settings2 /> Family email inbox</label><p>Choose an unused alias, then create a private address for this family.</p><FamilyAliasFields alias={alias} onAlias={setAlias} /><Button type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create inbox'}</Button>{error && <small role="alert">{error}</small>}</form>
}

function FamilyAliasFields({ alias, onAlias }: { alias: string; onAlias: (value: string) => void }) {
  const checkAlias = useAction(api.agentmailInboxes.checkAlias)
  const [status, setStatus] = useState('')
  const [checking, setChecking] = useState(false)
  const check = async () => {
    if (!alias.trim()) return
    setChecking(true)
    setStatus('')
    try {
      const result = await checkAlias({ username: alias })
      setStatus(result.available ? `${result.username} is available.` : `${result.username} is already taken.`)
    } catch (caught) {
      setStatus(convexErrorCode(caught) === 'ALIAS_INVALID'
        ? 'Use 3–32 lowercase letters, numbers, and single hyphens.'
        : 'Could not check that address. Try again.')
    } finally {
      setChecking(false)
    }
  }
  return <div className="family-alias-fields">
    <label htmlFor="family-alias">Family email alias</label>
    <div className="family-alias-row">
      <Input id="family-alias" value={alias} onChange={event => onAlias(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))} placeholder="kapoor-family" minLength={3} maxLength={32} />
      <Button variant="outline" type="button" onClick={() => void check()} disabled={checking || alias.trim().length < 3}>{checking ? 'Checking…' : 'Check'}</Button>
    </div>
    <small>We’ll ask AgentMail if this address is free before creating it.</small>
    {status && <small role="status">{status}</small>}
  </div>
}

function ModelTierControls({ spaceId }: { spaceId: Id<'spaces'> }) {
  const usage = useQuery(api.spaces.usageBreakdown, { spaceId })
  const setModelTier = useMutation(api.spaces.setModelTier)
  const tiers = [
    { id: 'low' as const, label: 'Low', detail: 'DeepSeek Flash' },
    { id: 'med' as const, label: 'Med', detail: 'Luna mid' },
    { id: 'high' as const, label: 'High', detail: 'Grok 4.6 mid' },
    { id: 'ultra' as const, label: 'Ultra', detail: 'Sol high' },
  ]
  return <div className="model-tier-card">
    <p>Owners choose how hard Saathi thinks. Medium is the default.</p>
    <div className="model-tier-picker" role="radiogroup" aria-label="Family model">
      {tiers.map(tier => (
        <button type="button" key={tier.id} role="radio" aria-checked={(usage?.tier ?? 'med') === tier.id} className={(usage?.tier ?? 'med') === tier.id ? 'selected' : ''} onClick={() => void setModelTier({ spaceId, tier: tier.id })}>
          <strong>{tier.label}</strong>
          <small>{tier.detail}</small>
        </button>
      ))}
    </div>
    <div className="usage-ledger">
      <span>Usage ledger</span>
      {(usage?.rows ?? []).length === 0 && usage !== undefined && <p>No metered usage yet. Chat, images, and voice will appear here.</p>}
      {(usage?.rows ?? []).length > 0 && <ul className="usage-list">{usage!.rows.map(row => <li key={`${row.provider}-${row.model}-${row.unit}-${row.costClass}`}><strong>{row.model}</strong><small>{formatUsageQuantity(row.quantity, row.unit)}{row.costUsd !== undefined ? ` · est. ${formatVoiceCost(row.costUsd)}` : ''} · {row.costClass}</small></li>)}</ul>}
      {(usage?.entries ?? []).length > 0 && <ul className="usage-entries">{usage!.entries.map(entry => <li key={entry._id}><strong>{entry.costClass}</strong><small>{formatUsageQuantity(entry.quantity, entry.unit)}{entry.costUsd !== undefined ? ` · est. ${formatVoiceCost(entry.costUsd)}` : ''} · {entry.model} · {formatRelativeTime(entry.createdAt)}</small></li>)}</ul>}
    </div>
  </div>
}

function ByokKeys({ spaceId }: { spaceId: Id<'spaces'> }) {
  const keys = useQuery(api.spaces.providerKeyStatus, { spaceId })
  const saveKey = useMutation(api.spaces.saveProviderKey)
  const removeKey = useMutation(api.spaces.removeProviderKey)
  const [provider, setProvider] = useState<'openai' | 'openrouter' | 'codex'>('openrouter')
  const [secret, setSecret] = useState('')
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [removingProvider, setRemovingProvider] = useState<'openai' | 'openrouter' | 'codex' | null>(null)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setFeedback('')
    try {
      await saveKey({ spaceId, provider, secret })
      setSecret('')
      setFeedback('Saved. Saathi will use this key for this family.')
    } catch {
      setFeedback('That key could not be saved. Check the prefix and try again.')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (providerToRemove: 'openai' | 'openrouter' | 'codex') => {
    setBusy(true)
    setFeedback('')
    try {
      await removeKey({ spaceId, provider: providerToRemove })
      setFeedback('Key removed. Add another key before using this provider again.')
      setRemovingProvider(null)
    } catch {
      setFeedback('That key could not be removed. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return <div className="byok-card">
    <p>Paste an OpenRouter, OpenAI, or Codex API key. OpenRouter powers chat, images, routing, and safety decisions for BYOK families. The secret is encrypted and only its last four characters are shown.</p>
    <form onSubmit={submit}>
      <div className="chip-row" role="radiogroup" aria-label="Provider">
        {([
          { id: 'openai' as const, label: 'OpenAI API' },
          { id: 'openrouter' as const, label: 'OpenRouter' },
          { id: 'codex' as const, label: 'Codex' },
        ]).map(option => (
          <button type="button" key={option.id} role="radio" aria-checked={provider === option.id} className={provider === option.id ? 'selected' : ''} onClick={() => setProvider(option.id)}>{option.label}</button>
        ))}
      </div>
      <Input type="password" autoComplete="off" value={secret} onChange={event => setSecret(event.target.value)} placeholder={provider === 'openrouter' ? 'sk-or-…' : 'sk-…'} aria-label="API key" required />
      <Button type="submit" disabled={busy || secret.trim().length < 20}>{busy ? 'Saving…' : 'Save key'}</Button>
    </form>
    {feedback && <small role="status">{feedback}</small>}
    {(keys ?? []).map(key => <div className="byok-row" key={key.provider}>
      <span><strong>{key.provider === 'openrouter' ? 'OpenRouter' : key.provider === 'codex' ? 'Codex' : 'OpenAI'}</strong><small>ending {key.lastFour}</small></span>
      {removingProvider === key.provider
        ? <span className="byok-remove-confirm"><button type="button" onClick={() => void remove(key.provider)} disabled={busy}>Confirm remove</button><button type="button" onClick={() => setRemovingProvider(null)} disabled={busy}>Cancel</button></span>
        : <button type="button" onClick={() => setRemovingProvider(key.provider)}>Remove</button>}
    </div>)}
  </div>
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
  return <div className="invite-member-card"><form onSubmit={submit}><label htmlFor={`invite-email-${spaceId}`}><UserPlus /> Invite by email</label><Input id={`invite-email-${spaceId}`} type="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="family@example.com" required /><div className="chip-row" role="radiogroup" aria-label="Invitation role">{(['member', 'owner'] as const).map(option => <Button variant="outline" type="button" key={option} role="radio" aria-checked={role === option} className={role === option ? 'selected' : ''} onClick={() => setRole(option)}>{option === 'owner' ? 'Owner' : 'Member'}</Button>)}<Button type="submit" disabled={busy}>{busy ? 'Sending…' : 'Invite'}</Button></div></form>{feedback && <small role="status">{feedback}</small>}{pending.map(invitation => <div className="pending-invitation" key={invitation._id}><span><strong>{invitation.targetEmail}</strong><small>{invitation.role} · expires {new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(invitation.expiresAt)}</small></span><Button variant="outline" type="button" onClick={() => void revokeInvitation({ invitationId: invitation._id })}>Revoke</Button></div>)}</div>
}

function InvitationError({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  const { signOut } = useAuthActions()
  return <main className="centered-status"><Mail size={34} /><h1>Could not accept invitation</h1><p>{message}</p><div className="status-actions"><Button className="primary" onClick={() => void signOut()}>Sign in with another email</Button><Button variant="outline" className="secondary" onClick={onDismiss}>Open my workspace</Button></div></main>
}

function LiveStatus({ message }: { message: string }) {
  return <main className="centered-status"><div className="status-spinner" /><p>{message}</p></main>
}

function FamilyUnreadBadge({ spaceId }: { spaceId: Id<'spaces'> }) {
  const unreadCount = useQuery(api.inbox.unreadCount, { spaceId })
  if (!unreadCount) return null
  const label = `${unreadCount} unread family inbox ${unreadCount === 1 ? 'item' : 'items'}`
  return <b className="notification-badge" aria-label={label}>{unreadCount > 99 ? '99+' : unreadCount}</b>
}

function FamilyUpdates({ family, items, onBack }: { family: FamilyRow; items: Doc<'inboxItems'>[] | undefined; onBack: () => void }) {
  const confirmAction = useMutation(api.inbox.confirmAction)
  const dismissAction = useMutation(api.inbox.dismissAction)
  const reprocess = useMutation(api.inbox.reprocess)
  const markSeen = useMutation(api.inbox.markSeen)
  const [openItem, setOpenItem] = useState<Doc<'inboxItems'> | null>(null)

  useEffect(() => {
    if (!items?.[0]) return
    void markSeen({ inboxItemId: items[0]._id })
  }, [items, markSeen])

  return <section className="conversation-pane inbox-pane">
    <header className="conversation-header live-room-header">
      <button className="mobile-chat-back" onClick={onBack} aria-label="Back to chats"><ArrowLeft /></button>
      <div><div className="title-line"><h2>Family inbox</h2><span className="live-label"><LockKeyhole /> Live</span></div><p>{family.space.name} · shared household mail only</p></div>
    </header>
    <div className="conversation-feed live-feed inbox-feed">
      {items === undefined && <div className="dark-loading"><i /><i /><i /></div>}
      {items?.length === 0 && <div className="dark-empty-state compact"><Bell /><h2>No shared family mail yet</h2><p>Money mail stays in My Saathi until someone shares it here.</p></div>}
      {items?.map(item => <article className="person-message inbox-card" key={item._id}>
        <span className="message-avatar email"><Mail /></span>
        <div>
          <h3><button type="button" className="inbox-subject-button" onClick={() => setOpenItem(item)}>{item.subject}</button> <small>{categoryLabel(item.category)} · {item.direction === 'outgoing' ? 'outgoing' : 'incoming'} · {formatRelativeTime(item.receivedAt)}</small></h3>
          <div className="simple-message inbox-message-card">
            <p className="inbox-sender">{displaySender(item.sender)}</p>
            {item.extractedMerchant && <p>Merchant: {item.extractedMerchant}</p>}
            {item.extractedAmountInr && <p>INR: {item.extractedAmountInr}</p>}
            {item.extractedAmountUsd && <p>USD: {item.extractedAmountUsd}</p>}
            {!item.extractedAmountInr && !item.extractedAmountUsd && item.extractedAmount && <p>Amount: {item.extractedAmount}</p>}
            {item.extractedPeriod && <p>Period: {item.extractedPeriod}</p>}
            {item.extractedDueAt && <p>Due: {new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(item.extractedDueAt)}</p>}
            {item.status === 'processing' && <p className="inbox-status">DeepSeek Flash is extracting the useful values…</p>}
            {item.status === 'failed' && <p className="inbox-status">Values are not available yet. Run extraction again below.</p>}
            {item.documentParseStatus === 'parsed' && <p>Attached PDF read successfully.</p>}
            {item.documentParseStatus === 'password' && <p>{item.processingNotes || 'A password-protected PDF needs a hint from the email body.'}</p>}
            {item.processingNotes && item.documentParseStatus !== 'password' && <p>{item.processingNotes}</p>}
            {(item.suggestedActions ?? []).map(action => <p key={`${item._id}-${action.kind}`}>{action.label}{action.detail ? ` — ${action.detail}` : ''}</p>)}
            <div className="inbox-actions">
              <button type="button" className="secondary icon-action" onClick={() => setOpenItem(item)} aria-label={`Open email: ${item.subject}`} title="Open email"><MailOpen /></button>
              {canReadGmailPdf(item) && <button type="button" className="secondary" onClick={() => void reprocess({ inboxItemId: item._id })}>Read attached PDF</button>}
              {item.status !== 'processing' && item.documentParseStatus === 'failed' && item.documentParseRetryable !== false && <button type="button" className="secondary icon-action" onClick={() => void reprocess({ inboxItemId: item._id })} aria-label="Try reading attached PDF again" title="Try reading PDF again"><RefreshCcw /></button>}
              {item.status === 'failed' && item.documentParseStatus !== 'failed' && <button type="button" className="secondary" onClick={() => void reprocess({ inboxItemId: item._id })}>Extract values with Flash</button>}
            </div>
            {item.actionStatus === 'suggested' && <div className="inbox-actions">
              <button type="button" onClick={() => void confirmAction({ inboxItemId: item._id })}>Approve suggested next step</button>
              <button type="button" className="secondary" onClick={() => void dismissAction({ inboxItemId: item._id })}>Dismiss suggestion</button>
            </div>}
            {item.documentParseStatus === 'failed' && item.documentParseRetryable === false && <small>Retry disabled. Fix the PDF source or provider setup before trying again.</small>}
            {item.actionStatus === 'confirmed' && <small>Suggested next step approved. Nothing was sent or changed.</small>}
          </div>
        </div>
      </article>)}
    </div>
    {openItem && <EmailDetailDialog item={openItem} onClose={() => setOpenItem(null)} />}
  </section>
}

function EmailDetailDialog({ item, onClose }: { item: Doc<'inboxItems'>; onClose: () => void }) {
  const [loadRemoteImages, setLoadRemoteImages] = useState(false)
  const onCloseRef = useRef(onClose)
  const documentHtml = useMemo(() => buildSafeEmailDocument(item, loadRemoteImages), [item, loadRemoteImages])

  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow
    const closeOnEscape = (event: globalThis.KeyboardEvent) => event.key === 'Escape' && onCloseRef.current()
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', closeOnEscape)
      previouslyFocused?.focus()
    }
  }, [])

  return <div className="email-detail-backdrop" role="presentation" onMouseDown={onClose}>
    <section className="email-detail-dialog" role="dialog" aria-modal="true" aria-labelledby="email-detail-title" onMouseDown={event => event.stopPropagation()}>
      <header>
        <div><span>{displaySender(item.sender)}</span><h2 id="email-detail-title">{item.subject}</h2><small>{categoryLabel(item.category)} · {formatRelativeTime(item.receivedAt)}</small></div>
        <button type="button" onClick={onClose} aria-label="Close email" autoFocus><X /></button>
      </header>
      <div className="email-detail-controls">
        <span>Links open in a new tab. Scripts and forms are blocked.</span>
        {!loadRemoteImages && <button type="button" onClick={() => setLoadRemoteImages(true)}>Load remote images</button>}
      </div>
      <iframe
        className="email-detail-frame"
        title={`Email: ${item.subject}`}
        sandbox="allow-popups allow-popups-to-escape-sandbox"
        referrerPolicy="no-referrer"
        srcDoc={documentHtml}
      />
    </section>
  </div>
}

function buildSafeEmailDocument(item: Doc<'inboxItems'>, loadRemoteImages: boolean) {
  const raw = emailBodyHtml(item.originalHtml, item.originalText)
  const sanitized = DOMPurify.sanitize(raw, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'textarea', 'select', 'option'],
  })
  const parsed = new DOMParser().parseFromString(String(sanitized), 'text/html')
  parsed.querySelectorAll('a[href]').forEach(link => {
    link.setAttribute('target', '_blank')
    link.setAttribute('rel', 'noopener noreferrer')
  })
  if (!loadRemoteImages) {
    parsed.querySelectorAll('img[src]').forEach(image => {
      const src = image.getAttribute('src') ?? ''
      if (!/^(data:|blob:)/i.test(src)) {
        image.removeAttribute('src')
        image.setAttribute('data-remote-image-blocked', 'true')
        image.setAttribute('title', 'Remote image blocked for privacy')
      }
    })
  }
  const imageSources = loadRemoteImages ? 'data: blob: https: http:' : 'data: blob:'
  const emailStyles = Array.from(parsed.head.querySelectorAll('style')).map(style => style.outerHTML).join('')
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${imageSources}; style-src 'unsafe-inline'; font-src data:; base-uri 'none'; form-action 'none'"><style>html{color:#273246;background:#fffdf8;font:16px/1.55 ui-sans-serif,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}body{max-width:760px;margin:0 auto;padding:24px;overflow-wrap:anywhere}img{max-width:100%;height:auto}img[data-remote-image-blocked]{display:none}a{color:#234d86;text-decoration:underline}table{max-width:100%;border-collapse:collapse}pre{white-space:pre-wrap}</style>${emailStyles}</head><body>${parsed.body.innerHTML}</body></html>`
}

function FamilyFiles({ family, files, onBack, onOpenRoom }: {
  family: FamilyRow
  files: Array<{ _id: Id<'attachments'>; fileName: string; mediaType: string; sizeBytes: number; createdAt: number; url: string | null; roomId: Id<'rooms'>; roomTitle: string }> | undefined
  onBack: () => void
  onOpenRoom: (roomId: Id<'rooms'>) => void
}) {
  return <section className="conversation-pane">
    <header className="conversation-header live-room-header">
      <button className="mobile-chat-back" onClick={onBack} aria-label="Back to chats"><ArrowLeft /></button>
      <div><div className="title-line"><h2>Files</h2><span className="live-label"><LockKeyhole /> Live</span></div><p>{family.space.name} · stored in Convex</p></div>
    </header>
    <div className="conversation-feed live-feed">
      {files === undefined && <div className="dark-loading"><i /><i /><i /></div>}
      {files?.length === 0 && <div className="dark-empty-state compact"><Folder /><h2>No files yet</h2><p>Photos and documents you share in chats are stored in Convex file storage.</p></div>}
      {files?.map(file => <article className="outgoing-message attachment-message" key={file._id}>
        <span>{file.roomTitle} · {formatRelativeTime(file.createdAt)}</span>
        {file.mediaType.startsWith('image/') && file.url
          ? <a className="shared-image" href={file.url} target="_blank" rel="noreferrer"><img src={file.url} alt={file.fileName} /><small>{file.fileName} · {formatFileSize(file.sizeBytes)}</small></a>
          : <a className="shared-document" href={file.url ?? undefined} target="_blank" rel="noreferrer" aria-disabled={!file.url}><FileText /><span><strong>{file.fileName}</strong><small>{formatFileSize(file.sizeBytes)}</small></span></a>}
        <button type="button" className="open-file-room icon-action" onClick={() => onOpenRoom(file.roomId)} aria-label={`Open ${file.roomTitle} conversation`} title="Open conversation"><MessageSquareText /></button>
      </article>)}
    </div>
  </section>
}

function languageLabel(value: 'en' | 'hi' | 'mr' | undefined) {
  return value === 'hi' ? 'Hindi' : value === 'mr' ? 'Marathi' : 'English'
}

function imagePresetGroupLabel(value: typeof IMAGE_PRESET_GROUPS[number]) {
  if (value === 'infographic') return 'Infographics'
  if (value === 'devotional') return 'Devotional'
  if (value === 'art') return 'Art'
  return 'Family'
}

function imageKindLabel(value: 'scene' | 'infographic' | 'devotional' | undefined) {
  if (value === 'infographic') return 'infographic'
  if (value === 'devotional') return 'devotional image'
  return 'generated image'
}

function computerViewUrl(job: { computerInteractiveLiveViewUrl?: string; computerLiveViewUrl?: string }) {
  return job.computerInteractiveLiveViewUrl || job.computerLiveViewUrl || ''
}

function initialsFor(value: string) {
  const clean = value.includes('<') ? value.split('<')[0].trim() : value.split('@')[0]
  return clean.split(/\s|[._-]/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'F'
}

function displaySender(value: string) {
  return value.match(/^\s*([^<]+)\s*</)?.[1]?.trim() || value
}

function categoryLabel(category: Doc<'inboxItems'>['category']) {
  if (category === 'needs_review') return 'Needs review'
  if (category === 'bank') return 'Bank'
  if (category === 'receipts') return 'Purchase'
  return category.charAt(0).toUpperCase() + category.slice(1)
}

function gmailSpaceFromUrl() {
  const value = new URLSearchParams(window.location.search).get('gmailSpace')
  return value ? value as Id<'spaces'> : null
}

function gmailCallbackFromUrl() {
  const params = new URLSearchParams(window.location.search)
  const spaceId = params.get('gmailSpace')
  if (!spaceId || !params.has('status')) return null
  return {
    spaceId: spaceId as Id<'spaces'>,
    status: params.get('status'),
    connectedAccountId: params.get('connected_account_id') ?? params.get('connectedAccountId'),
  }
}

function clearGmailCallback() {
  const url = new URL(window.location.href)
  url.searchParams.delete('gmailSpace')
  url.searchParams.delete('status')
  url.searchParams.delete('connected_account_id')
  url.searchParams.delete('connectedAccountId')
  window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`)
}

function formatUsageQuantity(quantity: number, unit: string) {
  if (unit === 'token') return `${Math.round(quantity)} tokens`
  if (unit === 'second') return formatVoiceDuration(quantity)
  if (unit === 'audio_hour') return `${Math.max(1, Math.round(quantity * 60))} min audio`
  if (unit === 'request') return `${Math.round(quantity)} ${Math.round(quantity) === 1 ? 'request' : 'requests'}`
  return `${quantity.toFixed(quantity >= 10 ? 0 : 2)} ${unit}`
}

function formatVoiceDuration(seconds: number) {
  const rounded = Math.max(0, Math.round(seconds))
  const minutes = Math.floor(rounded / 60)
  const remainder = rounded % 60
  return minutes ? `${minutes}m ${remainder}s` : `${remainder}s`
}

function formatVoiceCost(costUsd: number) {
  return `$${costUsd.toFixed(4)}`
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

function canReadGmailPdf(item: Doc<'inboxItems'>) {
  if (item.status === 'processing' || item.status === 'failed' || !item.agentmailMessageId.startsWith('gmail:')) return false
  if (item.documentParseStatus === undefined) return true
  return item.documentParseStatus === 'none' && Boolean(item.processingNotes?.includes('no public document link'))
}

function suggestFamilyAliasFromName(name: string) {
  return name.toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32).replace(/-+$/g, '')
}

function familyInboxError(error: unknown) {
  const code = convexErrorCode(error)
  if (code === 'ALIAS_TAKEN') return 'That family email is already used. Try another alias.'
  if (code === 'ALIAS_INVALID') return 'Use 3–32 lowercase letters, numbers, and single hyphens.'
  if (code === 'AGENTMAIL_PERMISSION') return 'The AgentMail key needs organization-level inbox creation access.'
  if (code === 'AGENTMAIL_AUTH') return 'AgentMail rejected the configured API key.'
  if (code === 'AGENTMAIL_RATE_LIMIT') return 'AgentMail is busy. Please wait a moment and try again.'
  return 'We could not create the inbox. Check AgentMail setup and try again.'
}

function convexErrorCode(error: unknown) {
  if (!error || typeof error !== 'object' || !('data' in error)) return ''
  const data = (error as { data?: unknown }).data
  return data && typeof data === 'object' && 'code' in data && typeof data.code === 'string' ? data.code : ''
}

function adminModeFromUrl() {
  return new URLSearchParams(window.location.search).get('admin') === 'access'
}

function openAdminDashboard() {
  const url = new URL(window.location.href)
  url.searchParams.set('mode', 'live')
  url.searchParams.set('admin', 'access')
  window.location.assign(`${url.pathname}${url.search}${url.hash}`)
}

function closeAdminDashboard() {
  const url = new URL(window.location.href)
  url.searchParams.delete('admin')
  window.location.assign(`${url.pathname}${url.search}${url.hash}`)
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
