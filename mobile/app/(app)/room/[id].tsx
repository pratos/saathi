import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useMutation, useQuery } from 'convex/react'
import { Image } from 'expo-image'
import * as DocumentPicker from 'expo-document-picker'
import * as ImagePicker from 'expo-image-picker'
import * as Haptics from 'expo-haptics'
import { SafeAreaView } from 'react-native-safe-area-context'
import { ArrowLeft, Camera, Image as ImageIcon, Mic, Paperclip, Plus, Send } from 'lucide-react-native'
import { api } from '../../../../convex/_generated/api'
import type { Doc, Id } from '../../../../convex/_generated/dataModel'
import { IMAGE_PRESETS } from '../../../../convex/lib/imageSafety'
import { Markdown } from '../../../src/components/Markdown'
import { Chip, ErrorText, Muted, PrimaryButton, SecondaryButton } from '../../../src/components/ui'
import { VoiceCall } from '../../../src/components/VoiceCall'
import { useFamily } from '../../../src/family'
import { formatFileSize, formatRelativeTime, formatVoiceCost, formatVoiceDuration, operationId } from '../../../src/format'
import { isVoiceCallOpen, useLiveVoice } from '../../../src/hooks/useLiveVoice'
import { colors, fonts, radius, space } from '../../../src/theme'

const MAX_IMAGE_BYTES = 20 * 1024 * 1024
const MAX_DOCUMENT_BYTES = 50 * 1024 * 1024

export default function RoomScreen() {
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: Id<'rooms'> }>()
  const { family, user } = useFamily()
  const rooms = useQuery(api.rooms.list, { spaceId: family.space._id })
  const room = rooms?.find(row => row.room?._id === id)?.room
  if (!room) {
    return (
      <SafeAreaView style={styles.page}>
        <Pressable onPress={() => router.back()} style={styles.back}><ArrowLeft color={colors.text} size={22} /><Text style={styles.backLabel}>Home</Text></Pressable>
        <Muted style={{ padding: 24 }}>Opening this conversation…</Muted>
      </SafeAreaView>
    )
  }
  return <LiveRoom room={room} />
}

