import { useMemo, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useQuery } from 'convex/react'
import { SafeAreaView } from 'react-native-safe-area-context'
import { api } from '../../../../convex/_generated/api'
import { Chip, Display, EmptyState, Muted, SectionLabel } from '../../../src/components/ui'
import { FamilySwitcher } from '../../../src/components/FamilySwitcher'
import { useFamily } from '../../../src/family'
import { categoryLabel, displaySender, formatRelativeTime } from '../../../src/format'
import { colors, fonts, radius, space } from '../../../src/theme'

const FILTERS = ['all', 'bills', 'school', 'travel', 'subscriptions', 'home', 'receipts', 'bank', 'needs_review'] as const

export default function Inbox() {
  const router = useRouter()
  const { family } = useFamily()
  const items = useQuery(api.inbox.list, { spaceId: family.space._id, limit: 40 })
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('all')
  const visible = useMemo(
    () => (items ?? []).filter(item => filter === 'all' || item.category === filter),
    [filter, items],
  )

  return (
    <SafeAreaView style={styles.page} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <FamilySwitcher />
        <Display style={{ marginTop: 18 }}>Family inbox</Display>
        <Muted style={{ marginTop: 6 }}>Shared household mail only. Money mail stays in My Saathi until someone shares it.</Muted>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
          {FILTERS.map(value => (
            <Chip
              key={value}
              label={value === 'all' ? 'All' : categoryLabel(value)}
              selected={filter === value}
              onPress={() => setFilter(value)}
            />
          ))}
        </ScrollView>
        {items === undefined ? <Muted style={{ marginTop: 24 }}>Loading mail…</Muted> : null}
        {items?.length === 0 ? (
          <EmptyState title="No shared family mail yet" body="Forward a bill or school note to the family address, or share from My Saathi." />
        ) : visible.map(item => {
          const amount = item.extractedAmountInr || item.extractedAmountUsd || item.extractedAmount
          return (
            <Pressable key={item._id} onPress={() => router.push(`/(app)/inbox/${item._id}`)} style={styles.card}>
              <View style={[styles.bar, { backgroundColor: item.category === 'bills' ? colors.coral : item.category === 'needs_review' ? colors.amber : colors.teal }]} />
              <View style={{ flex: 1, padding: 14 }}>
                <View style={styles.metaRow}>
                  <Text style={styles.category}>{categoryLabel(item.category)}</Text>
                  <Text style={styles.time}>{formatRelativeTime(item.receivedAt)}</Text>
                </View>
                <Text style={styles.subject} numberOfLines={2}>{item.subject}</Text>
                <Text style={styles.sender} numberOfLines={1}>{displaySender(item.sender)}</Text>
                {amount ? <Text style={styles.amount}>{item.extractedAmountInr ? `₹${item.extractedAmountInr}` : amount}</Text> : null}
                {item.extractedDueAt ? (
                  <Text style={styles.due}>Due {new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(item.extractedDueAt)}</Text>
                ) : null}
                {item.actionStatus === 'suggested' ? <Text style={styles.action}>Needs a family decision</Text> : null}
              </View>
            </Pressable>
          )
        })}
        {items && items.length > 0 && visible.length === 0 ? (
          <EmptyState title="Nothing in this view" body="Try another category." />
        ) : null}
        <SectionLabel> </SectionLabel>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: space.lg, paddingTop: 12, paddingBottom: 40 },
  filters: { gap: 8, paddingVertical: 18 },
  card: {
    flexDirection: 'row',
    borderRadius: radius.lg,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    overflow: 'hidden',
    marginBottom: 12,
  },
  bar: { width: 5 },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  category: { color: colors.amber, fontFamily: fonts.sansBold, fontSize: 11, letterSpacing: 0.8, textTransform: 'uppercase' },
  time: { color: colors.textFaint, fontFamily: fonts.sans, fontSize: 12 },
  subject: { color: colors.text, fontFamily: fonts.serif, fontSize: 20, marginTop: 8, lineHeight: 26 },
  sender: { color: colors.textMuted, fontFamily: fonts.sans, fontSize: 13, marginTop: 6 },
  amount: { color: colors.paper, fontFamily: fonts.sansBold, fontSize: 18, marginTop: 10 },
  due: { color: colors.coral, fontFamily: fonts.sansMedium, fontSize: 13, marginTop: 4 },
  action: { color: colors.teal, fontFamily: fonts.sansMedium, fontSize: 13, marginTop: 10 },
})
