import { useMemo } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useMutation, useQuery } from 'convex/react'
import { SafeAreaView } from 'react-native-safe-area-context'
import { ArrowLeft } from 'lucide-react-native'
import { api } from '../../../../convex/_generated/api'
import type { Id } from '../../../../convex/_generated/dataModel'
import { Body, Display, Muted, PrimaryButton, SecondaryButton } from '../../../src/components/ui'
import { useFamily } from '../../../src/family'
import { categoryLabel, displaySender, formatRelativeTime, readableEmailBody } from '../../../src/format'
import { colors, fonts, space } from '../../../src/theme'

export default function InboxItem() {
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: Id<'inboxItems'> }>()
  const { family } = useFamily()
  const items = useQuery(api.inbox.list, { spaceId: family.space._id, limit: 80 })
  const confirmAction = useMutation(api.inbox.confirmAction)
  const dismissAction = useMutation(api.inbox.dismissAction)
  const reprocess = useMutation(api.inbox.reprocess)
  const item = useMemo(() => items?.find(row => row._id === id), [id, items])
  const body = item ? readableEmailBody(item.originalText) : ''

  return (
    <SafeAreaView style={styles.page} edges={['top']}>
      <Pressable onPress={() => router.back()} style={styles.back} hitSlop={12}>
        <ArrowLeft color={colors.text} size={22} />
        <Text style={styles.backLabel}>Inbox</Text>
      </Pressable>
      {!item ? <Muted style={{ padding: 24 }}>Loading this mail…</Muted> : (
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.kicker}>{categoryLabel(item.category)} · {formatRelativeTime(item.receivedAt)}</Text>
          <Display style={{ marginTop: 8 }}>{item.subject}</Display>
          <Muted style={{ marginTop: 8 }}>{displaySender(item.sender)}</Muted>
          {item.extractedMerchant ? <Body style={{ marginTop: 18 }}>Merchant: {item.extractedMerchant}</Body> : null}
          {item.extractedAmountInr ? <Text style={styles.amount}>₹{item.extractedAmountInr}</Text> : null}
          {item.extractedAmountUsd ? <Text style={styles.amount}>${item.extractedAmountUsd}</Text> : null}
          {!item.extractedAmountInr && !item.extractedAmountUsd && item.extractedAmount ? <Text style={styles.amount}>{item.extractedAmount}</Text> : null}
          {item.extractedPeriod ? <Muted>Period: {item.extractedPeriod}</Muted> : null}
          {item.extractedDueAt ? (
            <Text style={styles.due}>Due {new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(item.extractedDueAt)}</Text>
          ) : null}
          {item.status === 'processing' ? <Muted style={{ marginTop: 12 }}>Analyzing the email and its attachments…</Muted> : null}
          {item.processingNotes ? <Muted style={{ marginTop: 12 }}>{item.processingNotes}</Muted> : null}
          {(item.suggestedActions ?? []).map(action => (
            <View key={`${item._id}-${action.kind}`} style={styles.suggestion}>
              <Text style={styles.suggestionTitle}>{action.label}</Text>
              {action.detail ? <Muted>{action.detail}</Muted> : null}
            </View>
          ))}
          {body.length > 24 ? <Body style={{ marginTop: 22 }}>{body}</Body> : null}
          {item.actionStatus === 'suggested' ? (
            <View style={{ gap: 10, marginTop: 24 }}>
              <PrimaryButton label="Confirm action" onPress={() => void confirmAction({ inboxItemId: item._id })} />
              <SecondaryButton label="Not now" onPress={() => void dismissAction({ inboxItemId: item._id })} />
            </View>
          ) : null}
          {item.actionStatus === 'confirmed' ? <Muted style={{ marginTop: 18 }}>Action confirmed for the family.</Muted> : null}
          {(item.status === 'failed' || item.documentParseStatus === 'failed') ? (
            <View style={{ marginTop: 18 }}>
              <SecondaryButton label="Retry PDF reading" onPress={() => void reprocess({ inboxItemId: item._id })} />
            </View>
          ) : null}
        </ScrollView>
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.bg },
  back: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: space.lg, paddingVertical: 12 },
  backLabel: { color: colors.text, fontFamily: fonts.sansMedium, fontSize: 16 },
  content: { paddingHorizontal: space.lg, paddingBottom: 40 },
  kicker: { color: colors.amber, fontFamily: fonts.sansBold, fontSize: 11, letterSpacing: 1, textTransform: 'uppercase' },
  amount: { color: colors.paper, fontFamily: fonts.serif, fontSize: 32, marginTop: 18 },
  due: { color: colors.coral, fontFamily: fonts.sansMedium, fontSize: 15, marginTop: 6 },
  suggestion: { marginTop: 16, padding: 14, borderRadius: 16, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line },
  suggestionTitle: { color: colors.text, fontFamily: fonts.sansBold, fontSize: 15 },
})
