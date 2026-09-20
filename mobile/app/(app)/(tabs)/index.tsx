import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useQuery } from 'convex/react'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Bot, ChevronRight } from 'lucide-react-native'
import { api } from '../../../../convex/_generated/api'
import { FamilySwitcher } from '../../../src/components/FamilySwitcher'
import { Body, Display, EmptyState, Muted, SectionLabel } from '../../../src/components/ui'
import { useFamily } from '../../../src/family'
import { greetingForNow } from '../../../src/format'
import { colors, fonts, radius, space } from '../../../src/theme'

export default function Home() {
  const router = useRouter()
  const { family, user } = useFamily()
  const rooms = useQuery(api.rooms.list, { spaceId: family.space._id })
  const personal = rooms?.find(row => row.room?.type === 'private')?.room
  const shared = (rooms ?? []).flatMap(row => row.room && row.room.type !== 'private' ? [row.room] : [])
  const name = user.displayName || (user.username ? `@${user.username}` : 'there')

  return (
    <SafeAreaView style={styles.page} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <FamilySwitcher />
        <Muted style={{ marginTop: 22 }}>{greetingForNow()}</Muted>
        <Display style={{ marginTop: 4 }}>{name}</Display>
        <Body style={{ marginTop: 8, color: colors.textMuted }}>
          Your household, in one calm place.
        </Body>

        {personal ? (
          <Pressable onPress={() => router.push(`/(app)/room/${personal._id}`)} style={styles.saathiCard}>
            <View style={styles.saathiIcon}><Bot color={colors.paper} size={22} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.saathiTitle}>My Saathi</Text>
              <Text style={styles.saathiCopy}>Private · only you and Saathi</Text>
            </View>
            <ChevronRight color={colors.teal} size={20} />
          </Pressable>
        ) : (
          <Muted style={{ marginTop: 28 }}>Preparing your private chat…</Muted>
        )}

        <View style={{ marginTop: 32 }}>
          <SectionLabel>Family rooms</SectionLabel>
          {rooms !== undefined && shared.length === 0 ? (
            <EmptyState title="No shared chats yet" body="Your shared family conversation will appear here." />
          ) : shared.map(room => (
            <Pressable key={room._id} onPress={() => router.push(`/(app)/room/${room._id}`)} style={styles.roomRow}>
              <View style={styles.roomDot} />
              <View style={{ flex: 1 }}>
                <Text style={styles.roomTitle}>{room.title}</Text>
                <Text style={styles.roomMeta}>{family.space.name}</Text>
              </View>
              <ChevronRight color={colors.textFaint} size={18} />
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: space.lg, paddingTop: 12, paddingBottom: 40 },
  saathiCard: {
    marginTop: 28,
    minHeight: 92,
    borderRadius: radius.xl,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: 'rgba(77, 182, 160, 0.28)',
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  saathiIcon: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: colors.tealDim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saathiTitle: { color: colors.text, fontFamily: fonts.serif, fontSize: 22 },
  saathiCopy: { color: colors.textMuted, fontFamily: fonts.sans, fontSize: 13, marginTop: 4 },
  roomRow: {
    minHeight: 72,
    borderRadius: radius.lg,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: 14,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  roomDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.amber },
  roomTitle: { color: colors.text, fontFamily: fonts.sansBold, fontSize: 16 },
  roomMeta: { color: colors.textFaint, fontFamily: fonts.sans, fontSize: 12, marginTop: 3 },
})
