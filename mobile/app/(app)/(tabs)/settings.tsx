import { useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useAuthActions } from '@convex-dev/auth/react'
import { useAction, useMutation, useQuery } from 'convex/react'
import { SafeAreaView } from 'react-native-safe-area-context'
import * as Clipboard from 'expo-clipboard'
import * as WebBrowser from 'expo-web-browser'
import { Check, Copy, LogOut } from 'lucide-react-native'
import { api } from '../../../../convex/_generated/api'
import type { Id } from '../../../../convex/_generated/dataModel'
import { IMAGE_PRESET_GROUPS, IMAGE_PRESETS } from '../../../../convex/lib/imageSafety'
import { Chip, Display, ErrorText, Field, Muted, PrimaryButton, SecondaryButton, SectionLabel } from '../../../src/components/ui'
import { FamilySwitcher } from '../../../src/components/FamilySwitcher'
import { useFamily } from '../../../src/family'
import { convexErrorCode } from '../../../src/errors'
import { formatRelativeTime, languageLabel, operationId } from '../../../src/format'
import { colors, fonts, radius, space } from '../../../src/theme'

export default function Settings() {
  const { signOut } = useAuthActions()
  const { family, families, user } = useFamily()
  const saveProfile = useMutation(api.users.ensureCurrent)
  const foodBudget = useQuery(api.budget.food, { spaceId: family.space._id })
  const setFoodLimit = useMutation(api.budget.setFoodLimit)
  const gmailConnections = useQuery(api.gmailData.mine, { spaceId: family.space._id })
  const beginGmailConnection = useAction(api.gmail.beginConnection)
  const confirmGmailConnection = useAction(api.gmail.confirmConnection)
  const checkGmailNow = useAction(api.gmail.checkNow)
  const [budgetDraft, setBudgetDraft] = useState('')
  const [budgetCurrency, setBudgetCurrency] = useState<'INR' | 'USD'>('INR')
  const [budgetBusy, setBudgetBusy] = useState(false)
  const [gmailBusy, setGmailBusy] = useState(false)
  const [gmailMessage, setGmailMessage] = useState('')
  const [copiedInbox, setCopiedInbox] = useState(false)
  const ownedCount = families.filter(row => row.membership.role === 'owner').length

  const connectGmail = async () => {
    setGmailBusy(true)
    setGmailMessage('Opening Google sign-in…')
    try {
      const { redirectUrl } = await beginGmailConnection({ spaceId: family.space._id })
      const siteUrl = process.env.EXPO_PUBLIC_SITE_URL?.trim() || 'https://giant-caiman-748.convex.site'
      const result = await WebBrowser.openAuthSessionAsync(redirectUrl, siteUrl)
      if (result.type !== 'success') {
        setGmailMessage('Gmail was not connected. You can try again.')
        return
      }
      const params = new URL(result.url).searchParams
      const connectedAccountId = params.get('connected_account_id') ?? params.get('connectedAccountId')
      if (params.get('status') !== 'success' || !connectedAccountId) {
        setGmailMessage('Gmail was not connected. You can try again.')
        return
      }
      setGmailMessage('Finishing Gmail setup…')
      await confirmGmailConnection({ spaceId: family.space._id, connectedAccountId })
      setGmailMessage('Gmail connected. Saathi is privately reviewing the last 30 days.')
    } catch (caught) {
      setGmailMessage(convexErrorCode(caught) === 'COMPOSIO_NOT_CONFIGURED'
        ? 'Gmail connections need a Composio API key on this deployment.'
        : 'Could not start Gmail connection. Please try again.')
    } finally {
      setGmailBusy(false)
    }
  }

  return (
    <SafeAreaView style={styles.page} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <FamilySwitcher />
        <Display style={{ marginTop: 18 }}>Settings</Display>
        <Muted style={{ marginTop: 6 }}>Change a control here, or ask Saathi in the conversation.</Muted>

        <View style={styles.block}>
          <SectionLabel>Your preferences</SectionLabel>
          <Text style={styles.label}>Reading language</Text>
          <View style={styles.row}>
            {(['en', 'hi', 'mr'] as const).map(code => (
              <Chip key={code} label={languageLabel(code)} selected={(user.preferredLanguage ?? 'en') === code} onPress={() => void saveProfile({ preferredLanguage: code })} />
            ))}
          </View>
          <Text style={[styles.label, { marginTop: 16 }]}>Default image style</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
            {IMAGE_PRESET_GROUPS.flatMap(group => IMAGE_PRESETS.filter(preset => preset.group === group)).map(preset => (
              <Chip
                key={preset.id}
                label={preset.label}
                selected={(user.preferredImageStyle ?? 'warm_family') === preset.id}
                onPress={() => void saveProfile({ preferredImageStyle: preset.id })}
              />
            ))}
          </ScrollView>
        </View>

        <View style={styles.block}>
          <SectionLabel>Your Gmail</SectionLabel>
          <Muted>Useful mail is added privately to My Saathi. Other family members cannot see your connected accounts.</Muted>
          {(gmailConnections ?? []).map(connection => (
            <View key={connection._id} style={styles.account}>
              <Check color={colors.teal} size={16} />
              <View>
                <Text style={styles.accountName}>{connection.email ?? connection.alias}</Text>
                <Text style={styles.meta}>{connection.lastSyncedAt ? `Checked ${formatRelativeTime(connection.lastSyncedAt)}` : 'Reviewing the last 30 days…'}</Text>
              </View>
            </View>
          ))}
          <SecondaryButton
            label={gmailBusy ? 'Working…' : gmailConnections?.length ? 'Connect another Gmail' : 'Connect Gmail'}
            disabled={gmailBusy}
            onPress={() => void connectGmail()}
          />
          {(gmailConnections?.length ?? 0) > 0 && (
            <SecondaryButton
              label="Check for new mail"
              disabled={gmailBusy}
              onPress={() => {
                setGmailBusy(true)
                void checkGmailNow({ spaceId: family.space._id })
                  .then(count => setGmailMessage(count ? 'Checking inboxes now. New bills appear in My Saathi first.' : 'No Gmail accounts are connected yet.'))
                  .catch(() => setGmailMessage('Could not check Gmail right now.'))
                  .finally(() => setGmailBusy(false))
              }}
            />
          )}
          {gmailMessage ? <Muted>{gmailMessage}</Muted> : null}
        </View>

        <View style={styles.block}>
          <SectionLabel>Food budget</SectionLabel>
          <Text style={styles.budget}>
            {foodBudget?.monthlyLimit != null
              ? `${foodBudget.currency === 'USD' ? '$' : '₹'}${Math.round(foodBudget.spentThisMonth)} of ${foodBudget.currency === 'USD' ? '$' : '₹'}${Math.round(foodBudget.monthlyLimit)} this month`
              : `${foodBudget?.currency === 'USD' ? '$' : '₹'}${Math.round(foodBudget?.spentThisMonth ?? 0)} tracked this month`}
          </Text>
          {family.membership.role === 'owner' ? (
            <View style={{ gap: 12, marginTop: 12 }}>
              <View style={styles.row}>
                {(['INR', 'USD'] as const).map(code => (
                  <Chip key={code} label={code} selected={budgetCurrency === code} onPress={() => setBudgetCurrency(code)} />
                ))}
              </View>
              <Field
                label="Monthly limit"
                value={budgetDraft}
                onChangeText={setBudgetDraft}
                keyboardType="numeric"
                placeholder={budgetCurrency === 'USD' ? 'Limit in $' : 'Limit in ₹'}
              />
              <PrimaryButton
                label={budgetBusy ? 'Saving…' : 'Set limit'}
                loading={budgetBusy}
                disabled={!budgetDraft}
                onPress={() => {
                  const monthlyLimit = Number(budgetDraft)
                  if (!monthlyLimit) return
                  setBudgetBusy(true)
                  void setFoodLimit({ spaceId: family.space._id, monthlyLimit, currency: budgetCurrency })
                    .then(() => setBudgetDraft(''))
                    .finally(() => setBudgetBusy(false))
                }}
              />
            </View>
          ) : null}
        </View>

        <View style={styles.block}>
          <SectionLabel>Family inbox</SectionLabel>
          {family.space.agentmailInboxId ? (
            <Pressable
              style={styles.account}
              onPress={() => {
                void Clipboard.setStringAsync(family.space.agentmailInboxId ?? '').then(() => {
                  setCopiedInbox(true)
                  setTimeout(() => setCopiedInbox(false), 2000)
                })
              }}
            >
              <Copy color={colors.teal} size={16} />
              <View>
                <Text style={styles.accountName}>{family.space.agentmailInboxId}</Text>
                <Text style={styles.meta}>{copiedInbox ? 'Copied' : 'Tap to copy'}</Text>
              </View>
            </Pressable>
          ) : family.membership.role === 'owner' ? (
            <ConnectInbox spaceId={family.space._id} />
          ) : (
            <Muted>Ask a family owner to connect AgentMail.</Muted>
          )}
        </View>

        {family.membership.role === 'owner' ? <ModelTier spaceId={family.space._id} /> : null}
        {family.membership.role === 'owner' ? <ByokKeys spaceId={family.space._id} /> : null}
        {family.membership.role === 'owner' ? <InviteMember spaceId={family.space._id} /> : null}
        {family.membership.role === 'owner' && ownedCount < 3 ? <CreateAnotherFamily /> : null}

        <Pressable onPress={() => void signOut()} style={styles.signOut}>
          <LogOut color={colors.coral} size={18} />
          <Text style={styles.signOutLabel}>Sign out</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  )
}

