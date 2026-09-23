import { Children, useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type FormEvent, type KeyboardEvent, type ReactNode } from 'react'
import { useAuthActions } from '@convex-dev/auth/react'
import { ThinkingState } from '@aicss/react/thinking-state'
import { useAction, useConvex, useMutation, useQuery } from 'convex/react'
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
  ChevronDown,
  ChevronRight,
  Copy,
  FileText,
  Folder,
  House,
  Image as ImageIcon,
  Link2,
  LockKeyhole,
  LogOut,
  Mail,
  MailOpen,
  MessageSquareText,
  Mic,
  MicOff,
  Monitor,
  PhoneOff,
  Plus,
  RefreshCcw,
  RefreshCw,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Unlink,
  Upload,
  UserRound,
  UserPlus,
  UsersRound,
  Wrench,
  X,
} from 'lucide-react'
import { api } from '../convex/_generated/api'
import type { Doc, Id } from '../convex/_generated/dataModel'
import { IMAGE_PRESET_GROUPS, IMAGE_PRESETS } from '../convex/lib/imageSafety'
import { AiAccessSetupView, UsernameSetupView } from './AuthFlowViews'
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
import { prepareAssistantMarkdown } from './assistantMarkdown'
import { isNearLatestMessage } from './chatScroll'
import { emailBodyHtml } from './emailFormatting'
import { inboxExtractionRecovery } from './inboxRecovery'
import { useLiveVoice, type VoiceStatus, type VoiceToolActivity, type VoiceTurn } from './useLiveVoice'
import './LiveTools.css'
import './Access.css'
import './WorkspaceModern.css'

type FamilyRow = { membership: Doc<'memberships'>; space: Doc<'spaces'> }
type SettingsSection = 'hub' | 'you' | 'family' | 'apps' | 'notifications' | 'images' | 'advanced' | 'admin'
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
  const convex = useConvex()
  const ensureCurrent = useMutation(api.users.ensureCurrent)
  const acceptInvitation = useMutation(api.invitations.accept)
  const currentUser = useQuery(api.users.current)
  const adminRole = useQuery(api.admin.currentRole)
  const spaces = useQuery(api.spaces.mine)
  const [selectedSpaceId, setSelectedSpaceId] = useState<Id<'spaces'> | null>(() => gmailSpaceFromUrl())
  const [pendingSpaceId, setPendingSpaceId] = useState<Id<'spaces'> | null>(null)
  const [familySwitchError, setFamilySwitchError] = useState('')
  const selectRequest = useRef(0)
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
  const selectFamily = async (spaceId: Id<'spaces'>) => {
    if (spaceId === family.space._id || spaceId === pendingSpaceId) return
    const request = ++selectRequest.current
    setFamilySwitchError('')
    setPendingSpaceId(spaceId)
    try {
      await convex.query(api.spaces.aiAccess, { spaceId })
      if (request === selectRequest.current) setSelectedSpaceId(spaceId)
    } catch {
      if (request === selectRequest.current) setFamilySwitchError('Could not open that family. Please try again.')
    } finally {
      if (request === selectRequest.current) setPendingSpaceId(null)
    }
  }
  const pendingFamily = families.find(({ space }) => space._id === pendingSpaceId)

  return <>
    <FamilyAccessEntry families={families} family={family} accountEmail={currentUser.email ?? null} onSelectFamily={(spaceId) => void selectFamily(spaceId)} onExit={onExit} />
    {pendingFamily && <div className="family-switch-progress" role="status"><span className="upload-spinner" /><strong>Opening {pendingFamily.space.name}</strong></div>}
    {familySwitchError && <div className="family-switch-progress error" role="alert"><strong>{familySwitchError}</strong><button type="button" onClick={() => setFamilySwitchError('')} aria-label="Dismiss family switch error"><X /></button></div>}
  </>
}

function FamilyAccessEntry({ families, family, accountEmail, onSelectFamily, onExit }: {
  families: FamilyRow[]
  family: FamilyRow
  accountEmail: string | null
  onSelectFamily: (spaceId: Id<'spaces'>) => void
  onExit: () => void
}) {
  const access = useQuery(api.spaces.aiAccess, { spaceId: family.space._id })
  if (access === undefined) return <LiveStatus message="Opening your family space…" />
  if (!access.ready) return <AiAccessSetup family={family} access={access} accountEmail={accountEmail} onExit={onExit} />
  return <LiveFamilyShell families={families} family={family} onSelectFamily={onSelectFamily} onExit={onExit} isSuperadmin={access.isSuperadmin} accessSource={access.source} />
}

