import { type ReactNode } from 'react'
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import * as Haptics from 'expo-haptics'
import { colors, fonts, radius, space, type } from '../theme'

export function Screen({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.screen, style]}>{children}</View>
}

export function BrandMark({ size = 44 }: { size?: number }) {
  return (
    <View style={[styles.mark, { width: size, height: size, borderRadius: size * 0.28 }]}>
      <Text style={[styles.markGlyph, { fontSize: size * 0.48 }]}>स</Text>
    </View>
  )
}

export function Display({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text style={[styles.display, style]}>{children}</Text>
}

export function Heading({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text style={[styles.heading, style]}>{children}</Text>
}

export function Body({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text style={[styles.body, style]}>{children}</Text>
}

export function Muted({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text style={[styles.muted, style]}>{children}</Text>
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <Text style={styles.eyebrow}>{children}</Text>
}

export function PrimaryButton({
  label,
  onPress,
  disabled,
  loading,
}: {
  label: string
  onPress: () => void
  disabled?: boolean
  loading?: boolean
}) {
  return (
    <Pressable
      onPress={() => {
        if (disabled || loading) return
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
        onPress()
      }}
      disabled={disabled || loading}
      style={({ pressed }) => [styles.primary, (disabled || loading) && styles.disabled, pressed && styles.pressed]}
    >
      {loading ? <ActivityIndicator color={colors.ink} /> : <Text style={styles.primaryLabel}>{label}</Text>}
    </Pressable>
  )
}

export function SecondaryButton({
  label,
  onPress,
  disabled,
}: {
  label: string
  onPress: () => void
  disabled?: boolean
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [styles.secondary, disabled && styles.disabled, pressed && styles.pressed]}
    >
      <Text style={styles.secondaryLabel}>{label}</Text>
    </Pressable>
  )
}

export function GhostButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} hitSlop={12} style={({ pressed }) => [pressed && styles.pressed]}>
      <Text style={styles.ghost}>{label}</Text>
    </Pressable>
  )
}

export function Field({
  label,
  value,
  onChangeText,
  ...props
}: TextInputProps & { label: string }) {
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholderTextColor={colors.textFaint}
        style={styles.input}
        {...props}
      />
    </View>
  )
}

export function Chip({
  label,
  selected,
  onPress,
}: {
  label: string
  selected?: boolean
  onPress?: () => void
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={[styles.chip, selected && styles.chipSelected]}
    >
      <Text style={[styles.chipLabel, selected && styles.chipLabelSelected]}>{label}</Text>
    </Pressable>
  )
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string
  body: string
  action?: ReactNode
}) {
  return (
    <View style={styles.empty}>
      <Heading style={{ textAlign: 'center' }}>{title}</Heading>
      <Muted style={{ textAlign: 'center', marginTop: 8 }}>{body}</Muted>
      {action ? <View style={{ marginTop: 18 }}>{action}</View> : null}
    </View>
  )
}

export function StatusScreen({ message }: { message: string }) {
  return (
    <LinearGradient colors={[colors.bg, '#18241F']} style={styles.status}>
      <BrandMark size={56} />
      <ActivityIndicator color={colors.teal} style={{ marginTop: 28 }} />
      <Muted style={{ marginTop: 16 }}>{message}</Muted>
    </LinearGradient>
  )
}

export function ErrorText({ children }: { children: ReactNode }) {
  if (!children) return null
  return <Text style={styles.error}>{children}</Text>
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return <Text style={styles.section}>{children}</Text>
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  mark: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.coral,
  },
  markGlyph: {
    color: colors.paper,
    fontFamily: fonts.sansBold,
  },
  display: {
    color: colors.text,
    fontFamily: fonts.serif,
    fontSize: type.display,
    lineHeight: 40,
  },
  heading: {
    color: colors.text,
    fontFamily: fonts.serif,
    fontSize: type.title,
    lineHeight: 30,
  },
  body: {
    color: colors.text,
    fontFamily: fonts.sans,
    fontSize: type.body,
    lineHeight: 24,
  },
  muted: {
    color: colors.textMuted,
    fontFamily: fonts.sans,
    fontSize: type.body,
    lineHeight: 23,
  },
  eyebrow: {
    color: colors.amber,
    fontFamily: fonts.sansBold,
    fontSize: type.micro,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
  },
  primary: {
    minHeight: 54,
    borderRadius: radius.lg,
    backgroundColor: colors.paper,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.lg,
  },
  primaryLabel: {
    color: colors.ink,
    fontFamily: fonts.sansBold,
    fontSize: 16,
  },
  secondary: {
    minHeight: 54,
    borderRadius: radius.lg,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.lg,
  },
  secondaryLabel: {
    color: colors.text,
    fontFamily: fonts.sansBold,
    fontSize: 16,
  },
  ghost: {
    color: colors.teal,
    fontFamily: fonts.sansMedium,
    fontSize: 15,
  },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.82 },
  fieldWrap: { gap: 8 },
  fieldLabel: {
    color: colors.textMuted,
    fontFamily: fonts.sansMedium,
    fontSize: type.caption,
  },
  input: {
    minHeight: 54,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
    color: colors.text,
    fontFamily: fonts.sans,
    fontSize: 17,
    paddingHorizontal: 16,
  },
  chip: {
    minHeight: 40,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipSelected: {
    backgroundColor: colors.tealSoft,
    borderColor: colors.teal,
  },
  chipLabel: {
    color: colors.textMuted,
    fontFamily: fonts.sansMedium,
    fontSize: 13,
  },
  chipLabelSelected: {
    color: colors.teal,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    padding: space.md,
  },
  empty: {
    paddingHorizontal: 28,
    paddingVertical: 48,
    alignItems: 'center',
  },
  status: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
  },
  error: {
    color: colors.coral,
    fontFamily: fonts.sans,
    fontSize: 14,
    lineHeight: 20,
  },
  section: {
    color: colors.textFaint,
    fontFamily: fonts.sansBold,
    fontSize: type.micro,
    letterSpacing: 1.3,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
})