function ConnectInbox({ spaceId }: { spaceId: Id<'spaces'> }) {
  const createInbox = useAction(api.agentmailInboxes.createForFamily)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return (
    <View style={{ gap: 10 }}>
      <SecondaryButton
        label={busy ? 'Creating…' : 'Create inbox'}
        disabled={busy}
        onPress={() => {
          setBusy(true)
          setError('')
          void createInbox({ spaceId }).catch(caught => {
            const code = convexErrorCode(caught)
            setError(code === 'AGENTMAIL_PERMISSION'
              ? 'The AgentMail key needs organization-level inbox creation access.'
              : 'We could not create the inbox. Try again.')
            setBusy(false)
          })
        }}
      />
      <ErrorText>{error}</ErrorText>
    </View>
  )
}

function ModelTier({ spaceId }: { spaceId: Id<'spaces'> }) {
  const usage = useQuery(api.spaces.usageBreakdown, { spaceId })
  const setModelTier = useMutation(api.spaces.setModelTier)
  const tiers = [
    { id: 'low' as const, label: 'Low', detail: 'DeepSeek Flash' },
    { id: 'med' as const, label: 'Med', detail: 'Luna mid' },
    { id: 'high' as const, label: 'High', detail: 'Grok 4.6' },
    { id: 'ultra' as const, label: 'Ultra', detail: 'Sol high' },
  ]
  return (
    <View style={styles.block}>
      <SectionLabel>Family model</SectionLabel>
      <Muted>Owners choose how hard Saathi thinks. Medium is the default.</Muted>
      <View style={styles.row}>
        {tiers.map(tier => (
          <Chip key={tier.id} label={tier.label} selected={(usage?.tier ?? 'med') === tier.id} onPress={() => void setModelTier({ spaceId, tier: tier.id })} />
        ))}
      </View>
    </View>
  )
}