function AiAccessSetup({ family, access, accountEmail, onExit }: {
  family: FamilyRow
  access: FunctionReturnType<typeof api.spaces.aiAccess>
  accountEmail: string | null
  onExit: () => void
}) {
  const { signOut } = useAuthActions()
  const saveKey = useMutation(api.spaces.saveProviderKey)
  const requestAccess = useMutation(api.users.requestAccess)
  const [openRouterKey, setOpenRouterKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [switchingAccount, setSwitchingAccount] = useState(false)
  const [switchAccountError, setSwitchAccountError] = useState('')

  const switchAccount = async () => {
    setSwitchingAccount(true)
    setSwitchAccountError('')
    try {
      await signOut()
    } catch {
      setSwitchAccountError('We could not switch accounts. Please try again.')
      setSwitchingAccount(false)
    }
  }

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

  const accountControl = <>
    <div className="access-account">
      <span><small>Signed in as</small><strong>{accountEmail ?? 'Current account'}</strong></span>
      <Button variant="outline" type="button" onClick={() => void switchAccount()} disabled={busy || switchingAccount}><LogOut /> {switchingAccount ? 'Signing out…' : 'Use a different email'}</Button>
    </div>
    {switchAccountError && <p className="form-error" role="alert">{switchAccountError}</p>}
  </>

  if (access.status === 'blocked') return <main className="onboarding-page"><section className="onboarding-card access-setup-card">
    <Badge className="mode-badge live"><ShieldCheck size={15} /> Account access</Badge>
    <h1>This account is not enabled</h1>
    <p>Contact the Saathi administrator if you think this is a mistake.</p>
    {accountControl}
    <Button className="secondary large" onClick={onExit} disabled={switchingAccount}><ArrowLeft /> Leave live mode</Button>
  </section></main>

  return <AiAccessSetupView
    familyName={family.space.name}
    accountEmail={accountEmail}
    owner={family.membership.role === 'owner'}
    openRouterKey={openRouterKey}
    busy={busy}
    switchingAccount={switchingAccount}
    requested={access.requestedAt !== null}
    feedback={feedback}
    switchAccountError={switchAccountError}
    onOpenRouterKeyChange={setOpenRouterKey}
    onSaveKey={saveKeys}
    onRequestAccess={() => void request()}
    onSwitchAccount={() => void switchAccount()}
    onExit={onExit}
  />
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

  return <UsernameSetupView
    username={username}
    busy={busy}
    error={error}
    onUsernameChange={setUsernameDraft}
    onSubmit={submit}
    onExit={onExit}
  />
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
  const unreadMentions = useQuery(api.mentions.unreadForSpace, { spaceId: family.space._id })
  const markRoomMentionsRead = useMutation(api.mentions.markRoomRead)
  const ensurePersonalRoom = useMutation(api.rooms.ensurePersonal)
  const inboxItems = useQuery(api.inbox.list, { spaceId: family.space._id, limit: 20 })
  const gmailConnections = useQuery(api.gmailData.mine, { spaceId: family.space._id })
  const reusableGmail = useQuery(api.gmailData.reusable, { spaceId: family.space._id })
  const latestRecategorization = useQuery(api.recategorization.latestForSpace, family.membership.role === 'owner' ? { spaceId: family.space._id } : 'skip')
  const enableGmailHere = useMutation(api.gmailData.enableForSpace)
  const disableGmailHere = useMutation(api.gmailData.disableForSpace)
  const setOtpSharing = useMutation(api.spaces.setOtpSharing)
  const startRecategorization = useMutation(api.recategorization.startForSpace)
  const resumeRecategorization = useMutation(api.recategorization.resume)
  const beginGmailConnection = useAction(api.gmail.beginConnection)
  const confirmGmailConnection = useAction(api.gmail.confirmConnection)
  const checkGmailNow = useAction(api.gmail.checkNow)
  const [membersOpen, setMembersOpen] = useState(false)
  const [selectedRoomId, setSelectedRoomId] = useState<Id<'rooms'> | null>(null)
  const [gmailBusy, setGmailBusy] = useState(false)
  const [gmailMessage, setGmailMessage] = useState('')
  const [gmailPromptDismissed, setGmailPromptDismissed] = useState(false)
  const [gmailRemovalId, setGmailRemovalId] = useState<string | null>(null)
  const [otpSettingBusy, setOtpSettingBusy] = useState(false)
  const [recategorizationBusy, setRecategorizationBusy] = useState(false)
  const [recategorizationMessage, setRecategorizationMessage] = useState('')

  useEffect(() => {
    if (gmailConnections === undefined || gmailConnections.length > 0 || gmailPromptDismissed) return
    const dismissOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setGmailPromptDismissed(true)
    }
    window.addEventListener('keydown', dismissOnEscape)
    return () => window.removeEventListener('keydown', dismissOnEscape)
  }, [gmailConnections, gmailPromptDismissed])
  const [pane, setPane] = useState<'chats' | 'updates' | 'files' | 'family'>('chats')
  const [mobileNav, setMobileNav] = useState<'home' | 'detail'>('home')
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('hub')
  const [copiedInbox, setCopiedInbox] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [createFamilyOpen, setCreateFamilyOpen] = useState(false)
  const [jevOpen, setJevOpen] = useState(false)
  const profileTriggerRef = useRef<HTMLButtonElement>(null)
  const mobileProfileTriggerRef = useRef<HTMLButtonElement>(null)
  const profileReturnFocusRef = useRef<HTMLButtonElement | null>(null)
  const sessionMenuRef = useRef<HTMLDivElement>(null)
  const mobileProfileDialogRef = useRef<HTMLElement>(null)
  const createSpace = useMutation(api.spaces.create)
  const ownedFamilyCount = families.filter(row => row.membership.role === 'owner').length
  const spaceFiles = useQuery(api.attachments.forSpace, { spaceId: family.space._id, limit: 40 })
  const saveProfile = useMutation(api.users.ensureCurrent)
  const gmailCallbackHandled = useRef(false)
  const sharedRoom = rooms?.find(({ room }) => room?.type === 'shared')?.room ?? rooms?.find(({ room }) => room)?.room ?? null
  const personalRoom = rooms?.find(({ room }) => room?.type === 'private')?.room ?? null
  const selectedRoom = rooms?.flatMap(({ room }) => room ? [room] : []).find(room => room._id === selectedRoomId) ?? sharedRoom
  const initials = initialsFor(user?.displayName ?? user?.name ?? user?.email ?? 'Family member')
  const mentionCountByRoom = useMemo(() => {
    const counts = new Map<Id<'rooms'>, number>()
    for (const mention of unreadMentions ?? []) counts.set(mention.roomId, (counts.get(mention.roomId) ?? 0) + 1)
    return counts
  }, [unreadMentions])

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
        ? 'Gmail setup is incomplete. Contact the Saathi administrator.'
        : 'Could not start Gmail connection. Please try again.')
    }
  }

  useEffect(() => {
    if (!membersOpen) return
    const closeOnEscape = (event: globalThis.KeyboardEvent) => event.key === 'Escape' && setMembersOpen(false)
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [membersOpen])

  useEffect(() => {
    if (!profileOpen) return
    const focusMenu = window.requestAnimationFrame(() => {
      const surface = window.matchMedia('(max-width: 820px)').matches ? mobileProfileDialogRef.current : sessionMenuRef.current
      surface?.querySelector<HTMLButtonElement>('button')?.focus()
    })
    const closeMenu = (restoreFocus: boolean) => {
      setProfileOpen(false)
      if (restoreFocus) window.requestAnimationFrame(() => profileReturnFocusRef.current?.focus())
    }
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      closeMenu(true)
    }
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (sessionMenuRef.current?.contains(target)
        || mobileProfileDialogRef.current?.contains(target)
        || profileTriggerRef.current?.contains(target)
        || mobileProfileTriggerRef.current?.contains(target)) return
      closeMenu(false)
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('pointerdown', onPointerDown)
    return () => {
      window.cancelAnimationFrame(focusMenu)
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [profileOpen])

  const toggleProfileMenu = (trigger: HTMLButtonElement) => {
    profileReturnFocusRef.current = trigger
    setProfileOpen(open => !open)
  }

  const openProfileSettings = (section: SettingsSection) => {
    setProfileOpen(false)
    setSettingsSection(section)
    setPane('family')
    setMobileNav('detail')
  }

  const openHome = () => {
    setPane('chats')
    setMobileNav('home')
  }
  const openRoom = (roomId: Id<'rooms'>) => {
    setSelectedRoomId(roomId)
    setPane('chats')
    setMobileNav('detail')
    if (mentionCountByRoom.get(roomId)) void markRoomMentionsRead({ roomId })
  }

  useEffect(() => {
    if (pane !== 'chats' || !selectedRoom || !mentionCountByRoom.get(selectedRoom._id)) return
    void markRoomMentionsRead({ roomId: selectedRoom._id })
  }, [markRoomMentionsRead, mentionCountByRoom, pane, selectedRoom])

  const openPane = (next: 'updates' | 'files' | 'family') => {
    if (next === 'family') setSettingsSection('hub')
    setPane(next)
    setMobileNav('detail')
  }
  const switchFamily = (spaceId: Id<'spaces'>) => {
    if (spaceId === family.space._id) return
    setSelectedRoomId(null)
    setPane('chats')
    setMobileNav('home')
    setSettingsSection('hub')
    setMembersOpen(false)
    setProfileOpen(false)
    setCreateFamilyOpen(false)
    setJevOpen(false)
    setGmailMessage('')
    onSelectFamily(spaceId)
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
          <button ref={profileTriggerRef} className="rail-profile" onClick={(event) => toggleProfileMenu(event.currentTarget)} aria-expanded={profileOpen} aria-haspopup="menu" aria-controls="desktop-account-menu" aria-label="Account menu">{initials}</button>
          {profileOpen && <div ref={sessionMenuRef} id="desktop-account-menu" className="session-menu" role="menu" aria-label="Account menu">
            <p>{user?.email ?? user?.displayName ?? 'Signed in'}</p>
            <button type="button" role="menuitem" onClick={() => openProfileSettings('you')}><UserRound /> Account &amp; profile</button>
            <button type="button" role="menuitem" onClick={() => openProfileSettings('hub')}><Settings2 /> Settings</button>
            <button type="button" role="menuitem" onClick={() => void signOut()}><LogOut /> Sign out</button>
          </div>}
        </div>
      </aside>

      <aside className="conversation-list live-conversation-list">
        <div className="mobile-home-header">
          <div><span>YOUR FAMILY</span><h1>{family.space.name}</h1><p>Chats, inbox, and shared files</p></div>
          <m.button ref={mobileProfileTriggerRef} type="button" layoutId="mobile-companion-avatar" onClick={(event) => toggleProfileMenu(event.currentTarget)} aria-expanded={profileOpen} aria-haspopup="dialog" aria-label="Open family and account hub">{initials}</m.button>
        </div>
        <span className="family-select-label" id="family-switcher-label">Current family</span>
        <div className="family-switcher" role="group" aria-labelledby="family-switcher-label">
          {families.map(({ space }) => (
            <button type="button" key={space._id} className={space._id === family.space._id ? 'selected' : ''} onClick={() => switchFamily(space._id)}>
              <span>{space.name}</span><FamilyUnreadBadge spaceId={space._id} />
            </button>
          ))}
        </div>
        <section className="mobile-family-overview" aria-label={`${family.space.name} overview`}>
          <button type="button" onClick={() => openPane('updates')}><span><Bell /><strong>Inbox</strong></span><small>{inboxItems === undefined ? 'Loading…' : `${inboxItems.length} recent ${inboxItems.length === 1 ? 'email' : 'emails'}`}</small><ArrowRight /></button>
          <button type="button" onClick={() => openPane('files')}><span><Folder /><strong>Files</strong></span><small>{spaceFiles === undefined ? 'Loading…' : `${spaceFiles.length} shared ${spaceFiles.length === 1 ? 'item' : 'items'}`}</small><ArrowRight /></button>
        </section>
        <span className="list-heading">Private</span>
        {personalRoom
          ? <button className={`conversation-link personal-chat-link ${personalRoom._id === selectedRoom?._id ? 'selected' : ''}`} onClick={() => openRoom(personalRoom._id)}><Bot /><span>My Saathi<small>Only you</small></span><MentionNotificationBadge count={mentionCountByRoom.get(personalRoom._id) ?? 0} /></button>
          : <p className="dark-empty-copy">Preparing your private chat…</p>}
        <span className="list-heading section-gap">Family chats</span>
        {(rooms ?? []).flatMap(({ room }) => room && room.type !== 'private' ? [room] : []).map((room) => (
          <button className={`conversation-link ${room._id === selectedRoom?._id ? 'selected' : ''}`} key={room._id} onClick={() => openRoom(room._id)}><i /><span>{room.title}</span><MentionNotificationBadge count={mentionCountByRoom.get(room._id) ?? 0} /></button>
        ))}
        {rooms !== undefined && !sharedRoom && <p className="dark-empty-copy">Your shared family conversation will appear here.</p>}
        <span className="list-heading section-gap family-activity-heading">Family activity</span>
        <button className={`conversation-link family-activity-link ${pane === 'updates' ? 'selected' : ''}`} onClick={() => openPane('updates')}><i /><span>Family inbox</span><FamilyUnreadBadge spaceId={family.space._id} /></button>
      </aside>

      <AnimatePresence mode="wait" initial={false}>
        <m.div className="workspace-view-transition" key={workspaceViewKey} {...viewMotion} transition={{ duration: reduceMotion ? 0 : .22, ease: [.22, 1, .36, 1] }}>
          {pane === 'updates' ? (
            <FamilyUpdates family={family} items={inboxItems} onBack={openHome} />
          ) : pane === 'files' ? (
            <FamilyFiles family={family} files={spaceFiles} onBack={openHome} onOpenRoom={openRoom} />
          ) : selectedRoom ? (
            <LiveRoom key={selectedRoom._id} room={selectedRoom} family={family} families={families} accessSource={accessSource} onBack={openHome} onNavigate={openPane} onInvite={selectedRoom.type !== 'private' && family.membership.role === 'owner' ? () => setMembersOpen(true) : undefined} />
          ) : (
            <section className="conversation-pane"><header className="conversation-header"><div><h2>{family.space.name}</h2><p>Live · private family data</p></div></header><div className="dark-empty-state"><MessageSquareText /><h2>Your family conversation is getting ready</h2><p>Reload in a moment. New family spaces automatically receive a shared room.</p></div></section>
          )}
        </m.div>
      </AnimatePresence>

      <aside className="conversation-context live-context">
        <header className="conversation-header live-room-header mobile-family-header">
          <button className="mobile-chat-back" onClick={() => settingsSection === 'hub' ? openHome() : setSettingsSection('hub')} aria-label={settingsSection === 'hub' ? 'Back to chats' : 'Back to settings'}><ArrowLeft /></button>
          <div><div className="title-line"><h2>{settingsSection === 'hub' ? 'Settings' : settingsSectionTitle(settingsSection)}</h2><span className="live-label"><LockKeyhole /> Live</span></div><p>{family.space.name}</p></div>
        </header>
        <div className="context-title"><div><h2>{settingsSection === 'hub' ? 'Settings' : settingsSectionTitle(settingsSection)}</h2><p>{settingsSection === 'hub' ? 'Manage your account, family, and Saathi.' : settingsSectionDescription(settingsSection)}</p></div>{settingsSection === 'hub' ? <button onClick={onExit}>Switch mode</button> : <button onClick={() => setSettingsSection('hub')}><ArrowLeft /> All settings</button>}</div>
        <div className={`settings-scroll settings-page settings-page-${settingsSection}`}>
          {settingsSection === 'hub' && <div className="settings-hub">
            <div className="settings-hub-group">
              <SettingsHubRow icon={<UserRound />} title="You" description="Reading language" status={`${user?.displayName ?? user?.email ?? 'Your account'} · ${languageLabel(user?.preferredLanguage ?? 'en')}`} onClick={() => setSettingsSection('you')} />
              <SettingsHubRow icon={<UsersRound />} title="Family" description="Switch families and manage invitations" status={`${family.space.name} · ${family.membership.role}`} onClick={() => setSettingsSection('family')} />
              <SettingsHubRow icon={<Link2 />} title="Connected apps" description="Gmail and private mail imports" status={`${gmailConnections?.length ?? 0} Gmail ${gmailConnections?.length === 1 ? 'account' : 'accounts'}`} onClick={() => setSettingsSection('apps')} />
              <SettingsHubRow icon={<Bell />} title="Notifications" description="Mentions and unread family mail" status={`${unreadMentions?.length ?? 0} unread ${unreadMentions?.length === 1 ? 'mention' : 'mentions'}`} onClick={() => setSettingsSection('notifications')} />
              <SettingsHubRow icon={<ImageIcon />} title="Image preferences" description="Default style for generated images" status={IMAGE_PRESETS.find(preset => preset.id === (user?.preferredImageStyle ?? 'warm_family'))?.label ?? 'Warm household'} onClick={() => setSettingsSection('images')} />
            </div>
            <div className="settings-hub-more"><span>More</span><div className="settings-hub-group">
                <SettingsHubRow icon={<SlidersHorizontal />} title="Advanced" description="Family inbox, models, and usage" status={accessSource === 'byok' ? 'Owner controls' : 'Family controls'} onClick={() => setSettingsSection('advanced')} />
                {isSuperadmin && <SettingsHubRow icon={<Wrench />} title="Admin" description="Jev debug and deployment access" status="Superadmin only" onClick={() => setSettingsSection('admin')} />}
              </div>
            </div>
          </div>}

          {settingsSection === 'you' && <section className="personal-settings settings-detail-section"><span>Your preferences</span><p>These choices affect only you.</p>
            <label>Reading language</label>
            <div className="language-setting" role="radiogroup" aria-label="My reading language">{(['en', 'hi', 'mr'] as const).map(code => <button type="button" key={code} role="radio" aria-checked={(user?.preferredLanguage ?? 'en') === code} className={(user?.preferredLanguage ?? 'en') === code ? 'selected' : ''} onClick={() => void saveProfile({ preferredLanguage: code })}>{languageLabel(code)}</button>)}</div>
            <div className="settings-privacy-note"><ShieldCheck /><span><strong>Private preference</strong><small>Your reading language does not change anyone else’s view.</small></span></div>
          </section>}

          {settingsSection === 'family' && <>
            <section className="settings-detail-section"><span>Your families</span><div className="settings-family-list">{families.map(row => <button type="button" className={row.space._id === family.space._id ? 'selected' : ''} key={row.space._id} onClick={() => row.space._id !== family.space._id && switchFamily(row.space._id)} aria-current={row.space._id === family.space._id ? 'true' : undefined}><span><strong>{row.space.name}</strong><small>{row.membership.role}</small></span>{row.space._id === family.space._id ? <Check /> : <ChevronRight />}</button>)}</div></section>
            <section className="settings-detail-section"><span>Current family</span><h3>{family.space.name}</h3><p>{family.membership.role === 'owner' ? 'You can own up to 3 family spaces.' : 'Only owners can change family-wide settings.'}</p>{family.membership.role === 'owner' && (ownedFamilyCount < 3 ? <button type="button" className="connect-gmail" onClick={() => setCreateFamilyOpen(true)}><Plus /> Create another family</button> : <small className="gmail-status">You already own 3 families.</small>)}</section>
            <section className="settings-detail-section"><span>Privacy</span><p className="confirmed"><ShieldCheck /> Live, authorized family data</p></section>
            {family.membership.role === 'owner' && <section className="settings-detail-section"><span>Members and invitations</span><InviteMember spaceId={family.space._id} /></section>}
          </>}

          {settingsSection === 'apps' && <section className="gmail-connections settings-detail-section"><span>Your Gmail</span><p>Useful mail is added privately to My Saathi in families you allow. Other members cannot see your connected accounts.</p>
            {(gmailConnections ?? []).map(connection => {
              const accountLabel = connection.email ?? connection.alias
              const confirmingRemoval = gmailRemovalId === connection._id
              const removeFromFamily = () => {
                setGmailBusy(true)
                void disableGmailHere({ spaceId: family.space._id, connectedAccountId: connection.connectedAccountId })
                  .then(() => setGmailMessage('Removed from this family. Mail stays in other families you enabled.'))
                  .catch(() => setGmailMessage('Could not update Gmail for this family.'))
                  .finally(() => { setGmailBusy(false); setGmailRemovalId(null) })
              }
              return <div className="gmail-account" key={connection._id}>
                <Mail className="gmail-account-icon" />
                <div className="gmail-account-copy"><strong>{accountLabel}</strong><small>{connection.lastSyncedAt ? `Checked ${formatRelativeTime(connection.lastSyncedAt)}` : 'Reviewing the last 30 days…'}</small></div>
                {confirmingRemoval
                  ? <div className="gmail-remove-confirm" role="group" aria-label={`Confirm removing ${accountLabel} from ${family.space.name}`}>
                      <p>Stop adding mail from this Gmail to {family.space.name}? It stays connected to your other families.</p>
                      <div className="gmail-remove-confirm-actions">
                        <Button type="button" variant="destructive" size="lg" className="min-h-11 h-auto max-w-full whitespace-normal" onClick={removeFromFamily} disabled={gmailBusy}><Unlink /> Remove from {family.space.name}</Button>
                        <Button type="button" variant="secondary" size="lg" className="min-h-11 h-auto" onClick={() => setGmailRemovalId(null)} disabled={gmailBusy}>Cancel</Button>
                      </div>
                    </div>
                  : <Button type="button" variant="destructiveQuiet" size="lg" className="gmail-remove-action min-h-11 h-auto" onClick={() => setGmailRemovalId(connection._id)} disabled={gmailBusy}><Unlink /> Remove</Button>}
              </div>
            })}
            {(reusableGmail ?? []).map(account => <Button type="button" size="lg" className="gmail-reuse-action min-h-11 h-auto max-w-full whitespace-normal" key={account.connectedAccountId} disabled={gmailBusy} onClick={() => { setGmailBusy(true); void enableGmailHere({ spaceId: family.space._id, connectedAccountId: account.connectedAccountId }).then(() => setGmailMessage(`Added ${account.email ?? account.alias} to this family.`)).catch(() => setGmailMessage('Could not add that Gmail to this family.')).finally(() => setGmailBusy(false)) }}><Plus /> Add {account.email ?? account.alias} to this family</Button>)}
            <div className="settings-inline-actions"><Button type="button" size="lg" className="gmail-connect-action min-h-11 h-auto whitespace-normal" onClick={() => void connectGmail()} disabled={gmailBusy}><Plus />{gmailConnections?.length ? 'Connect another Gmail' : 'Connect Gmail'}</Button>{(gmailConnections?.length ?? 0) > 0 && <Button type="button" variant="secondary" size="lg" className="gmail-check-action min-h-11 h-auto whitespace-normal" onClick={() => { setGmailBusy(true); setGmailMessage('Checking connected Gmail…'); void checkGmailNow({ spaceId: family.space._id }).then(count => setGmailMessage(count ? 'Checking inboxes now. New bills and receipts appear in My Saathi first.' : 'No Gmail accounts are connected yet.')).catch(() => setGmailMessage('Could not check Gmail right now.')).finally(() => setGmailBusy(false)) }} disabled={gmailBusy}><RefreshCw /> Check for new mail</Button>}</div>
            {gmailMessage && <small className="gmail-status" role="status">{gmailMessage}</small>}
          </section>}

          {settingsSection === 'notifications' && <section className="settings-detail-section notification-settings-info"><Bell /><div><span>Mentions and inbox updates</span><p>When a family member tags your username, Saathi adds an unread alert to that conversation. Family inbox items are tracked separately for each person.</p><strong><Check /> In-app alerts on for {family.space.name}</strong></div></section>}

          {settingsSection === 'images' && <section className="personal-settings settings-detail-section"><span>Image preferences</span><p>Choose the starting style for images you ask Saathi to create.</p><label htmlFor="preferred-image-style">Default image style</label><Select value={user?.preferredImageStyle ?? 'warm_family'} onValueChange={value => void saveProfile({ preferredImageStyle: value as (typeof IMAGE_PRESETS)[number]['id'] })}><SelectTrigger id="preferred-image-style" aria-label="Default image style"><SelectValue /></SelectTrigger><SelectContent>{IMAGE_PRESET_GROUPS.map(group => <SelectGroup key={group}><SelectLabel>{imagePresetGroupLabel(group)}</SelectLabel>{IMAGE_PRESETS.filter(preset => preset.group === group).map(preset => <SelectItem value={preset.id} key={preset.id}>{preset.label}</SelectItem>)}</SelectGroup>)}</SelectContent></Select></section>}

          {settingsSection === 'advanced' && <>
            <section className="settings-detail-section"><span>Family inbox</span>{family.space.agentmailInboxId ? <div className="agentmail-id"><p className="confirmed"><Check /> Family inbox connected</p><code>{family.space.agentmailEmail ?? family.space.agentmailInboxId}</code><button type="button" onClick={() => { void navigator.clipboard.writeText(family.space.agentmailEmail ?? family.space.agentmailInboxId ?? '').then(() => { setCopiedInbox(true); window.setTimeout(() => setCopiedInbox(false), 2_000) }) }}><Copy />{copiedInbox ? 'Copied' : 'Copy address'}</button></div> : family.membership.role === 'owner' ? <ConnectInbox spaceId={family.space._id} /> : <p>Ask a family owner to create the family inbox.</p>}</section>
            {family.membership.role === 'owner' && <section className="settings-detail-section otp-sharing-setting"><div><span>Share one-time codes</span><p>Allow family members to explicitly share Gmail OTPs. The private code, shared message, and inbox record are permanently deleted after five minutes.</p></div><button
              type="button"
              role="switch"
              aria-checked={family.space.otpSharingEnabled !== false}
              aria-label="Allow sharing one-time codes"
              disabled={otpSettingBusy}
              onClick={() => {
                setOtpSettingBusy(true)
                void setOtpSharing({ spaceId: family.space._id, enabled: family.space.otpSharingEnabled === false })
                  .finally(() => setOtpSettingBusy(false))
              }}
            ><i />{family.space.otpSharingEnabled !== false ? 'On' : 'Off'}</button></section>}
            {family.membership.role === 'owner' && <section className="settings-detail-section recategorization-setting"><div><span>Email categorization</span><p>Re-run the current category, subtype, amount, merchant, and period extraction in the durable background queue.</p></div>
              {latestRecategorization
                ? <div className="recategorization-status" aria-live="polite"><strong>{recategorizationStatusLabel(latestRecategorization.status)}</strong><small>{latestRecategorization.recategorized} updated · {latestRecategorization.skipped} skipped · {latestRecategorization.total ?? latestRecategorization.discovered} found</small>{latestRecategorization.error && <small>{latestRecategorization.error}</small>}</div>
                : <p className="recategorization-status">No background recategorization has run for this family.</p>}
              <Button type="button" variant="secondary" size="lg" disabled={recategorizationBusy || latestRecategorization?.status === 'queued' || latestRecategorization?.status === 'running'} onClick={() => {
                setRecategorizationBusy(true)
                setRecategorizationMessage('')
                const request = latestRecategorization?.status === 'failed'
                  ? resumeRecategorization({ jobId: latestRecategorization.jobId })
                  : startRecategorization({ spaceId: family.space._id })
                void request.then(() => setRecategorizationMessage('Background recategorization queued. You can leave this page.')).catch(() => setRecategorizationMessage('Could not start recategorization. Try again.')).finally(() => setRecategorizationBusy(false))
              }}><RefreshCw />{latestRecategorization?.status === 'failed' ? 'Resume recategorization' : latestRecategorization?.status === 'queued' || latestRecategorization?.status === 'running' ? 'Recategorization running' : 'Re-run email categorization'}</Button>
              {recategorizationMessage && <small className="gmail-status" role="status">{recategorizationMessage}</small>}
            </section>}
            {family.membership.role === 'owner' && accessSource === 'byok' && <section className="settings-detail-section"><span>Models and usage</span><ModelTierControls spaceId={family.space._id} /></section>}
            {family.membership.role === 'owner' && accessSource === 'byok' && <section className="settings-detail-section"><span>Your provider keys</span><ByokKeys spaceId={family.space._id} /></section>}
          </>}

          {settingsSection === 'admin' && isSuperadmin && <>
            <section className="settings-detail-section"><span>Jev debug</span><p>Inspect recent routing decisions and tool activity without adding them to the conversation.</p><button type="button" className="connect-gmail" onClick={() => setJevOpen(true)}><Sparkles /> Open Jev debug</button></section>
            <section className="settings-detail-section"><span>Deployment access</span><p>Approve or block accounts requesting deployment-funded AI access.</p><button type="button" className="connect-gmail" onClick={openAdminDashboard}><ShieldCheck /> Manage deployment access</button></section>
          </>}
        </div>
      </aside>
      <nav className="mobile-workspace-nav" aria-label="Workspace">
        <button type="button" className={pane === 'chats' ? 'active' : ''} onClick={openHome} aria-current={pane === 'chats' ? 'page' : undefined}>{pane === 'chats' && <m.i layoutId="mobile-nav-active" />}<span className="mobile-nav-icon"><House /></span><span>Home</span></button>
        <button type="button" className={pane === 'updates' ? 'active' : ''} onClick={() => openPane('updates')} aria-current={pane === 'updates' ? 'page' : undefined}>{pane === 'updates' && <m.i layoutId="mobile-nav-active" />}<span className="mobile-nav-icon"><Bell /></span><span>Inbox</span></button>
        <button type="button" className={pane === 'files' ? 'active' : ''} onClick={() => openPane('files')} aria-current={pane === 'files' ? 'page' : undefined}>{pane === 'files' && <m.i layoutId="mobile-nav-active" />}<span className="mobile-nav-icon"><Folder /></span><span>Files</span></button>
        <button type="button" className={pane === 'family' ? 'active' : ''} onClick={() => openPane('family')} aria-current={pane === 'family' ? 'page' : undefined}>{pane === 'family' && <m.i layoutId="mobile-nav-active" />}<span className="mobile-nav-icon"><Settings2 /></span><span>Settings</span></button>
      </nav>
      <AnimatePresence>
        {profileOpen && <m.div className="mobile-companion-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setProfileOpen(false)}>
          <m.section ref={mobileProfileDialogRef} className="mobile-companion-hub" role="dialog" aria-modal="true" aria-labelledby="companion-hub-title" initial={reduceMotion ? { opacity: 1 } : { opacity: 0, y: 24, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 18, scale: .98 }} transition={{ type: 'spring', stiffness: 410, damping: 34 }} onClick={event => event.stopPropagation()}>
            <header><m.span layoutId="mobile-companion-avatar">{initials}</m.span><div><small>Current family</small><h2 id="companion-hub-title">{family.space.name}</h2><p>{user?.displayName ?? (user?.email ? <>{user.email.split('@')[0]}@<wbr />{user.email.split('@').slice(1).join('@')}</> : 'Family member')}</p></div><button type="button" onClick={() => { setProfileOpen(false); window.requestAnimationFrame(() => mobileProfileTriggerRef.current?.focus()) }} aria-label="Close account menu"><X /></button></header>
            <section className="companion-hub-overview" aria-label="Family activity"><button type="button" onClick={() => { setProfileOpen(false); openPane('updates') }}><Bell /><span><strong>Family inbox</strong><small>{inboxItems?.length ?? 0} recent items</small></span><ArrowRight /></button><button type="button" onClick={() => { setProfileOpen(false); openHome() }}><MessageSquareText /><span><strong>Conversations</strong><small>{rooms?.filter(row => row.room).length ?? 0} available chats</small></span><ArrowRight /></button></section>
            <div className="companion-hub-actions"><button type="button" onClick={() => { setProfileOpen(false); openPane('family') }}><Settings2 /><span><strong>Settings</strong><small>Family and account</small></span></button><button type="button" onClick={() => { setProfileOpen(false); setMembersOpen(true) }}><UserPlus /><span><strong>Invite someone</strong><small>Add a family member</small></span></button></div>
            <div className="companion-hub-status"><i /><span><strong>Saathi is ready</strong><small>Translation and family memory are available</small></span></div>
            <footer className="companion-hub-footer"><div><ShieldCheck /><span><strong>Private by design</strong><small>Each family stays separate</small></span></div><button type="button" onClick={() => void signOut()}><LogOut /><span>Sign out</span></button></footer>
          </m.section>
        </m.div>}
      </AnimatePresence>
      {membersOpen && <div className="family-dialog-backdrop" role="presentation" onMouseDown={() => setMembersOpen(false)}><section className="family-dialog" role="dialog" aria-modal="true" aria-labelledby="invite-dialog-title" onMouseDown={event => event.stopPropagation()}><header><div><span>Family access</span><h2 id="invite-dialog-title">Invite someone to {family.space.name}</h2></div><button type="button" onClick={() => setMembersOpen(false)} aria-label="Close invitations" autoFocus><X /></button></header><p>They must sign in using the same email address. Invitations expire after seven days.</p><InviteMember spaceId={family.space._id} /></section></div>}
      {gmailConnections !== undefined && gmailConnections.length === 0 && !gmailPromptDismissed && <div className="family-dialog-backdrop" role="presentation" onMouseDown={() => setGmailPromptDismissed(true)}><section className="family-dialog gmail-setup-dialog" role="dialog" aria-modal="true" aria-labelledby="gmail-setup-title" onMouseDown={event => event.stopPropagation()}><header><div><span>Connected apps</span><h2 id="gmail-setup-title">Connect Gmail to find useful mail</h2></div><button type="button" onClick={() => setGmailPromptDismissed(true)} aria-label="Close Gmail setup" autoFocus><X /></button></header><p>Bills, receipts, school notices, and travel updates arrive privately in My Saathi. Nothing enters the family inbox until you share it.</p><div className="status-actions"><Button type="button" size="lg" onClick={() => void connectGmail()} disabled={gmailBusy}><Mail />{gmailBusy ? 'Opening Google sign-in…' : 'Connect Gmail'}</Button><Button type="button" size="lg" variant="secondary" onClick={() => setGmailPromptDismissed(true)} disabled={gmailBusy}>Not now</Button></div></section></div>}
      {createFamilyOpen && <CreateFamilyDialog ownedCount={ownedFamilyCount} onClose={() => setCreateFamilyOpen(false)} onCreated={(spaceId) => { setCreateFamilyOpen(false); switchFamily(spaceId) }} createSpace={createSpace} />}
      {jevOpen && isSuperadmin && <JevLabDrawer spaceId={family.space._id} onClose={() => setJevOpen(false)} />}
    </main>
    </LazyMotion>
  )
}

function SettingsHubRow({ icon, title, description, status, onClick }: { icon: ReactNode; title: string; description: string; status: string; onClick: () => void }) {
  return <button type="button" className="settings-hub-row" onClick={onClick}><span className="settings-hub-icon">{icon}</span><span className="settings-hub-copy"><strong>{title}</strong><small>{description}</small><em>{status}</em></span><ChevronRight /></button>
}

function settingsSectionTitle(section: SettingsSection) {
  if (section === 'you') return 'You'
  if (section === 'family') return 'Family'
  if (section === 'apps') return 'Connected apps'
  if (section === 'notifications') return 'Notifications'
  if (section === 'images') return 'Image preferences'
  if (section === 'advanced') return 'Advanced'
  if (section === 'admin') return 'Admin'
  return 'Settings'
}

function settingsSectionDescription(section: SettingsSection) {
  if (section === 'you') return 'Your language and personal preferences.'
  if (section === 'family') return 'Family spaces, members, and invitations.'
  if (section === 'apps') return 'Private accounts connected to Saathi.'
  if (section === 'notifications') return 'How unread family updates work.'
  if (section === 'images') return 'Choose how generated images begin.'
  if (section === 'advanced') return 'Owner controls for inboxes, models, and usage.'
  if (section === 'admin') return 'Restricted diagnostics and deployment access.'
  return 'Manage your account, family, and Saathi.'
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
  security: 'Security code or alert',
  school: 'Keep as a school notice',
  travel: 'Keep as a travel update',
  appointments: 'Keep as an appointment',
  subscriptions: 'Keep as a subscription',
  home: 'Keep as a household notice',
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

function LiveRoom({ room, family, families, accessSource, onBack, onNavigate, onInvite }: {
  room: Doc<'rooms'>
  family: FamilyRow
  families: FamilyRow[]
  accessSource: 'byok' | 'platform' | 'none'
  onBack: () => void
  onNavigate: (pane: 'updates' | 'files' | 'family') => void
  onInvite?: () => void
}) {
  const messages = useQuery(api.rooms.messages, { roomId: room._id, limit: 40 })
  const mentionCandidates = useQuery(api.mentions.candidates, { roomId: room._id })
  const mentionHandles = useMemo(() => new Set((mentionCandidates ?? []).map(candidate => candidate.username.toLowerCase())), [mentionCandidates])
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
  const feedRef = useRef<HTMLDivElement>(null)
  const initialFeedPositionedRef = useRef(false)
  const followLatestRef = useRef(true)
  const activeJob = saathi?.jobs.find((job) => job.status === 'running') ?? saathi?.jobs.find((job) => job.status === 'queued')
  const failedJob = saathi?.jobs[0]?.status === 'failed' ? saathi.jobs[0] : null
  const attachmentMessageIds = useMemo(() => new Set((attachments ?? []).map((item) => item.messageId)), [attachments])
  const voice = useLiveVoice(room._id)
  const voiceUnavailableForByok = accessSource === 'byok'
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
  const feedReady = messages !== undefined && generatedImages !== undefined && attachments !== undefined

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
      if (voiceUnavailableForByok) {
        setError('Voice calls are temporarily unavailable with family-key access. Chat still uses your family key.')
        return
      }
      void voice.start()
      return
    }
    if (action.kind === 'send_prompt' && action.prompt) {
      setMessage(action.prompt)
      requestAnimationFrame(() => textareaRef.current?.focus())
    }
  }

  useLayoutEffect(() => {
    const feed = feedRef.current
    if (!feed || !feedReady) return
    if (!initialFeedPositionedRef.current) {
      feed.scrollTop = feed.scrollHeight
      initialFeedPositionedRef.current = true
      followLatestRef.current = true
      return
    }
    if (followLatestRef.current) feed.scrollTop = feed.scrollHeight
  }, [feedReady, messages?.length, generatedImages?.length, attachments?.length, activeJob?.responseText, activeJob?.status, activeJob?.computerInteractiveLiveViewUrl, activeJob?.computerLiveViewUrl])


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
        setUploads((current) => [...current, { id, name: file.name, status: 'error', message: mediaType.startsWith('image/') ? 'Choose a non-empty image up to 20 MB.' : 'Choose a non-empty document up to 50 MB.' }])
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
        <div className="room-header-actions">{onInvite && <button type="button" className="header-invite" onClick={onInvite}><UserPlus /><span>Invite member</span></button>}<FamilyMemberCluster spaceId={family.space._id} /></div>
      </header>
      <div className="conversation-feed live-feed" ref={feedRef} onScroll={(event) => { followLatestRef.current = isNearLatestMessage(event.currentTarget) }}>
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
              <div><h3>Saathi <small>· {imageKindLabel(entry.item.kind)}</small></h3><figure className="generated-image-card"><button type="button" className="generated-image-open" onClick={() => setExpandedImage({ url: entry.item.url!, prompt: entry.item.prompt })} aria-label={`View generated image full size: ${entry.item.prompt}`}><img src={entry.item.url} alt={entry.item.prompt} onLoad={() => { const feed = feedRef.current; if (feed && followLatestRef.current) feed.scrollTop = feed.scrollHeight }} /><span>View full size</span></button><figcaption>{entry.item.prompt}</figcaption></figure></div>
            </article>
          : entry.kind === 'attachment'
            ? <article className="outgoing-message attachment-message" key={`attachment-${entry.item._id}`}>
                <span>You · {formatRelativeTime(entry.item.createdAt)}</span>
                {entry.item.mediaType.startsWith('image/') && entry.item.url
                  ? <a className="shared-image" href={entry.item.url} target="_blank" rel="noreferrer"><img src={entry.item.url} alt={entry.item.fileName} /><small>{entry.item.fileName} · {formatFileSize(entry.item.sizeBytes)}</small></a>
                  : <a className="shared-document" href={entry.item.url ?? undefined} target="_blank" rel="noreferrer" aria-disabled={!entry.item.url}><FileText /><span><strong>{entry.item.fileName}</strong><small>{formatFileSize(entry.item.sizeBytes)}</small></span></a>}
                {entry.item.transcriptStatus === 'pending' && <small className="photo-read-status">Reading the file…</small>}
                {entry.item.transcript && <p className="photo-read-text">{entry.item.extractedMerchant ? `${entry.item.extractedMerchant}${entry.item.extractedAmount ? ` · ${entry.item.extractedAmount}` : ''}` : entry.item.transcript}</p>}
              </article>
          : entry.item.actorType === 'voice_transcript'
            ? entry.item.voiceSpeaker === 'user'
              ? <article className="outgoing-message saved-voice-transcript" key={`message-${entry.item._id}`}><span>You · voice transcript · {formatRelativeTime(entry.item.createdAt)}</span><p>{entry.item.originalText}</p></article>
              : entry.item.voiceSpeaker === 'assistant'
                ? <article className="person-message assistant-message saved-voice-transcript" key={`message-${entry.item._id}`}><span className="message-avatar assistant"><Bot /></span><div><h3>Saathi <small>· voice transcript · {formatRelativeTime(entry.item.createdAt)}</small></h3><div className="assistant-card"><p>{entry.item.originalText}</p></div></div></article>
                : <article className="voice-call-summary" key={`message-${entry.item._id}`}><span className="voice-summary-icon"><AudioLines /></span><div><header><h3>Voice call</h3><small>{formatRelativeTime(entry.item.createdAt)}</small></header><p>{entry.item.originalText}</p>{entry.item.voiceSeconds !== undefined && <small className="voice-call-meta"><AudioLines /> {formatVoiceDuration(entry.item.voiceSeconds)}</small>}<ConversationUiActions actions={entry.item.uiActions} onAction={useUiAction} /></div></article>
            : entry.item.actorType === 'user'
            ? <OutgoingMessageView key={`message-${entry.item._id}`} meta={`${entry.item.authorUserId === profile?._id ? 'You' : entry.item.authorUsername ? `@${entry.item.authorUsername}` : 'Family member'} · ${formatRelativeTime(entry.item.createdAt)}`}><MentionText text={entry.item.originalText} mentions={entry.item.mentions} /></OutgoingMessageView>
            : entry.item.actorType === 'assistant'
              ? <AssistantMessageView key={`message-${entry.item._id}`} meta={formatRelativeTime(entry.item.createdAt)}><AssistantText text={entry.item.originalText} mentionHandles={mentionHandles} /><ConversationUiActions actions={entry.item.uiActions} onAction={useUiAction} /></AssistantMessageView>
              : <EmailGuestMessageView key={`message-${entry.item._id}`} title="Email guest" meta={formatRelativeTime(entry.item.createdAt)}><p>{entry.item.originalText}</p>{room.type === 'private' && pendingMoney?.some(item => item.agentmailMessageId === entry.item.idempotencyKey) && <ShareFamilyMailButtons item={pendingMoney.find(item => item.agentmailMessageId === entry.item.idempotencyKey)!} family={family} families={families} onShareHere={(inboxItemId) => void shareMoney({ inboxItemId })} onShareThere={(inboxItemId, spaceId) => void shareMoneyWithSpace({ inboxItemId, spaceId })} />}</EmailGuestMessageView>)}
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
                <AgentStreamingResponse status={activeJob.status} activity={activeJob.activity} responseText={activeJob.responseText} mentionHandles={mentionHandles} />
              </div>
            </div>
          </article>
        )}
        {failedJob && failedJob.trigger !== 'ambient' && !activeJob && (
          <article className="person-message assistant-message saathi-failed" role="status">
            <span className="message-avatar assistant"><Bot /></span>
            <div><h3>Saathi <small>· couldn’t respond</small></h3><div className="assistant-card"><p>Could not finish the reply. Try again.</p><button type="button" className="icon-action" onClick={() => void retryFailedResponse()} disabled={retrying} aria-label={retrying ? 'Retrying response' : 'Try response again'} title={retrying ? 'Retrying…' : 'Try again'}><RefreshCcw /></button></div></div>
          </article>
        )}
        <div />
      </div>
      <footer className="conversation-composer">
        {uploads.length > 0 && <div className="upload-queue" aria-live="polite">{uploads.map((upload) => <div className={upload.status} key={upload.id}>{upload.status === 'uploading' ? <span className="upload-spinner" /> : <FileText />}<span><strong>{upload.name}</strong><small>{upload.status === 'uploading' ? 'Uploading…' : upload.message}</small></span>{upload.status === 'error' && <button type="button" onClick={() => setUploads((current) => current.filter((item) => item.id !== upload.id))} aria-label={`Dismiss ${upload.name}`}><X /></button>}</div>)}</div>}
        <div className="composer-guidance">
          <div className="composer-guidance-actions">
            {voiceUnavailableForByok ? (
              <span className="voice-unavailable" tabIndex={0} role="group" aria-label="Voice unavailable" aria-describedby="byok-voice-explanation">
                <Button type="button" variant="ghost" size="sm" className="voice-start" disabled><Mic /> Voice unavailable</Button>
                <span className="voice-unavailable-tip" id="byok-voice-explanation" role="tooltip">
                  <strong>Voice is coming back soon</strong>
                  <span>For now, voice calls are available with managed Saathi access. Chat still uses your family key.</span>
                </span>
              </span>
            ) : (
              <Button type="button" variant="ghost" size="sm" className="voice-start" onClick={() => void voice.start()} disabled={!['idle', 'ended', 'error'].includes(voice.status)}><Mic /> {['idle', 'ended', 'error'].includes(voice.status) ? 'Talk to Saathi' : 'Voice call open'}</Button>
            )}
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
          <Textarea ref={textareaRef} value={message} onChange={(event) => { setMessage(event.target.value); updateMentionMatch(event.target.value, event.target.selectionStart) }} onSelect={(event) => updateMentionMatch(event.currentTarget.value, event.currentTarget.selectionStart)} onKeyDown={handleComposerKeyDown} placeholder={room.type === 'private' ? 'Message Saathi…' : 'Message your family…'} aria-label={room.type === 'private' ? 'Message for Saathi' : 'Message for your family'} aria-autocomplete="list" aria-expanded={Boolean(mentionMatch)} rows={1} />
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