function LiveRoom({ room }: { room: Doc<'rooms'> }) {
  const router = useRouter()
  const { family, user } = useFamily()
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
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [imageOpen, setImageOpen] = useState(false)
  const [imageDraft, setImageDraft] = useState('')
  const [imageStyle, setImageStyle] = useState<(typeof IMAGE_PRESETS)[number]['id']>(user.preferredImageStyle ?? 'warm_family')
  const [uploads, setUploads] = useState<Array<{ id: string; name: string; status: 'uploading' | 'error'; message?: string }>>([])
  const feed = useRef<ScrollView>(null)
  const voice = useLiveVoice(room._id)
  const attachmentMessageIds = useMemo(() => new Set((attachments ?? []).map(item => item.messageId)), [attachments])
  const activeJob = saathi?.jobs.find(job => job.status === 'running') ?? saathi?.jobs.find(job => job.status === 'queued')
  const failedJob = saathi?.jobs[0]?.status === 'failed' ? saathi.jobs[0] : null
  const mentionQuery = draft.match(/(?:^|\s)@([a-zA-Z0-9_]*)$/)?.[1]?.toLowerCase()
  const filteredMentions = (mentionCandidates ?? []).filter(candidate =>
    mentionQuery !== undefined && (candidate.username.startsWith(mentionQuery) || candidate.label.toLowerCase().startsWith(mentionQuery)),
  ).slice(0, 6)
  const timeline = useMemo(() => [
    ...(messages ?? []).filter(item => !attachmentMessageIds.has(item._id)).map(item => ({ kind: 'message' as const, createdAt: item.createdAt, item })),
    ...(generatedImages ?? []).map(item => ({ kind: 'image' as const, createdAt: item.createdAt, item })),
    ...(attachments ?? []).map(item => ({ kind: 'attachment' as const, createdAt: item.createdAt, item })),
  ].sort((left, right) => left.createdAt - right.createdAt), [messages, generatedImages, attachments, attachmentMessageIds])

  useEffect(() => {
    feed.current?.scrollToEnd({ animated: true })
  }, [timeline.length, activeJob?.responseText, activeJob?.status])

  const send = async (text = draft.trim()) => {
    if (!text) return
    setBusy(true)
    setError('')
    try {
      await postMessage({ roomId: room._id, text, language: user.preferredLanguage ?? 'en', clientOperationId: operationId() })
      setDraft('')
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    } catch {
      setError('Your message could not be shared. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  const uploadUri = async (uri: string, fileName: string, mediaType: string, capture: 'library' | 'camera' | 'receipt', size?: number) => {
    const id = operationId()
    const maxBytes = mediaType.startsWith('image/') ? MAX_IMAGE_BYTES : MAX_DOCUMENT_BYTES
    if (size && size > maxBytes) {
      setUploads(current => [...current, { id, name: fileName, status: 'error', message: mediaType.startsWith('image/') ? 'Images must be smaller than 20 MB.' : 'Documents must be smaller than 50 MB.' }])
      return
    }
    setUploads(current => [...current, { id, name: fileName, status: 'uploading' }])
    try {
      const uploadUrl = await generateAttachmentUploadUrl({ roomId: room._id })
      const blob = await (await fetch(uri)).blob()
      const response = await fetch(uploadUrl, { method: 'POST', headers: { 'Content-Type': mediaType }, body: blob })
      if (!response.ok) throw new Error('upload failed')
      const payload: unknown = await response.json()
      if (!payload || typeof payload !== 'object' || typeof (payload as { storageId?: unknown }).storageId !== 'string') throw new Error('invalid upload')
      await submitAttachment({
        roomId: room._id,
        storageId: (payload as { storageId: Id<'_storage'> }).storageId,
        fileName,
        mediaType,
        clientOperationId: id,
        capture,
      })
      setUploads(current => current.filter(upload => upload.id !== id))
    } catch {
      setUploads(current => current.map(upload => upload.id === id ? { ...upload, status: 'error', message: 'Could not upload this file.' } : upload))
    }
  }

  return (
    <SafeAreaView style={styles.page} edges={['top']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={12}><ArrowLeft color={colors.text} size={22} /></Pressable>
          <View style={{ flex: 1 }}>
            <Text style={styles.title} numberOfLines={1}>{room.title}</Text>
            <Text style={styles.subtitle}>{room.type === 'private' ? 'Only you and Saathi' : `${family.space.name} · family`}</Text>
          </View>
          <Pressable onPress={() => void voice.start()} style={styles.voiceBtn} hitSlop={8}>
            <Mic color={colors.paper} size={18} />
          </Pressable>
        </View>

        <ScrollView ref={feed} contentContainerStyle={styles.feed} onContentSizeChange={() => feed.current?.scrollToEnd({ animated: true })}>
          {timeline.length === 0 && messages ? (
            <View style={styles.starter}>
              <Text style={styles.starterTitle}>{room.type === 'private' ? 'What can Saathi help with?' : 'Start with what your family needs'}</Text>
              {(room.type === 'private'
                ? ['Use Hindi for me', 'Set our food budget to ₹15,000', 'Create a Diwali invitation image']
                : ['Help us plan a family dinner', 'Summarize the file I share', 'Find current train options']
              ).map(prompt => (
                <Pressable key={prompt} onPress={() => setDraft(prompt)} style={styles.prompt}>
                  <Text style={styles.promptText}>{prompt}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}

          {timeline.map(entry => {
            if (entry.kind === 'image' && entry.item.url) {
              return (
                <View key={`image-${entry.item._id}`} style={styles.saathi}>
                  <Text style={styles.who}>Saathi · generated image</Text>
                  <Image source={{ uri: entry.item.url }} style={styles.image} contentFit="cover" />
                  <Muted>{entry.item.prompt}</Muted>
                </View>
              )
            }
            if (entry.kind === 'attachment') {
              return (
                <View key={`attachment-${entry.item._id}`} style={styles.mine}>
                  <Text style={styles.whoRight}>You · {formatRelativeTime(entry.item.createdAt)}</Text>
                  {entry.item.mediaType.startsWith('image/') && entry.item.url
                    ? <Image source={{ uri: entry.item.url }} style={styles.image} contentFit="cover" />
                    : <View style={styles.doc}><Text style={styles.docName}>{entry.item.fileName}</Text><Text style={styles.meta}>{formatFileSize(entry.item.sizeBytes)}</Text></View>}
                  {entry.item.transcript ? <Text style={styles.caption}>{entry.item.extractedMerchant ? `${entry.item.extractedMerchant}${entry.item.extractedAmount ? ` · ${entry.item.extractedAmount}` : ''}` : entry.item.transcript}</Text> : null}
                </View>
              )
            }
            if (entry.kind !== 'message') return null
            const message = entry.item
            if (message.actorType === 'voice_transcript' && message.voiceSpeaker === 'user') {
              return <Bubble key={message._id} mine who={`You · voice · ${formatRelativeTime(message.createdAt)}`} text={message.originalText} />
            }
            if (message.actorType === 'voice_transcript' && message.voiceSpeaker === 'assistant') {
              return <Bubble key={message._id} who={`Saathi · voice · ${formatRelativeTime(message.createdAt)}`} text={message.originalText} />
            }
            if (message.actorType === 'voice_transcript') {
              return (
                <View key={message._id} style={styles.summary}>
                  <Text style={styles.who}>Voice call summary · {formatRelativeTime(message.createdAt)}</Text>
                  <Text style={styles.body}>{message.originalText}</Text>
                  {message.voiceSeconds !== undefined ? <Text style={styles.meta}>{formatVoiceDuration(message.voiceSeconds)} · est. {formatVoiceCost(message.voiceCostUsd ?? 0)}</Text> : null}
                </View>
              )
            }
            if (message.actorType === 'user') {
              const mine = message.authorUserId === user._id
              return (
                <Bubble
                  key={message._id}
                  mine={mine}
                  who={`${mine ? 'You' : message.authorUsername ? `@${message.authorUsername}` : 'Family'} · ${formatRelativeTime(message.createdAt)}`}
                  text={message.originalText}
                />
              )
            }
            return (
              <View key={message._id} style={styles.saathi}>
                <Text style={styles.who}>{message.actorType === 'assistant' ? 'Saathi' : 'Email guest'} · {formatRelativeTime(message.createdAt)}</Text>
                {message.actorType === 'assistant' ? <Markdown text={message.originalText} /> : <Text style={styles.body}>{message.originalText}</Text>}
                {room.type === 'private' && message.actorType === 'email_guest' && pendingMoney?.some(item => item.agentmailMessageId === message.idempotencyKey) ? (
                  <Pressable onPress={() => {
                    const match = pendingMoney.find(item => item.agentmailMessageId === message.idempotencyKey)
                    if (match) void shareMoney({ inboxItemId: match._id })
                  }}>
                    <Text style={styles.link}>Share with family inbox</Text>
                  </Pressable>
                ) : null}
              </View>
            )
          })}

          {voice.summarizing ? <Text style={styles.working}>Saathi is writing a call summary…</Text> : null}
          {activeJob?.trigger === 'ambient' && !activeJob.responseText ? <Text style={styles.working}>Saathi is checking whether help is needed…</Text> : null}
          {activeJob && (activeJob.trigger !== 'ambient' || activeJob.responseText) ? (
            <View style={styles.saathi}>
              <Text style={styles.who}>Saathi · {activeJob.responseText ? 'typing' : 'thinking'}</Text>
              {activeJob.responseText ? <Markdown text={activeJob.responseText} /> : <Text style={styles.working}>…</Text>}
            </View>
          ) : null}
          {failedJob && failedJob.trigger !== 'ambient' && !activeJob ? (
            <View style={styles.saathi}>
              <Text style={styles.who}>Saathi · couldn’t respond</Text>
              <SecondaryButton label="Try again" onPress={() => saathi && void retrySaathi({ agentId: saathi.agent._id, prompt: failedJob.prompt, clientOperationId: operationId() })} />
            </View>
          ) : null}
        </ScrollView>

        <View style={styles.composer}>
          {uploads.map(upload => (
            <Text key={upload.id} style={styles.meta}>{upload.name} · {upload.status === 'uploading' ? 'Uploading…' : upload.message}</Text>
          ))}
          {imageOpen ? (
            <View style={styles.imageBox}>
              <TextInput
                value={imageDraft}
                onChangeText={setImageDraft}
                placeholder="A family rangoli by the door…"
                placeholderTextColor={colors.textFaint}
                style={styles.imageInput}
                multiline
              />
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                {IMAGE_PRESETS.slice(0, 8).map(preset => (
                  <Chip key={preset.id} label={preset.label} selected={imageStyle === preset.id} onPress={() => setImageStyle(preset.id)} />
                ))}
              </ScrollView>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <PrimaryButton label="Use this style" onPress={() => {
                  const preset = IMAGE_PRESETS.find(item => item.id === imageStyle)
                  void send(`@saathi Create an image in the ${preset?.label ?? 'Warm household'} style: ${imageDraft.trim()}`)
                  setImageOpen(false)
                  setImageDraft('')
                }} />
                <SecondaryButton label="Cancel" onPress={() => setImageOpen(false)} />
              </View>
            </View>
          ) : null}
          {filteredMentions.length > 0 ? (
            <View style={styles.mentions}>
              {filteredMentions.map(candidate => (
                <Pressable key={`${candidate.kind}-${candidate.username}`} onPress={() => {
                  setDraft(current => current.replace(/@([a-zA-Z0-9_]*)$/, `@${candidate.kind === 'assistant' ? 'Saathi' : candidate.username} `))
                }} style={styles.mention}>
                  <Text style={styles.mentionName}>@{candidate.kind === 'assistant' ? 'Saathi' : candidate.username}</Text>
                  <Text style={styles.meta}>{candidate.kind === 'assistant' ? 'Family assistant' : candidate.label}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
          <View style={styles.tools}>
            <Tool icon={<Paperclip color={colors.textMuted} size={18} />} onPress={async () => {
              const result = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true })
              if (result.canceled) return
              for (const file of result.assets) {
                await uploadUri(file.uri, file.name, file.mimeType || 'application/octet-stream', 'library', file.size)
              }
            }} />
            <Tool icon={<Camera color={colors.textMuted} size={18} />} onPress={async () => {
              const result = await ImagePicker.launchCameraAsync({ quality: 0.85 })
              if (result.canceled) return
              const asset = result.assets[0]
              await uploadUri(asset.uri, asset.fileName ?? 'photo.jpg', asset.mimeType ?? 'image/jpeg', 'camera', asset.fileSize)
            }} />
            <Tool icon={<ImageIcon color={colors.textMuted} size={18} />} onPress={() => setImageOpen(current => !current)} />
            <Tool icon={<Plus color={colors.textMuted} size={18} />} onPress={async () => {
              const result = await ImagePicker.launchImageLibraryAsync({ quality: 0.85, allowsMultipleSelection: true })
              if (result.canceled) return
              for (const asset of result.assets) {
                await uploadUri(asset.uri, asset.fileName ?? 'photo.jpg', asset.mimeType ?? 'image/jpeg', 'library', asset.fileSize)
              }
            }} />
          </View>
          <View style={styles.inputRow}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder={room.type === 'private' ? 'Ask Saathi anything…' : 'Message your family…'}
              placeholderTextColor={colors.textFaint}
              style={styles.input}
              multiline
            />
            <Pressable onPress={() => void send()} disabled={busy || !draft.trim()} style={[styles.send, (!draft.trim() || busy) && { opacity: 0.4 }]}>
              <Send color={colors.ink} size={18} />
            </Pressable>
          </View>
          <ErrorText>{error || voice.error}</ErrorText>
        </View>
        {isVoiceCallOpen(voice.status) ? (
          <VoiceCall
            status={voice.status}
            turns={voice.turns}
            activities={voice.activities}
            computerTool={voice.computerTool}
            voiceSeconds={voice.voiceSeconds}
            onMute={voice.toggleMute}
            onEnd={voice.end}
          />
        ) : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

function Bubble({ mine, who, text }: { mine?: boolean; who: string; text: string }) {
  return (
    <View style={mine ? styles.mine : styles.theirs}>
      <Text style={mine ? styles.whoRight : styles.who}>{who}</Text>
      <Text style={mine ? styles.mineText : styles.body}>{text}</Text>
    </View>
  )
}

function Tool({ icon, onPress }: { icon: ReactNode; onPress: () => void }) {
  return <Pressable onPress={onPress} style={styles.tool}>{icon}</Pressable>
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.bg },
  back: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 16 },
  backLabel: { color: colors.text, fontFamily: fonts.sansMedium, fontSize: 16 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: space.md, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: colors.line },
  title: { color: colors.text, fontFamily: fonts.serif, fontSize: 20 },
  subtitle: { color: colors.textFaint, fontFamily: fonts.sans, fontSize: 12, marginTop: 2 },
  voiceBtn: { width: 42, height: 42, borderRadius: 14, backgroundColor: colors.tealDim, alignItems: 'center', justifyContent: 'center' },
  feed: { padding: space.md, gap: 14, paddingBottom: 28 },
  starter: { gap: 10, paddingVertical: 24 },
  starterTitle: { color: colors.text, fontFamily: fonts.serif, fontSize: 24, marginBottom: 8 },
  prompt: { padding: 14, borderRadius: radius.md, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line },
  promptText: { color: colors.text, fontFamily: fonts.sansMedium, fontSize: 15 },
  saathi: { backgroundColor: colors.card, borderRadius: radius.lg, padding: 14, borderLeftWidth: 3, borderLeftColor: colors.teal, gap: 8 },
  mine: { alignSelf: 'flex-end', maxWidth: '86%', backgroundColor: colors.paper, borderRadius: radius.lg, padding: 12, gap: 6 },
  theirs: { alignSelf: 'flex-start', maxWidth: '86%', backgroundColor: colors.cardSoft, borderRadius: radius.lg, padding: 12, gap: 6 },
  who: { color: colors.textFaint, fontFamily: fonts.sansBold, fontSize: 11, letterSpacing: 0.4, textTransform: 'uppercase' },
  whoRight: { color: colors.ink, opacity: 0.55, fontFamily: fonts.sansBold, fontSize: 11, textAlign: 'right' },
  body: { color: colors.text, fontFamily: fonts.sans, fontSize: 16, lineHeight: 23 },
  mineText: { color: colors.ink, fontFamily: fonts.sans, fontSize: 16, lineHeight: 23 },
  caption: { color: colors.ink, fontFamily: fonts.sans, fontSize: 13 },
  meta: { color: colors.textFaint, fontFamily: fonts.sans, fontSize: 12 },
  image: { width: '100%', height: 220, borderRadius: 14, backgroundColor: colors.cardSoft },
  doc: { padding: 10, borderRadius: 12, backgroundColor: colors.cardSoft },
  docName: { color: colors.ink, fontFamily: fonts.sansBold },
  summary: { padding: 14, borderRadius: radius.lg, backgroundColor: colors.card, gap: 6 },
  working: { color: colors.teal, fontFamily: fonts.sansMedium, fontSize: 14 },
  link: { color: colors.teal, fontFamily: fonts.sansMedium, fontSize: 14, marginTop: 8 },
  composer: { paddingHorizontal: space.md, paddingTop: 8, paddingBottom: 10, borderTopWidth: 1, borderTopColor: colors.line, gap: 8 },
  tools: { flexDirection: 'row', gap: 8 },
  tool: { width: 40, height: 40, borderRadius: 12, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  input: { flex: 1, minHeight: 48, maxHeight: 120, borderRadius: radius.lg, backgroundColor: colors.card, color: colors.text, fontFamily: fonts.sans, fontSize: 16, paddingHorizontal: 14, paddingVertical: 12 },
  send: { width: 48, height: 48, borderRadius: 16, backgroundColor: colors.paper, alignItems: 'center', justifyContent: 'center' },
  mentions: { backgroundColor: colors.card, borderRadius: radius.md, overflow: 'hidden' },
  mention: { paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.line },
  mentionName: { color: colors.text, fontFamily: fonts.sansBold, fontSize: 14 },
  imageBox: { gap: 10, padding: 12, borderRadius: radius.md, backgroundColor: colors.card },
  imageInput: { minHeight: 64, color: colors.text, fontFamily: fonts.sans, fontSize: 15 },
})