function ByokKeys({ spaceId }: { spaceId: Id<'spaces'> }) {
  const keys = useQuery(api.spaces.providerKeyStatus, { spaceId })
  const saveKey = useMutation(api.spaces.saveProviderKey)
  const removeKey = useMutation(api.spaces.removeProviderKey)
  const [provider, setProvider] = useState<'openai' | 'openrouter' | 'codex'>('openai')
  const [secret, setSecret] = useState('')
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState('')
  return (
    <View style={styles.block}>
      <SectionLabel>Your provider keys</SectionLabel>
      <Muted>The secret is encrypted. Only the last four characters are shown.</Muted>
      <View style={styles.row}>
        {(['openai', 'openrouter', 'codex'] as const).map(id => (
          <Chip key={id} label={id === 'openai' ? 'OpenAI' : id === 'openrouter' ? 'OpenRouter' : 'Codex'} selected={provider === id} onPress={() => setProvider(id)} />
        ))}
      </View>
      <Field label="API key" value={secret} onChangeText={setSecret} secureTextEntry placeholder={provider === 'openrouter' ? 'sk-or-…' : 'sk-…'} autoCapitalize="none" />
      <PrimaryButton
        label={busy ? 'Saving…' : 'Save key'}
        loading={busy}
        disabled={secret.trim().length < 20}
        onPress={() => {
          setBusy(true)
          setFeedback('')
          void saveKey({ spaceId, provider, secret })
            .then(() => { setSecret(''); setFeedback('Saved. Saathi will use this key for this family.') })
            .catch(() => setFeedback('That key could not be saved.'))
            .finally(() => setBusy(false))
        }}
      />
      {feedback ? <Muted>{feedback}</Muted> : null}
      {(keys ?? []).map(key => (
        <View key={key.provider} style={styles.account}>
          <View style={{ flex: 1 }}>
            <Text style={styles.accountName}>{key.provider}</Text>
            <Text style={styles.meta}>ending {key.lastFour}</Text>
          </View>
          <Pressable onPress={() => void removeKey({ spaceId, provider: key.provider })}><Text style={styles.link}>Remove</Text></Pressable>
        </View>
      ))}
    </View>
  )
}