export function AssistantMessageView({ meta, children, className = '' }: { meta: string; children: ReactNode; className?: string }) {
  return <article className={`person-message assistant-message ${className}`.trim()}>
    <span className="message-avatar assistant"><Sparkles /></span>
    <div><h3>Saathi <small>· {meta}</small></h3><div className="assistant-card">{children}</div></div>
  </article>
}

export function EmailGuestMessageView({ title, meta, children }: { title: string; meta: string; children: ReactNode }) {
  return <article className="person-message email-guest-message">
    <span className="message-avatar email"><Mail /></span>
    <div><h3>{title} <small>· {meta}</small></h3><div className="simple-message">{children}</div></div>
  </article>
}

export function OutgoingMessageView({ meta, children }: { meta: string; children: ReactNode }) {
  return <article className="outgoing-message"><span>{meta}</span><p>{children}</p></article>
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

function AgentStreamingResponse({ status, activity, responseText, mentionHandles }: {
  status: 'queued' | 'running' | 'complete' | 'failed'
  activity?: 'searching_web' | 'generating_image' | 'using_computer'
  responseText?: string
  mentionHandles: Set<string>
}) {
  const activityLabel = status === 'queued'
    ? 'Waiting to start'
    : activity === 'searching_web'
      ? 'Checking public sources'
      : activity === 'generating_image'
        ? 'Creating your image'
        : activity === 'using_computer'
          ? 'Working in the live browser'
          : responseText ? 'Writing the reply' : 'Preparing a reply'
  const hasText = Boolean(responseText)

  return <div className={`agent-stream-response ${hasText ? 'has-text' : ''}`}>
    <details className="agent-reasoning-trace" open={!hasText}>
      <summary aria-label={`${activityLabel}. ${hasText ? 'Reply is appearing' : 'In progress'}`}>
        <span className="agent-stream-pulse"><ThinkingState /></span>
        <span className="agent-trace-copy"><strong>{activityLabel}</strong><small>{hasText ? 'Reply appearing' : 'In progress'}</small></span>
        <span className="agent-trace-action"><span className="when-closed">Show activity</span><span className="when-open">Hide activity</span><ChevronDown /></span>
      </summary>
      <div className="agent-stream-steps" aria-label="Saathi activity">
        <span className="done"><Check /> Request received</span>
        <span className={hasText ? 'done' : 'active'}>{hasText ? <Check /> : <i />} {activityLabel}</span>
        <span className={hasText ? 'active' : ''}><i /> Writing response</span>
      </div>
      <p>Saathi’s private reasoning is not shown. You can see its actions and sources.</p>
    </details>
    {responseText && <div className="streaming-markdown"><AssistantText text={responseText} streaming mentionHandles={mentionHandles} /><i className="response-stream-cursor" aria-hidden="true" /></div>}
  </div>
}

export function VoiceCallOverlay({ status, turns, activities, computerTool, voiceLevel, voiceSeconds, onMute, onEnd }: {
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
          : 'Call connected'
  return <div className="voice-call-backdrop" role="dialog" aria-modal="true" aria-labelledby="voice-call-title">
    <section className={`voice-call-sheet voice-state-${status}`}>
      <header className="voice-call-header">
        <div><span>VOICE CALL</span><h2 id="voice-call-title">Talking with Saathi</h2></div>
        <div className="voice-call-status-group"><span className={`voice-call-status ${status === 'muted' ? 'is-muted' : ''}`}><i />{statusText}</span><small>{formatVoiceDuration(voiceSeconds)} · est. {formatVoiceCost(voiceSeconds / 60 * 0.05)}</small></div>
      </header>
      <div className={`voice-call-body ${activities.length ? 'has-activity' : ''}`}>
        <div className="voice-call-presence">
          <div className="voice-orb-stage">
            <VoiceBlob level={voiceLevel} muted={status === 'muted'} />
          </div>
          <div className="voice-live-transcript" aria-live="polite" aria-label="Live call transcript">
            {turns.length === 0
              ? <div className="voice-transcript-placeholder"><AudioLines /><p>{status === 'live' || status === 'muted' ? 'Your words will appear here while the microphone is on.' : 'Your transcript will appear here.'}</p></div>
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
    <header><span>Saathi’s activity</span><small>Follow progress here</small></header>
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
            <strong>Browser activity</strong>
            <span>{voiceBrowserPhaseLabel(computerTool.phase)}{computerTool.selectedActionLabel ? ` · ${computerTool.selectedActionLabel}` : ''}</span>
          </p>}
          {liveViewUrl && <div className="voice-computer-handoff">
            <div><Monitor /><span><strong>Your turn in the browser</strong><small>Sign in here if needed. Saathi never asks for your password.</small></span></div>
            <a href={liveViewUrl} target="_blank" rel="noreferrer">Open full browser</a>
            <iframe title="Saathi voice live browser" src={liveViewUrl} allow="clipboard-write" referrerPolicy="no-referrer" />
          </div>}
          {!compact && activity.imageUrl && <figure className="voice-generated-image"><img src={activity.imageUrl} alt={activity.detail} /><figcaption>Created and saved in this conversation</figcaption></figure>}
          {!compact && activity.result && <div className="voice-activity-result"><AssistantText text={activity.result} /></div>}
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

function AssistantText({ text, streaming = false, mentionHandles }: { text: string; streaming?: boolean; mentionHandles?: Set<string> }) {
  const highlightMentions = (children: ReactNode) => Children.map(children, child => {
    if (typeof child !== 'string' || !mentionHandles?.size) return child
    return child.split(/(@[a-z][a-z0-9_]*)/gi).map((part, index) => {
      const username = part.startsWith('@') ? part.slice(1).toLowerCase() : ''
      return mentionHandles.has(username) ? <mark className="chat-mention" key={`${part}-${index}`}>{part}</mark> : part
    })
  })
  return <div className="assistant-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{
    a: ({ href, children }) => href?.startsWith('https://')
      ? <a href={href} target="_blank" rel="noreferrer">{highlightMentions(children)}</a>
      : <span>{highlightMentions(children)}</span>,
    p: ({ children }) => <p>{highlightMentions(children)}</p>,
    li: ({ children }) => <li>{highlightMentions(children)}</li>,
    strong: ({ children }) => <strong>{highlightMentions(children)}</strong>,
    em: ({ children }) => <em>{highlightMentions(children)}</em>,
    h1: ({ children }) => <h1>{highlightMentions(children)}</h1>,
    h2: ({ children }) => <h2>{highlightMentions(children)}</h2>,
    h3: ({ children }) => <h3>{highlightMentions(children)}</h3>,
    blockquote: ({ children }) => <blockquote>{highlightMentions(children)}</blockquote>,
  }}>{prepareAssistantMarkdown(text, streaming)}</ReactMarkdown></div>
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
      <summary><span>Style: {selected?.label ?? 'Warm household'} <small>Optional</small></span><span className="image-style-action"><span className="when-closed">Change</span><span className="when-open">Done</span><ChevronDown /></span></summary>
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
      <Button type="button" size="sm" onClick={onApprove} disabled={!prompt.trim()}>Add to message</Button>
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
  const isOtp = item.category === 'security' && Boolean(item.ephemeralExpiresAt)
  return <div className={`share-family-mail-row${isOtp ? ' otp-share-actions' : ''}`}>
    {isOtp && <p><ShieldCheck /> Shared codes and their inbox records are permanently deleted after five minutes.</p>}
    {!item.sharedAt && <Button type="button" size="lg" className="share-family-mail min-h-11 h-auto max-w-full whitespace-normal" onClick={() => onShareHere(item._id)}><UsersRound /> {isOtp ? `Share code with ${family.space.name}` : `Share with ${family.space.name}`}</Button>}
    {others.map(row => <Button type="button" size="lg" className="share-family-mail min-h-11 h-auto max-w-full whitespace-normal" key={row.space._id} onClick={() => onShareThere(item._id, row.space._id)}><UsersRound /> {isOtp ? `Share code with ${row.space.name}` : `Share with ${row.space.name}`}</Button>)}
  </div>
}

function recategorizationStatusLabel(status: 'queued' | 'running' | 'complete' | 'failed') {
  if (status === 'queued') return 'Queued'
  if (status === 'running') return 'Running in the background'
  if (status === 'complete') return 'Last run complete'
  return 'Last run needs attention'
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

  return <form className="dark-connect-card" onSubmit={submit}><label><Settings2 /> Family email inbox</label><p>Choose a name for this family’s email address.</p><FamilyAliasFields alias={alias} onAlias={setAlias} /><Button type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create inbox'}</Button>{error && <small role="alert">{error}</small>}</form>
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
    <label htmlFor="family-alias">Email address name</label>
    <div className="family-alias-row">
      <Input id="family-alias" value={alias} onChange={event => onAlias(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))} placeholder="kapoor-family" minLength={3} maxLength={32} />
      <Button variant="outline" type="button" onClick={() => void check()} disabled={checking || alias.trim().length < 3}>{checking ? 'Checking…' : 'Check availability'}</Button>
    </div>
    <small>We’ll check whether the name is available before creating the address.</small>
    {status && <small role="status">{status}</small>}
  </div>
}

