import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { WebView } from 'react-native-webview'
import { Mic, MicOff, PhoneOff } from 'lucide-react-native'
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated'
import { useEffect } from 'react'
import { colors, fonts, radius } from '../theme'
import { formatVoiceCost, formatVoiceDuration } from '../format'
import type { VoiceStatus, VoiceToolActivity, VoiceTurn } from '../hooks/useLiveVoice'

export function VoiceCall({
  status,
  turns,
  activities,
  computerTool,
  voiceSeconds,
  onMute,
  onEnd,
}: {
  status: VoiceStatus
  turns: VoiceTurn[]
  activities: VoiceToolActivity[]
  computerTool?: {
    liveViewUrl?: string
    interactiveLiveViewUrl?: string
    task?: string
  } | null
  voiceSeconds: number
  onMute: () => void
  onEnd: () => void
}) {
  const statusText = status === 'requesting'
    ? 'Waiting for the microphone…'
    : status === 'connecting'
      ? 'Connecting securely…'
      : status === 'ending'
        ? 'Finishing your call…'
        : status === 'muted'
          ? 'Microphone muted'
          : turns.at(-1)?.role === 'assistant' ? 'Saathi is speaking' : 'Listening'
  const liveView = computerTool?.interactiveLiveViewUrl || computerTool?.liveViewUrl

  return (
    <View style={styles.sheet}>
      <View style={styles.header}>
        <View>
          <Text style={styles.kicker}>Live voice</Text>
          <Text style={styles.title}>Talking with Saathi</Text>
        </View>
        <View>
          <Text style={styles.status}>{statusText}</Text>
          <Text style={styles.meta}>{formatVoiceDuration(voiceSeconds)} · est. {formatVoiceCost(voiceSeconds / 60 * 0.05)}</Text>
        </View>
      </View>
      <Orb muted={status === 'muted'} live={status === 'live'} />
      <ScrollView style={styles.transcript} contentContainerStyle={{ paddingBottom: 16, gap: 12 }}>
        {turns.length === 0
          ? <Text style={styles.placeholder}>Start speaking. Your words will appear here.</Text>
          : turns.map((turn, index) => (
            <View key={`${turn.role}-${turn.startMs}-${index}`} style={styles.turn}>
              <Text style={styles.turnWho}>{turn.role === 'user' ? 'You' : 'Saathi'}</Text>
              <Text style={styles.turnText}>{turn.text}</Text>
            </View>
          ))}
        {activities.map(activity => (
          <View key={activity.id} style={styles.activity}>
            <Text style={styles.turnWho}>{activity.title}</Text>
            <Text style={styles.turnText}>{activity.result || activity.detail}</Text>
          </View>
        ))}
        {liveView ? <WebView source={{ uri: liveView }} style={styles.browser} /> : null}
      </ScrollView>
      <View style={styles.controls}>
        <Pressable onPress={onMute} style={[styles.control, status === 'muted' && styles.muted]} disabled={!['live', 'muted'].includes(status)}>
          {status === 'muted' ? <MicOff color={colors.paper} size={22} /> : <Mic color={colors.paper} size={22} />}
          <Text style={styles.controlLabel}>{status === 'muted' ? 'Unmute' : 'Mute'}</Text>
        </Pressable>
        <Pressable onPress={onEnd} style={[styles.control, styles.end]} disabled={status === 'ending'}>
          <PhoneOff color={colors.paper} size={22} />
          <Text style={styles.controlLabel}>{status === 'ending' ? 'Ending…' : 'End call'}</Text>
        </Pressable>
      </View>
    </View>
  )
}

function Orb({ muted, live }: { muted: boolean; live: boolean }) {
  const scale = useSharedValue(1)
  useEffect(() => {
    scale.value = withRepeat(withTiming(live && !muted ? 1.12 : 1, { duration: 900, easing: Easing.inOut(Easing.ease) }), -1, true)
  }, [live, muted, scale])
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }))
  return (
    <View style={styles.orbStage}>
      <Animated.View style={[styles.orb, muted && styles.orbMuted, style]} />
    </View>
  )
}

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: colors.bg,
    paddingTop: 18,
    paddingHorizontal: 20,
    zIndex: 40,
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, marginBottom: 18 },
  kicker: { color: colors.amber, fontFamily: fonts.sansBold, fontSize: 11, letterSpacing: 1.3, textTransform: 'uppercase' },
  title: { color: colors.text, fontFamily: fonts.serif, fontSize: 24, marginTop: 4 },
  status: { color: colors.teal, fontFamily: fonts.sansMedium, fontSize: 13, textAlign: 'right' },
  meta: { color: colors.textFaint, fontFamily: fonts.sans, fontSize: 12, textAlign: 'right', marginTop: 4 },
  orbStage: { alignItems: 'center', marginVertical: 12 },
  orb: { width: 88, height: 88, borderRadius: 44, backgroundColor: colors.teal },
  orbMuted: { backgroundColor: colors.textFaint },
  transcript: { flex: 1 },
  placeholder: { color: colors.textMuted, fontFamily: fonts.sans, fontSize: 15, textAlign: 'center', marginTop: 24 },
  turn: { gap: 4 },
  turnWho: { color: colors.textFaint, fontFamily: fonts.sansBold, fontSize: 11, letterSpacing: 0.6, textTransform: 'uppercase' },
  turnText: { color: colors.text, fontFamily: fonts.sans, fontSize: 16, lineHeight: 23 },
  activity: { padding: 12, borderRadius: radius.md, backgroundColor: colors.card },
  browser: { height: 220, borderRadius: radius.md, overflow: 'hidden', marginTop: 8 },
  controls: { flexDirection: 'row', gap: 12, paddingVertical: 18 },
  control: {
    flex: 1,
    minHeight: 56,
    borderRadius: radius.lg,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  muted: { backgroundColor: colors.tealDim },
  end: { backgroundColor: colors.coral },
  controlLabel: { color: colors.paper, fontFamily: fonts.sansMedium, fontSize: 13 },
})