function InviteMember({ spaceId }: { spaceId: Id<'spaces'> }) {
  const invitations = useQuery(api.invitations.list, { spaceId })
  const createInvitation = useAction(api.invitations.createAndSend)
  const revokeInvitation = useMutation(api.invitations.revoke)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'member' | 'owner'>('member')
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState('')
  const pending = invitations?.filter(invitation => !invitation.acceptedAt && !invitation.revokedAt && !invitation.expired) ?? []
  return (
    <View style={styles.block}>
      <SectionLabel>Family access</SectionLabel>
      <Field label="Invite by email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" placeholder="family@example.com" />
      <View style={styles.row}>
        <Chip label="Member" selected={role === 'member'} onPress={() => setRole('member')} />
        <Chip label="Owner" selected={role === 'owner'} onPress={() => setRole('owner')} />
      </View>
      <PrimaryButton
        label={busy ? 'Sending…' : 'Invite'}
        loading={busy}
        disabled={!email.includes('@')}
        onPress={() => {
          setBusy(true)
          setFeedback('')
          void createInvitation({ spaceId, targetEmail: email, role, clientOperationId: operationId() })
            .then(() => { setEmail(''); setFeedback('Invitation sent. They join after signing in with that email.') })
            .catch(error => setFeedback(convexErrorCode(error) === 'RATE_LIMITED' ? 'Too many invitations were sent.' : 'The invitation could not be sent.'))
            .finally(() => setBusy(false))
        }}
      />
      {feedback ? <Muted>{feedback}</Muted> : null}
      {pending.map(invitation => (
        <View key={invitation._id} style={styles.account}>
          <View style={{ flex: 1 }}>
            <Text style={styles.accountName}>{invitation.targetEmail}</Text>
            <Text style={styles.meta}>{invitation.role}</Text>
          </View>
          <Pressable onPress={() => void revokeInvitation({ invitationId: invitation._id })}><Text style={styles.link}>Revoke</Text></Pressable>
        </View>
      ))}
    </View>
  )
}

function CreateAnotherFamily() {
  const createSpace = useMutation(api.spaces.create)
  const { selectFamily } = useFamily()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return (
    <View style={styles.block}>
      <SectionLabel>Another family</SectionLabel>
      <Field label="Family name" value={name} onChangeText={setName} placeholder="Parents’ home" />
      <SecondaryButton
        label={busy ? 'Creating…' : 'Create family'}
        disabled={busy || name.trim().length < 2}
        onPress={() => {
          setBusy(true)
          setError('')
          void createSpace({ name, creationKey: operationId() })
            .then(spaceId => { setName(''); selectFamily(spaceId) })
            .catch(() => setError('You can own up to 3 families.'))
            .finally(() => setBusy(false))
        }}
      />
      <ErrorText>{error}</ErrorText>
    </View>
  )
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: space.lg, paddingTop: 12, paddingBottom: 48, gap: 8 },
  block: { marginTop: 22, gap: 12 },
  label: { color: colors.textMuted, fontFamily: fonts.sansMedium, fontSize: 13 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  account: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  accountName: { color: colors.text, fontFamily: fonts.sansBold, fontSize: 14 },
  meta: { color: colors.textFaint, fontFamily: fonts.sans, fontSize: 12, marginTop: 2 },
  budget: { color: colors.text, fontFamily: fonts.serif, fontSize: 22 },
  link: { color: colors.teal, fontFamily: fonts.sansMedium, fontSize: 14 },
  signOut: {
    marginTop: 36,
    minHeight: 54,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.coralSoft,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  signOutLabel: { color: colors.coral, fontFamily: fonts.sansBold, fontSize: 16 },
})