function ModelTierControls({ spaceId }: { spaceId: Id<'spaces'> }) {
  const usage = useQuery(api.spaces.usageBreakdown, { spaceId })
  const setModelTier = useMutation(api.spaces.setModelTier)
  const tiers = [
    { id: 'low' as const, label: 'Low', detail: 'DeepSeek Flash' },
    { id: 'med' as const, label: 'Medium', detail: 'Luna mid' },
    { id: 'high' as const, label: 'High', detail: 'Grok 4.6 mid' },
    { id: 'ultra' as const, label: 'Ultra', detail: 'Sol high' },
  ]
  return <div className="model-tier-card">
    <p>Owners choose the family’s AI model. Medium is the default.</p>
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

type FamilyMember = FunctionReturnType<typeof api.spaces.members>[number]

function FamilyMemberCluster({ spaceId }: { spaceId: Id<'spaces'> }) {
  const members = useQuery(api.spaces.members, { spaceId })
  const [selectedMemberId, setSelectedMemberId] = useState<Id<'users'> | null>(null)
  const clusterRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const selectedMember = members?.find(member => member.userId === selectedMemberId) ?? null
  const visibleMembers = members?.slice(0, 3) ?? []
  const hiddenCount = Math.max(0, (members?.length ?? 0) - visibleMembers.length)

  const closeProfile = () => {
    setSelectedMemberId(null)
    requestAnimationFrame(() => triggerRef.current?.focus())
  }

  useEffect(() => {
    if (!selectedMember) return
    closeButtonRef.current?.focus()
    const dismissOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeProfile()
      }
    }
    const dismissOutside = (event: PointerEvent) => {
      if (!clusterRef.current?.contains(event.target as Node)) closeProfile()
    }
    window.addEventListener('keydown', dismissOnEscape)
    window.addEventListener('pointerdown', dismissOutside)
    return () => {
      window.removeEventListener('keydown', dismissOnEscape)
      window.removeEventListener('pointerdown', dismissOutside)
    }
  }, [selectedMember])

  const openProfile = (member: FamilyMember, trigger: HTMLButtonElement) => {
    triggerRef.current = trigger
    setSelectedMemberId(member.userId)
  }

  return <div className="participant-stack family-member-cluster" ref={clusterRef} aria-label={members === undefined ? 'Loading family members' : `${members.length} family ${members.length === 1 ? 'member' : 'members'}`}>
    {members === undefined && <span className="family-member-loading" aria-hidden="true" />}
    {visibleMembers.map(member => <button
      type="button"
      className={member.image ? 'family-member-avatar has-image' : 'family-member-avatar'}
      key={member.userId}
      onClick={event => openProfile(member, event.currentTarget)}
      aria-haspopup="dialog"
      aria-expanded={selectedMember?.userId === member.userId}
      aria-label={`Open profile for ${member.name}`}
    >
      {member.image && <img src={member.image} alt="" referrerPolicy="no-referrer" onError={event => event.currentTarget.parentElement?.classList.remove('has-image')} />}
      <span className="family-member-fallback">{initialsFor(member.name)}</span>
    </button>)}
    {hiddenCount > 0 && <span className="family-member-overflow" aria-label={`${hiddenCount} more family ${hiddenCount === 1 ? 'member' : 'members'}`}>+{hiddenCount}</span>}
    <span className="saathi-participant" role="img" aria-label="Saathi, your family assistant"><Sparkles /></span>
    {selectedMember && <section className="family-member-profile" role="dialog" aria-labelledby="family-member-profile-name">
      <button type="button" className="family-member-profile-close" onClick={closeProfile} aria-label={`Close ${selectedMember.name}'s profile`} ref={closeButtonRef}><X /></button>
      <span className="family-member-profile-avatar" aria-hidden="true">{selectedMember.image && <img src={selectedMember.image} alt="" referrerPolicy="no-referrer" onError={event => event.currentTarget.remove()} />}{initialsFor(selectedMember.name)}</span>
      <div><p>{selectedMember.role === 'owner' ? 'Family owner' : 'Family member'}</p><h3 id="family-member-profile-name">{selectedMember.name}</h3><span>{selectedMember.username && selectedMember.name !== `@${selectedMember.username}` ? `@${selectedMember.username}` : selectedMember.isCurrentUser ? 'This is you' : 'Member profile'}{selectedMember.isCurrentUser && selectedMember.username && selectedMember.name !== `@${selectedMember.username}` ? ' · This is you' : ''}</span></div>
    </section>}
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
        : 'Could not send the invitation. Check the email address and try again. If this continues, contact the Saathi administrator.')
    } finally {
      setBusy(false)
    }
  }

  const pending = invitations?.filter(invitation => !invitation.acceptedAt && !invitation.revokedAt && !invitation.expired) ?? []
  return <div className="invite-member-card"><form onSubmit={submit}><label htmlFor={`invite-email-${spaceId}`}><UserPlus /> Invite by email</label><Input id={`invite-email-${spaceId}`} type="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="family@example.com" required /><div className="chip-row" role="radiogroup" aria-label="Invitation role">{(['member', 'owner'] as const).map(option => <Button variant="outline" type="button" key={option} role="radio" aria-checked={role === option} className={role === option ? 'selected' : ''} onClick={() => setRole(option)}>{option === 'owner' ? 'Owner' : 'Member'}</Button>)}<Button type="submit" disabled={busy}>{busy ? 'Sending…' : 'Invite'}</Button></div></form>{feedback && <small role="status">{feedback}</small>}{pending.map(invitation => <div className="pending-invitation" key={invitation._id}><span><strong>{invitation.targetEmail}</strong><small>{invitation.role} · expires {new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(invitation.expiresAt)}</small></span><Button variant="outline" type="button" onClick={() => void revokeInvitation({ invitationId: invitation._id })}>Cancel invitation</Button></div>)}</div>
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

