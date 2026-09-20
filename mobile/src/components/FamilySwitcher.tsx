import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useFamily } from '../family'
import { colors, fonts, radius } from '../theme'
import { initialsFor } from '../format'

export function FamilySwitcher() {
  const { families, family, selectFamily } = useFamily()
  if (families.length < 2) {
    return (
      <View style={styles.single}>
        <View style={styles.avatar}><Text style={styles.avatarText}>{initialsFor(family.space.name)}</Text></View>
        <Text style={styles.name} numberOfLines={1}>{family.space.name}</Text>
      </View>
    )
  }
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
      {families.map(row => {
        const selected = row.space._id === family.space._id
        return (
          <Pressable
            key={row.space._id}
            onPress={() => selectFamily(row.space._id)}
            style={[styles.pill, selected && styles.pillSelected]}
          >
            <Text style={[styles.pillText, selected && styles.pillTextSelected]} numberOfLines={1}>
              {row.space.name}
            </Text>
          </Pressable>
        )
      })}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  row: { gap: 8, paddingRight: 12 },
  single: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: {
    width: 28,
    height: 28,
    borderRadius: 9,
    backgroundColor: colors.amberSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: colors.amber, fontFamily: fonts.sansBold, fontSize: 11 },
  name: { color: colors.text, fontFamily: fonts.sansBold, fontSize: 15, flex: 1 },
  pill: {
    maxWidth: 180,
    minHeight: 36,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    justifyContent: 'center',
  },
  pillSelected: { backgroundColor: colors.tealSoft, borderColor: colors.teal },
  pillText: { color: colors.textMuted, fontFamily: fonts.sansMedium, fontSize: 13 },
  pillTextSelected: { color: colors.teal },
})
