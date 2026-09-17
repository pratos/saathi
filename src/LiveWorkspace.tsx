import { useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent, type KeyboardEvent } from 'react'
import { useAuthActions } from '@convex-dev/auth/react'
import { useAction, useMutation, useQuery } from 'convex/react'
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
  LockKeyhole,
  LogOut,
  Mail,
  MessageSquareText,
  Mic,
  MicOff,
  Monitor,
  Paperclip,
  PhoneOff,
  Plus,
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
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from './components/ui/select'
import { VoiceBlob } from './VoiceBlob'
import { useLiveVoice, type VoiceStatus, type VoiceToolActivity, type VoiceTurn } from './useLiveVoice'

type FamilyRow = { membership: Doc<'memberships'>; space: Doc<'spaces'> }
type PendingUpload = { id: string; name: string; status: 'uploading' | 'error'; message?: string }
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

  if (currentUser === undefined) return <LiveStatus message="Preparing your Saathi profile…" />
  if (!currentUser.username) return <UsernameSetup onExit={onExit} />
  if (invitationState === 'accepting') return <LiveStatus message="Adding you to the invited family…" />
  if (invitationState === 'error') return <InvitationError message={invitationError} onDismiss={() => { clearInvitationToken(); setInvitationState('idle') }} />
  if (spaces === undefined) return <LiveStatus message="Loading your private family spaces…" />
  if (families.length === 0) return <CreateFirstFamily onExit={onExit} />

  const family = families.find(({ space }) => space._id === selectedSpaceId) ?? families[0]
  return <LiveFamilyShell families={families} family={family} onSelectFamily={setSelectedSpaceId} onExit={onExit} />
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
    <button className="back-link" onClick={onExit}><ArrowLeft /> Leave live mode</button>
    <section className="onboarding-card">
      <Badge className="mode-badge live"><MessageSquareText size={15} /> One last step</Badge>
      <h1>How should your family tag you?</h1>
      <p>Choose a short username for family chats. People can type it after @ when they want your attention.</p>
      <form onSubmit={submit}>
        <label htmlFor="username">Your username</label>
        <div className="username-field"><span aria-hidden="true">@</span><input id="username" value={username} onChange={event => setUsernameDraft(event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))} placeholder="priya_shah" minLength={3} maxLength={24} pattern="[a-z][a-z0-9_]{2,23}" autoComplete="username" required autoFocus /></div>
        <small className="username-help">Start with a letter. Use letters, numbers, or underscores.</small>
        <Button className="primary large" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Continue to chat'} <ArrowRight /></Button>
      </form>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="security-note"><ShieldCheck /><span><strong>Visible only where you belong</strong>Your username appears to people in your shared family chats.</span></div>
    </section>
  </main>
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
        <Badge className="mode-badge live"><LockKeyhole size={15} /> Live workspace</Badge>
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
  const ensurePersonalRoom = useMutation(api.rooms.ensurePersonal)
  const inboxItems = useQuery(api.inbox.list, { spaceId: family.space._id, limit: 20 })
  const foodBudget = useQuery(api.budget.food, { spaceId: family.space._id })
  const setFoodLimit = useMutation(api.budget.setFoodLimit)
  const gmailConnections = useQuery(api.gmailData.mine, { spaceId: family.space._id })
  const [budgetDraft, setBudgetDraft] = useState('')
  const [budgetCurrency, setBudgetCurrency] = useState<'INR' | 'USD'>('INR')
  const [budgetBusy, setBudgetBusy] = useState(false)
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
      .catch(() => setGmailMessage('Gmail connected at Google, but Saath could not finish setup. Please try again.'))
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

  return (
    <main className={`saath-workspace live-conversation-workspace is-mobile-${mobileScreen}${pane === 'family' ? ' is-family-open' : ''}`}>
      <aside className="workspace-rail" aria-label="Main navigation">
        <div className="workspace-logo">स</div>
        <button className={`rail-action ${pane === 'chats' ? 'active' : ''}`} onClick={openHome}><MessageSquareText /><span>Home</span></button>
        <button className={`rail-action ${pane === 'updates' ? 'active' : ''}`} onClick={() => openPane('updates')}><Bell /><span>Inbox</span></button>
        <button className={`rail-action ${pane === 'files' ? 'active' : ''}`} onClick={() => openPane('files')}><Folder /><span>Files</span></button>
        <button className={`rail-action ${pane === 'family' ? 'active' : ''}`} onClick={() => openPane('family')} aria-label="Settings"><Settings2 /><span>Settings</span></button>
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
          <h1>Home</h1>
          <button type="button" onClick={() => openPane('family')} aria-label="Settings"><Settings2 /></button>
        </div>
        <span className="family-select-label" id="family-switcher-label">Current family</span>
        <div className="family-switcher" role="group" aria-labelledby="family-switcher-label">
          {families.map(({ space }) => (
            <button type="button" key={space._id} className={space._id === family.space._id ? 'selected' : ''} onClick={() => onSelectFamily(space._id)}>
              {space.name}
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
        <button className={`conversation-link ${pane === 'updates' ? 'selected' : ''}`} onClick={() => openPane('updates')}><i /><span>Family inbox</span><b>{inboxItems?.length ?? 0}</b></button>
        <button className="dark-sign-out" onClick={() => void signOut()}><LogOut /> Sign out</button>
      </aside>

      {pane === 'updates' ? (
        <FamilyUpdates family={family} items={inboxItems} onBack={openHome} />
      ) : pane === 'files' ? (
        <FamilyFiles family={family} files={spaceFiles} onBack={openHome} onOpenRoom={openRoom} />
      ) : selectedRoom ? (
        <LiveRoom key={selectedRoom._id} room={selectedRoom} family={family} onBack={openHome} onInvite={selectedRoom.type !== 'private' && family.membership.role === 'owner' ? () => setMembersOpen(true) : undefined} />
      ) : (
        <section className="conversation-pane"><header className="conversation-header"><div><h2>{family.space.name}</h2><p>Live · private family data</p></div></header><div className="dark-empty-state"><MessageSquareText /><h2>Your family conversation is getting ready</h2><p>Reload in a moment. New family spaces automatically receive a shared room.</p></div></section>
      )}

      <aside className="conversation-context live-context">
        <header className="conversation-header live-room-header mobile-family-header">
          <button className="mobile-chat-back" onClick={openHome} aria-label="Back to chats"><ArrowLeft /></button>
          <div><div className="title-line"><h2>Settings</h2><span className="live-label"><LockKeyhole /> Live</span></div><p>{family.space.name}</p></div>
        </header>
        <div className="context-title"><div><h2>Settings</h2><p>Change a control here, or ask Saathi in the conversation.</p></div><button onClick={onExit}>Switch mode</button></div>
        <div className="settings-scroll">
        <Card className="settings-intro">
          <MessageSquareText />
          <div><strong>You can just ask</strong><p>Try “Use Hindi for me” or “Set our food budget to ₹15,000.” Voice works the same way.</p></div>
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
        <section className="gmail-connections"><span>Your Gmail</span><p>Useful mail is added privately to My Saathi. Other family members cannot see your connected accounts.</p>
          {(gmailConnections ?? []).map(connection => <div className="gmail-account" key={connection._id}><Mail /><span><strong>{connection.email ?? connection.alias}</strong><small>{connection.lastSyncedAt ? `Checked ${formatRelativeTime(connection.lastSyncedAt)}` : 'Reviewing the last 30 days…'}</small></span><Check /></div>)}
          <button type="button" className="connect-gmail" onClick={() => void connectGmail()} disabled={gmailBusy}><Plus />{gmailConnections?.length ? 'Connect another Gmail' : 'Connect Gmail'}</button>
          {(gmailConnections?.length ?? 0) > 0 && <button type="button" className="connect-gmail secondary" onClick={() => {
            setGmailBusy(true)
            setGmailMessage('Checking connected Gmail…')
            void checkGmailNow({ spaceId: family.space._id })
              .then(count => setGmailMessage(count ? 'Checking inboxes now. New bills and receipts appear in My Saathi first.' : 'No Gmail accounts are connected yet.'))
              .catch(() => setGmailMessage('Could not check Gmail right now.'))
              .finally(() => setGmailBusy(false))
          }} disabled={gmailBusy}>Check for new mail</button>}
          {gmailMessage && <small className="gmail-status" role="status">{gmailMessage}</small>}
        </section>
        <section className="food-budget">
          <span>Food budget</span>
          <p>Approved food receipts, including Swiggy and Zomato, count toward this monthly budget.</p>
          <strong>{foodBudget?.monthlyLimit != null ? `${foodBudget.currency === 'USD' ? '$' : '₹'}${Math.round(foodBudget.spentThisMonth)} of ${foodBudget.currency === 'USD' ? '$' : '₹'}${Math.round(foodBudget.monthlyLimit)} this month` : `${foodBudget?.currency === 'USD' ? '$' : '₹'}${Math.round(foodBudget?.spentThisMonth ?? 0)} tracked this month`}</strong>
          {family.membership.role === 'owner' && <form onSubmit={(event) => { event.preventDefault(); const monthlyLimit = Number(budgetDraft); if (!monthlyLimit) return; setBudgetBusy(true); void setFoodLimit({ spaceId: family.space._id, monthlyLimit, currency: budgetCurrency }).then(() => setBudgetDraft('')).finally(() => setBudgetBusy(false)) }}>
            <div className="chip-row" role="radiogroup" aria-label="Budget currency">
              {(['INR', 'USD'] as const).map(code => <button type="button" key={code} role="radio" aria-checked={budgetCurrency === code} className={budgetCurrency === code ? 'selected' : ''} onClick={() => setBudgetCurrency(code)}>{code}</button>)}
            </div>
            <input type="number" min={budgetCurrency === 'USD' ? 20 : 500} max={budgetCurrency === 'USD' ? 20000 : 1000000} placeholder={budgetCurrency === 'USD' ? 'Monthly limit in $' : 'Monthly limit in ₹'} value={budgetDraft} onChange={(event) => setBudgetDraft(event.target.value)} aria-label="Monthly food budget" /><button type="submit" disabled={budgetBusy || !budgetDraft}>{budgetBusy ? 'Saving…' : 'Set limit'}</button>
          </form>}
        </section>
        <details className="settings-disclosure">
          <summary><span>Advanced settings</span><small>Family inbox address, AI model, and provider keys</small></summary>
          <section><span>Family inbox</span>{family.space.agentmailInboxId
          ? <div className="agentmail-id"><p className="confirmed"><Check /> AgentMail is connected</p><code>{family.space.agentmailInboxId}</code><button type="button" onClick={() => { void navigator.clipboard.writeText(family.space.agentmailInboxId ?? '').then(() => { setCopiedInbox(true); window.setTimeout(() => setCopiedInbox(false), 2_000) }) }}><Copy />{copiedInbox ? 'Copied' : 'Copy ID'}</button></div>
          : family.membership.role === 'owner'
            ? <ConnectInbox spaceId={family.space._id} />
            : <p>Ask a family owner to connect AgentMail.</p>}</section>
          {family.membership.role === 'owner' && <section><span>Family model</span><ModelTierControls spaceId={family.space._id} /></section>}
          {family.membership.role === 'owner' && <section><span>Your provider keys</span><ByokKeys spaceId={family.space._id} /></section>}
        </details>
        {family.membership.role === 'owner' && <details className="settings-disclosure"><summary><span>Family access</span><small>Invite or manage family members</small></summary><section><InviteMember spaceId={family.space._id} /></section></details>}
        </div>
      </aside>
      <nav className="mobile-workspace-nav" aria-label="Workspace">
        <button type="button" className={pane === 'chats' ? 'active' : ''} onClick={openHome}><MessageSquareText /><span>Home</span></button>
        <button type="button" className={pane === 'updates' ? 'active' : ''} onClick={() => openPane('updates')}><Bell /><span>Inbox</span></button>
        <button type="button" className={pane === 'files' ? 'active' : ''} onClick={() => openPane('files')}><Folder /><span>Files</span></button>
        <button type="button" className={pane === 'family' ? 'active' : ''} onClick={() => openPane('family')} aria-label="Settings"><Settings2 /><span>Settings</span></button>
      </nav>
      {membersOpen && <div className="family-dialog-backdrop" role="presentation" onMouseDown={() => setMembersOpen(false)}><section className="family-dialog" role="dialog" aria-modal="true" aria-labelledby="invite-dialog-title" onMouseDown={event => event.stopPropagation()}><header><div><span>Family access</span><h2 id="invite-dialog-title">Invite someone to {family.space.name}</h2></div><button type="button" onClick={() => setMembersOpen(false)} aria-label="Close invitations" autoFocus><X /></button></header><p>They must sign in using the same email address. Invitations expire after seven days.</p><InviteMember spaceId={family.space._id} /></section></div>}
      {createFamilyOpen && <CreateFamilyDialog ownedCount={ownedFamilyCount} onClose={() => setCreateFamilyOpen(false)} onCreated={(spaceId) => { setCreateFamilyOpen(false); onSelectFamily(spaceId) }} createSpace={createSpace} />}
    </main>
  )
}

function LiveRoom({ room, family, onBack, onInvite }: {
  room: Doc<'rooms'>
  family: FamilyRow
  onBack: () => void
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
  const [message, setMessage] = useState('')
  const [imageDraft, setImageDraft] = useState('')
  const [imageOpen, setImageOpen] = useState(false)
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
        <div className="room-header-actions">{onInvite && <button type="button" className="header-invite" onClick={onInvite}><UserPlus /><span>Invite</span></button>}<div className="participant-stack"><span>YOU</span>{room.type !== 'private' && <span>F</span>}<span className="saathi-participant" title="Saathi can help in this conversation">S</span></div></div>
      </header>
      <div className="conversation-feed live-feed">
        {messages === undefined && <div className="dark-loading"><i /><i /><i /></div>}
        {messages && generatedImages && attachments && timeline.length === 0 && !imageOpen && <div className="dark-empty-state compact conversation-starter"><MessageSquareText /><h2>{room.type === 'private' ? 'What can Saathi help with?' : 'Start with what your family needs'}</h2><p>{room.type === 'private' ? 'Talk or type naturally. Your settings, images, research, and plans all happen in this conversation.' : 'Write to your family or ask Saathi in the same conversation.'}</p><div className="starter-prompts">
          {(room.type === 'private'
            ? ['Use Hindi for me', 'Set our food budget to ₹15,000', 'Create a Diwali invitation image']
            : ['Help us plan a family dinner', 'Summarize the file I share', 'Find current train options']
          ).map(prompt => <Button type="button" variant="outline" size="sm" key={prompt} onClick={() => { setMessage(prompt); requestAnimationFrame(() => textareaRef.current?.focus()) }}>{prompt}</Button>)}
        </div></div>}
        {timeline.map((entry) => entry.kind === 'image'
          ? entry.item.url && <article className="person-message assistant-message generated-image-message" key={`image-${entry.item._id}`}>
              <span className="message-avatar assistant"><Bot /></span>
              <div><h3>Saathi <small>· {imageKindLabel(entry.item.kind)}</small></h3><figure className="generated-image-card"><img src={entry.item.url} alt={entry.item.prompt} onLoad={() => feedEndRef.current?.scrollIntoView({ block: 'end' })} /><figcaption>{entry.item.prompt}</figcaption></figure></div>
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
                : <article className="voice-call-summary" key={`message-${entry.item._id}`}><span className="voice-summary-icon"><AudioLines /></span><div><h3>Voice call summary <small>· {formatRelativeTime(entry.item.createdAt)}</small></h3><p>{entry.item.originalText}</p></div></article>
            : entry.item.actorType === 'user'
            ? <article className="outgoing-message" key={`message-${entry.item._id}`}><span>{entry.item.authorUserId === profile?._id ? 'You' : entry.item.authorUsername ? `@${entry.item.authorUsername}` : 'Family member'} · {formatRelativeTime(entry.item.createdAt)}</span><p><MentionText text={entry.item.originalText} mentions={entry.item.mentions} /></p></article>
            : <article className={`person-message ${entry.item.actorType === 'assistant' ? 'assistant-message' : ''}`} key={`message-${entry.item._id}`}>
                <span className={`message-avatar ${entry.item.actorType === 'assistant' ? 'assistant' : 'email'}`}>{entry.item.actorType === 'assistant' ? 'S' : <Mail />}</span>
                <div><h3>{entry.item.actorType === 'assistant' ? 'Saathi' : 'Email guest'} <small>· {formatRelativeTime(entry.item.createdAt)}</small></h3><div className={entry.item.actorType === 'assistant' ? 'assistant-card' : 'simple-message'}>{entry.item.actorType === 'assistant' ? <AssistantText text={entry.item.originalText} /> : <p>{entry.item.originalText}</p>}{room.type === 'private' && entry.item.actorType === 'email_guest' && pendingMoney?.some(item => item.agentmailMessageId === entry.item.idempotencyKey) && <button type="button" className="share-family-mail" onClick={() => { const match = pendingMoney.find(item => item.agentmailMessageId === entry.item.idempotencyKey); if (match) void shareMoney({ inboxItemId: match._id }) }}>Share with family inbox</button>}</div></div>
              </article>)}
        {voice.summarizing && (
          <article className="person-message assistant-message saathi-stream" aria-live="polite">
            <span className="message-avatar assistant"><Bot /></span>
            <div>
              <h3>Saathi <small>· writing a call summary</small></h3>
              <div className="assistant-card streaming-card">
                <div className="typing-indicator" aria-label="Saathi is typing a voice call summary"><i /><i /><i /></div>
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
                {activeJob.responseText
                  ? <div className="streaming-markdown"><AssistantText text={activeJob.responseText} /></div>
                  : <div className="typing-indicator" aria-label={activeJob.status === 'queued' ? 'Saathi is getting ready' : activeJob.activity === 'using_computer' ? 'Saathi is using a live browser' : 'Saathi is thinking'}><i /><i /><i /></div>}
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
          <input ref={fileInputRef} className="visually-hidden" type="file" accept={ACCEPTED_ATTACHMENTS} multiple onChange={(event) => chooseFiles(event.target.files, 'library')} />
          <input ref={cameraInputRef} className="visually-hidden" type="file" accept="image/*" capture="environment" onChange={(event) => chooseFiles(event.target.files, 'camera')} />
          <input ref={receiptInputRef} className="visually-hidden" type="file" accept="image/*,application/pdf" onChange={(event) => chooseFiles(event.target.files, 'receipt')} />
          {mentionMatch && <div className="mention-menu" role="listbox" aria-label="People you can mention">
            {mentionCandidates === undefined && <span className="mention-loading">Finding people…</span>}
            {mentionCandidates !== undefined && filteredMentions.length === 0 && <span className="mention-empty">No matching person in this chat</span>}
            {filteredMentions.map((candidate, index) => <button type="button" role="option" aria-selected={index === activeMention} className={index === activeMention ? 'active' : ''} key={`${candidate.kind}-${candidate.username}`} onMouseDown={event => event.preventDefault()} onClick={() => chooseMention(candidate)}>
              <b>{candidate.kind === 'assistant' ? <Bot /> : initialsFor(candidate.label)}</b><span><strong>@{candidate.kind === 'assistant' ? 'Saathi' : candidate.username}</strong><small>{candidate.kind === 'assistant' ? 'Family assistant' : candidate.label}</small></span>
            </button>)}
          </div>}
          <textarea ref={textareaRef} value={message} onChange={(event) => { setMessage(event.target.value); updateMentionMatch(event.target.value, event.target.selectionStart) }} onSelect={(event) => updateMentionMatch(event.currentTarget.value, event.currentTarget.selectionStart)} onKeyDown={handleComposerKeyDown} placeholder={room.type === 'private' ? 'Ask Saathi anything… Type @ to tag' : 'Message your family… Type @ to tag'} aria-label="Message for your family" aria-autocomplete="list" aria-expanded={Boolean(mentionMatch)} rows={1} />
          <Button className="composer-attachment" variant="ghost" size="icon" type="button" onClick={() => fileInputRef.current?.click()} aria-label="Attach photos or documents"><Paperclip /></Button>
          <Button className="composer-send" type="submit" disabled={busy || !message.trim()}>{busy ? 'Sending…' : 'Send'} <Send /></Button>
        </form>
        {error && <p className="dark-form-error" role="alert">{error}</p>}
        {voice.error && <p className="dark-form-error" role="alert">{voice.error}</p>}
      </footer>
      {isVoiceCallOpen(voice.status) && <VoiceCallOverlay
        status={voice.status}
        turns={voice.turns}
        activities={voice.activities}
        computerTool={voice.computerTool}
        voiceLevel={voice.voiceLevel}
        onMute={voice.toggleMute}
        onEnd={voice.end}
      />}
    </section>
  )
}

function VoiceCallOverlay({ status, turns, activities, computerTool, voiceLevel, onMute, onEnd }: {
  status: VoiceStatus
  turns: VoiceTurn[]
  activities: VoiceToolActivity[]
  computerTool: {
    callId: string
    task: string
    liveViewUrl?: string
    interactiveLiveViewUrl?: string
  } | null | undefined
  voiceLevel: number
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
    <section className="voice-call-sheet">
      <header className="voice-call-header">
        <div><span>LIVE VOICE</span><h2 id="voice-call-title">Talking with Saathi</h2></div>
        <span className={`voice-call-status ${status === 'muted' ? 'is-muted' : ''}`}><i />{statusText}</span>
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
    <textarea id="image-prompt" value={prompt} onChange={event => onPrompt(event.target.value)} rows={2} placeholder="A family rangoli by the door, in Hindi labels…" />
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
      <Button type="button" size="sm" onClick={onApprove} disabled={!prompt.trim()}>Use this style</Button>
      <Button type="button" size="sm" variant="secondary" onClick={onCancel}>Cancel</Button>
    </div>
  </Card>
}

function CreateFamilyDialog({ ownedCount, onClose, onCreated, createSpace }: {
  ownedCount: number
  onClose: () => void
  onCreated: (spaceId: Id<'spaces'>) => void
  createSpace: (args: { name: string; creationKey: string }) => Promise<Id<'spaces'>>
}) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const spaceId = await createSpace({ name, creationKey: crypto.randomUUID().replaceAll('-', '') })
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
      <header><div><span>New family</span><h2 id="create-family-title">Create another family space</h2></div><button type="button" onClick={onClose} aria-label="Close"><X /></button></header>
      <p>You own {ownedCount} of 3 families. Each family keeps its chats, inbox, and Saathi separate.</p>
      <form className="dark-connect-card" onSubmit={submit}>
        <label htmlFor="new-family-name">Family name</label>
        <input id="new-family-name" value={name} onChange={event => setName(event.target.value)} minLength={2} maxLength={80} required autoFocus />
        <button type="submit" disabled={busy || name.trim().length < 2}>{busy ? 'Creating…' : 'Create family'}</button>
        {error && <small role="alert">{error}</small>}
      </form>
    </section>
  </div>
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
      {(usage?.rows ?? []).length > 0 && <ul className="usage-list">{usage!.rows.map(row => <li key={`${row.provider}-${row.model}-${row.unit}-${row.costClass}`}><strong>{row.model}</strong><small>{formatUsageQuantity(row.quantity, row.unit)} · {row.costClass}</small></li>)}</ul>}
      {(usage?.entries ?? []).length > 0 && <ul className="usage-entries">{usage!.entries.map(entry => <li key={entry._id}><strong>{entry.costClass}</strong><small>{formatUsageQuantity(entry.quantity, entry.unit)} · {entry.model} · {formatRelativeTime(entry.createdAt)}</small></li>)}</ul>}
    </div>
  </div>
}

function ByokKeys({ spaceId }: { spaceId: Id<'spaces'> }) {
  const keys = useQuery(api.spaces.providerKeyStatus, { spaceId })
  const saveKey = useMutation(api.spaces.saveProviderKey)
  const removeKey = useMutation(api.spaces.removeProviderKey)
  const [provider, setProvider] = useState<'openai' | 'openrouter' | 'codex'>('openai')
  const [secret, setSecret] = useState('')
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState('')

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

  return <div className="byok-card">
    <p>Paste an OpenAI, OpenRouter, or Codex API key. ChatGPT login is not an API. The secret is encrypted; only the last four characters are shown.</p>
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
      <input type="password" autoComplete="off" value={secret} onChange={event => setSecret(event.target.value)} placeholder={provider === 'openrouter' ? 'sk-or-…' : 'sk-…'} aria-label="API key" required />
      <button type="submit" disabled={busy || secret.trim().length < 20}>{busy ? 'Saving…' : 'Save key'}</button>
    </form>
    {feedback && <small role="status">{feedback}</small>}
    {(keys ?? []).map(key => <div className="byok-row" key={key.provider}>
      <span><strong>{key.provider === 'openrouter' ? 'OpenRouter' : key.provider === 'codex' ? 'Codex' : 'OpenAI'}</strong><small>ending {key.lastFour}</small></span>
      <button type="button" onClick={() => void removeKey({ spaceId, provider: key.provider })}>Remove</button>
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
  return <div className="invite-member-card"><form onSubmit={submit}><label htmlFor={`invite-email-${spaceId}`}><UserPlus /> Invite by email</label><input id={`invite-email-${spaceId}`} type="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="family@example.com" required /><div className="chip-row" role="radiogroup" aria-label="Invitation role">{(['member', 'owner'] as const).map(option => <button type="button" key={option} role="radio" aria-checked={role === option} className={role === option ? 'selected' : ''} onClick={() => setRole(option)}>{option === 'owner' ? 'Owner' : 'Member'}</button>)}<button type="submit" disabled={busy}>{busy ? 'Sending…' : 'Invite'}</button></div></form>{feedback && <small role="status">{feedback}</small>}{pending.map(invitation => <div className="pending-invitation" key={invitation._id}><span><strong>{invitation.targetEmail}</strong><small>{invitation.role} · expires {new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(invitation.expiresAt)}</small></span><button type="button" onClick={() => void revokeInvitation({ invitationId: invitation._id })}>Revoke</button></div>)}</div>
}

function InvitationError({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  const { signOut } = useAuthActions()
  return <main className="centered-status"><Mail size={34} /><h1>Could not accept invitation</h1><p>{message}</p><div className="status-actions"><button className="primary" onClick={() => void signOut()}>Sign in with another email</button><button className="secondary" onClick={onDismiss}>Open my workspace</button></div></main>
}

function LiveStatus({ message }: { message: string }) {
  return <main className="centered-status"><div className="status-spinner" /><p>{message}</p></main>
}

function FamilyUpdates({ family, items, onBack }: { family: FamilyRow; items: Doc<'inboxItems'>[] | undefined; onBack: () => void }) {
  const confirmAction = useMutation(api.inbox.confirmAction)
  const dismissAction = useMutation(api.inbox.dismissAction)
  const reprocess = useMutation(api.inbox.reprocess)
  return <section className="conversation-pane">
    <header className="conversation-header live-room-header">
      <button className="mobile-chat-back" onClick={onBack} aria-label="Back to chats"><ArrowLeft /></button>
      <div><div className="title-line"><h2>Family inbox</h2><span className="live-label"><LockKeyhole /> Live</span></div><p>{family.space.name} · shared household mail only</p></div>
    </header>
    <div className="conversation-feed live-feed">
      {items === undefined && <div className="dark-loading"><i /><i /><i /></div>}
      {items?.length === 0 && <div className="dark-empty-state compact"><Bell /><h2>No shared family mail yet</h2><p>Money mail stays in My Saathi until someone shares it here.</p></div>}
      {items?.map(item => <article className="person-message inbox-card" key={item._id}>
        <span className="message-avatar email"><Mail /></span>
        <div>
          <h3>{item.subject} <small>· {categoryLabel(item.category)} · {item.direction === 'outgoing' ? 'outgoing' : 'incoming'} · {formatRelativeTime(item.receivedAt)}</small></h3>
          <div className="simple-message">
            <p>{displaySender(item.sender)}</p>
            {item.extractedMerchant && <p>Merchant: {item.extractedMerchant}</p>}
            {item.extractedAmountInr && <p>INR: {item.extractedAmountInr}</p>}
            {item.extractedAmountUsd && <p>USD: {item.extractedAmountUsd}</p>}
            {!item.extractedAmountInr && !item.extractedAmountUsd && item.extractedAmount && <p>Amount: {item.extractedAmount}</p>}
            {item.extractedPeriod && <p>Period: {item.extractedPeriod}</p>}
            {item.extractedDueAt && <p>Due: {new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(item.extractedDueAt)}</p>}
            {item.status === 'processing' && <p>Analyzing the email and its attachments…</p>}
            {item.documentParseStatus === 'parsed' && <p>Attached PDF read successfully.</p>}
            {item.documentParseStatus === 'password' && <p>{item.processingNotes || 'A password-protected PDF needs a hint from the email body.'}</p>}
            {item.processingNotes && item.documentParseStatus !== 'password' && <p>{item.processingNotes}</p>}
            {(item.suggestedActions ?? []).map(action => <p key={`${item._id}-${action.kind}`}>{action.label}{action.detail ? ` — ${action.detail}` : ''}</p>)}
            {item.actionStatus === 'suggested' && <div className="inbox-actions">
              <button type="button" onClick={() => void confirmAction({ inboxItemId: item._id })}>Confirm action</button>
              <button type="button" className="secondary" onClick={() => void dismissAction({ inboxItemId: item._id })}>Not now</button>
            </div>}
            {canReadGmailPdf(item) && <div className="inbox-actions">
              <button type="button" className="secondary" onClick={() => void reprocess({ inboxItemId: item._id })}>Read Gmail PDF</button>
            </div>}
            {(item.status === 'failed' || item.documentParseStatus === 'failed') && <div className="inbox-actions">
              <button type="button" className="secondary" onClick={() => void reprocess({ inboxItemId: item._id })}>Retry PDF reading</button>
            </div>}
            {item.actionStatus === 'confirmed' && <small>Action confirmed for the family.</small>}
          </div>
        </div>
      </article>)}
    </div>
  </section>
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
        <button type="button" className="open-file-room" onClick={() => onOpenRoom(file.roomId)}>Open conversation</button>
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
  if (unit === 'audio_hour') return `${Math.max(1, Math.round(quantity * 60))} min audio`
  if (unit === 'request') return `${Math.round(quantity)} ${Math.round(quantity) === 1 ? 'request' : 'requests'}`
  return `${quantity.toFixed(quantity >= 10 ? 0 : 2)} ${unit}`
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