function MentionNotificationBadge({ count }: { count: number }) {
  if (!count) return null
  const label = `${count} unread ${count === 1 ? 'mention' : 'mentions'}`
  return <b className="notification-badge mention-notification-badge" aria-label={label}>{count > 99 ? '99+' : count}</b>
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
      {items?.map(item => {
        const recovery = inboxExtractionRecovery(item)
        return <article className="person-message inbox-card" key={item._id}>
        <span className="message-avatar email"><Mail /></span>
        <div>
          <h3><button type="button" className="inbox-subject-button" onClick={() => setOpenItem(item)}>{item.subject}</button> <small>{categoryLabel(item.category)}{item.subcategory ? ` · ${subcategoryLabel(item.subcategory)}` : ''} · {item.direction === 'outgoing' ? 'outgoing' : 'incoming'} · {formatRelativeTime(item.receivedAt)}</small></h3>
          <div className="simple-message inbox-message-card">
            <p className="inbox-sender">{displaySender(item.sender)}</p>
            <div className="inbox-facts">
              {item.subcategory && <p><span>Type</span><strong>{subcategoryLabel(item.subcategory)}</strong></p>}
              {item.extractedMerchant && <p><span>Merchant</span><strong>{item.extractedMerchant}</strong></p>}
              {item.extractedAmountInr && <p><span>Amount</span><strong>{item.extractedAmountInr.startsWith('₹') ? item.extractedAmountInr : `₹${item.extractedAmountInr}`}</strong></p>}
              {item.extractedAmountUsd && <p><span>Amount</span><strong>{item.extractedAmountUsd.startsWith('$') ? item.extractedAmountUsd : `$${item.extractedAmountUsd}`}</strong></p>}
              {!item.extractedAmountInr && !item.extractedAmountUsd && item.extractedAmount && <p><span>Amount</span><strong>{item.extractedAmount}</strong></p>}
              {item.extractedPeriod && <p><span>Period</span><strong>{item.extractedPeriod}</strong></p>}
              {item.extractedDueAt && <p><span>Due</span><strong>{new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(item.extractedDueAt)}</strong></p>}
            </div>
            {item.status === 'processing' && recovery && <p className="inbox-status">{recovery.pending}</p>}
            {item.status === 'failed' && recovery && <p className="inbox-status">{recovery.failed}</p>}
            {item.documentParseStatus === 'parsed' && <p>Attached PDF read successfully.</p>}
            {item.documentParseStatus === 'password' && <p>{item.processingNotes || 'A password-protected PDF needs a hint from the email body.'}</p>}
            {item.processingNotes && item.documentParseStatus !== 'password' && <p>{item.processingNotes}</p>}
            {(item.suggestedActions ?? []).map(action => <p key={`${item._id}-${action.kind}`}>{action.label}{action.detail ? ` — ${action.detail}` : ''}</p>)}
            <div className="inbox-actions">
              <button type="button" className="secondary inbox-open-action" onClick={() => setOpenItem(item)} aria-label={`Open email: ${item.subject}`}><MailOpen /> Open email</button>
              {canReadGmailPdf(item) && <button type="button" className="secondary" onClick={() => void reprocess({ inboxItemId: item._id })}>Read attached PDF</button>}
              {item.status !== 'processing' && item.documentParseStatus === 'failed' && item.documentParseRetryable !== false && <button type="button" className="secondary icon-action" onClick={() => void reprocess({ inboxItemId: item._id })} aria-label="Try reading attached PDF again" title="Try reading PDF again"><RefreshCcw /></button>}
              {item.status === 'failed' && item.documentParseStatus !== 'failed' && recovery && <button type="button" className="secondary" onClick={() => void reprocess({ inboxItemId: item._id })}><Sparkles /> {recovery.action}</button>}
            </div>
            {item.actionStatus === 'suggested' && <div className="inbox-actions">
              <button type="button" onClick={() => void confirmAction({ inboxItemId: item._id })}>Approve suggested next step</button>
              <button type="button" className="secondary" onClick={() => void dismissAction({ inboxItemId: item._id })}>Dismiss suggestion</button>
            </div>}
            {item.documentParseStatus === 'failed' && item.documentParseRetryable === false && <small>Retry disabled. Fix the PDF source or provider setup before trying again.</small>}
            {item.actionStatus === 'confirmed' && <small>Suggested next step approved. Nothing was sent or changed.</small>}
          </div>
        </div>
        </article>
      })}
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
        <div><span>{displaySender(item.sender)}</span><h2 id="email-detail-title">{item.subject}</h2><small>{categoryLabel(item.category)}{item.subcategory ? ` · ${subcategoryLabel(item.subcategory)}` : ''} · {formatRelativeTime(item.receivedAt)}</small></div>
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
      <div><div className="title-line"><h2>Files</h2><span className="live-label"><LockKeyhole /> Live</span></div><p>{family.space.name}</p></div>
    </header>
    <div className="conversation-feed live-feed">
      {files === undefined && <div className="dark-loading"><i /><i /><i /></div>}
      {files?.length === 0 && <div className="dark-empty-state compact"><Folder /><h2>No files yet</h2><p>Share a photo or document in a chat to find it here.</p></div>}
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
  if (category === 'appointments') return 'Appointments'
  if (category === 'security') return 'Security'
  return category.charAt(0).toUpperCase() + category.slice(1)
}

