import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useQuery } from 'convex/react'
import { Image } from 'expo-image'
import { SafeAreaView } from 'react-native-safe-area-context'
import * as Linking from 'expo-linking'
import { FileText } from 'lucide-react-native'
import { api } from '../../../../convex/_generated/api'
import { Display, EmptyState, Muted } from '../../../src/components/ui'
import { FamilySwitcher } from '../../../src/components/FamilySwitcher'
import { useFamily } from '../../../src/family'
import { formatFileSize, formatRelativeTime } from '../../../src/format'
import { colors, fonts, radius, space } from '../../../src/theme'

export default function Files() {
  const router = useRouter()
  const { family } = useFamily()
  const files = useQuery(api.attachments.forSpace, { spaceId: family.space._id, limit: 60 })

  return (
    <SafeAreaView style={styles.page} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <FamilySwitcher />
        <Display style={{ marginTop: 18 }}>Files</Display>
        <Muted style={{ marginTop: 6 }}>Photos and documents shared in this family, stored in Convex.</Muted>
        {files === undefined ? <Muted style={{ marginTop: 24 }}>Loading files…</Muted> : null}
        {files?.length === 0 ? (
          <EmptyState title="No files yet" body="Photos and documents you share in chats appear here." />
        ) : files?.map(file => (
          <View key={file._id} style={styles.row}>
            {file.mediaType.startsWith('image/') && file.url ? (
              <Pressable onPress={() => file.url && void Linking.openURL(file.url)}>
                <Image source={{ uri: file.url }} style={styles.thumb} contentFit="cover" />
              </Pressable>
            ) : (
              <Pressable style={styles.doc} onPress={() => file.url && void Linking.openURL(file.url)}>
                <FileText color={colors.amber} size={22} />
              </Pressable>
            )}
            <View style={{ flex: 1 }}>
              <Text style={styles.name} numberOfLines={1}>{file.fileName}</Text>
              <Text style={styles.meta}>{file.roomTitle} · {formatFileSize(file.sizeBytes)} · {formatRelativeTime(file.createdAt)}</Text>
              <Pressable onPress={() => router.push(`/(app)/room/${file.roomId}`)}>
                <Text style={styles.link}>Open conversation</Text>
              </Pressable>
            </View>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: space.lg, paddingTop: 12, paddingBottom: 40 },
  row: {
    flexDirection: 'row',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  thumb: { width: 64, height: 64, borderRadius: radius.sm, backgroundColor: colors.card },
  doc: {
    width: 64,
    height: 64,
    borderRadius: radius.sm,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: { color: colors.text, fontFamily: fonts.sansBold, fontSize: 15 },
  meta: { color: colors.textFaint, fontFamily: fonts.sans, fontSize: 12, marginTop: 4 },
  link: { color: colors.teal, fontFamily: fonts.sansMedium, fontSize: 13, marginTop: 8 },
})