function subcategoryLabel(subcategory: NonNullable<Doc<'inboxItems'>['subcategory']>) {
  if (subcategory === 'otp') return 'OTP or verification code'
  return subcategory.split('_').map(word => word === 'demat' ? 'Demat' : word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
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
  if (item.ephemeralExpiresAt || item.status === 'processing' || item.status === 'failed' || !item.agentmailMessageId.startsWith('gmail:')) return false
  if (item.documentParseStatus === undefined) return true
  return item.documentParseStatus === 'none' && Boolean(item.processingNotes?.includes('no public document link'))
}

function suggestFamilyAliasFromName(name: string) {
  return name.toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32).replace(/-+$/g, '')
}

function familyInboxError(error: unknown) {
  const code = convexErrorCode(error)
  if (code === 'ALIAS_TAKEN') return 'That email name is taken. Choose another.'
  if (code === 'ALIAS_INVALID') return 'Use 3–32 lowercase letters, numbers, and single hyphens.'
  if (code === 'AGENTMAIL_PERMISSION') return 'Email setup does not allow new family inboxes. Contact the Saathi administrator.'
  if (code === 'AGENTMAIL_AUTH') return 'The email service could not sign in. Contact the Saathi administrator.'
  if (code === 'AGENTMAIL_RATE_LIMIT') return 'The email service is busy. Wait a moment and try again.'
  return 'Could not create the inbox. Try again. If this continues, contact the Saathi administrator.'
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
