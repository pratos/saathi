import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PermissionsAndroid, Platform } from 'react-native'
import { useAction, useMutation, useQuery } from 'convex/react'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import {
  APPLICATION_ASSISTANT_TOOLS,
  conversationActionFromTool,
  type ApplicationAssistantToolName,
  type ConversationAction,
} from '../../../convex/lib/assistantCapabilities'
import { liveVoiceUsageSeconds } from '../../../convex/lib/liveVoiceUsage'
import { convexErrorCode } from '../errors'

export type VoiceStatus = 'idle' | 'requesting' | 'connecting' | 'live' | 'muted' | 'ending' | 'ended' | 'error'
export type VoiceTurn = { role: 'user' | 'assistant'; text: string; startMs: number }
export type VoiceToolActivity = {
  id: string
  name: ApplicationAssistantToolName
  title: string
  detail: string
  status: 'running' | 'complete' | 'error'
  result?: string
  imageUrl?: string
}

type VoiceFragment = VoiceTurn & { endMs: number; order: number }
type LiveToolCall =
  | { name: 'generate_image'; callId: string; prompt: string; kind?: string; style?: string; language?: string }
  | { name: Exclude<ApplicationAssistantToolName, 'generate_image'>; callId: string; arguments: Record<string, unknown> }
type VoiceToolResult = { ok: boolean; message: string; imageUrl?: string }

type WebRtcModule = typeof import('react-native-webrtc')

function loadWebRtc(): WebRtcModule | null {
  try {
    return require('react-native-webrtc') as WebRtcModule
  } catch {
    return null
  }
}

export function useLiveVoice(roomId: Id<'rooms'>) {
  const createSession = useAction(api.liveVoice.startSession)
  const finishSession = useAction(api.liveVoice.finishSession)
  const createVoiceImage = useAction(api.images.createFromVoice)
  const searchVoiceWeb = useAction(api.liveVoice.searchPublicWeb)
  const executeVoiceComputer = useAction(api.voiceBrowser.useComputer)
  const executeConversationAction = useMutation(api.conversationActions.execute)
  const logVoiceToolResult = useMutation(api.liveVoice.logToolResult)
  const [status, setStatus] = useState<VoiceStatus>('idle')
  const [error, setError] = useState('')
  const [fragments, setFragments] = useState<VoiceFragment[]>([])
  const [sessionId, setSessionId] = useState('')
  const [activities, setActivities] = useState<VoiceToolActivity[]>([])
  const [voiceSeconds, setVoiceSeconds] = useState(0)
  const [savingSummary, setSavingSummary] = useState(false)
  const peerRef = useRef<InstanceType<WebRtcModule['RTCPeerConnection']> | null>(null)
  const channelRef = useRef<{ readyState: string; send: (value: string) => void; close: () => void; onmessage: ((event: { data: string }) => void) | null } | null>(null)
  const microphoneRef = useRef<{ getTracks: () => Array<{ stop: () => void }>; getAudioTracks: () => Array<{ enabled: boolean }> } | null>(null)
  const remoteStreamRef = useRef<unknown>(null)
  const sessionIdRef = useRef('')
  const fragmentsRef = useRef<VoiceFragment[]>([])
  const persistedSessionRef = useRef('')
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const generationRef = useRef(0)
  const voiceSecondsRef = useRef(0)
  const usageFinalizedRef = useRef(false)
  const computerTool = useQuery(api.liveVoice.computerToolState, sessionId ? { roomId, sessionId } : 'skip')

  const cleanup = useCallback(() => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
    closeTimerRef.current = null
    microphoneRef.current?.getTracks().forEach(track => track.stop())
    microphoneRef.current = null
    remoteStreamRef.current = null
    channelRef.current?.close()
    channelRef.current = null
    peerRef.current?.close()
    peerRef.current = null
  }, [])

  const persistKnownTranscript = useCallback(async () => {
    const activeSessionId = sessionIdRef.current
    if (!activeSessionId || persistedSessionRef.current === activeSessionId) return
    persistedSessionRef.current = activeSessionId
    setSavingSummary(true)
    try {
      const usage = voiceSecondsRef.current > 0
        ? { voiceSeconds: voiceSecondsRef.current, voiceUsageFinalized: usageFinalizedRef.current }
        : {}
      await finishSession({
        roomId,
        sessionId: activeSessionId,
        turns: groupVoiceFragments(fragmentsRef.current),
        ...usage,
      })
    } catch {
      setError('The conversation ended, but its summary could not be saved.')
      setStatus('error')
    } finally {
      setSavingSummary(false)
    }
  }, [finishSession, roomId])

  useEffect(() => () => {
    generationRef.current += 1
    void persistKnownTranscript()
    cleanup()
  }, [cleanup, persistKnownTranscript])

  const start = useCallback(async () => {
    const webrtc = loadWebRtc()
    if (!webrtc) {
      setStatus('error')
      setError('Live voice needs a development build of Saath. Type to Saathi for now, or run expo run:android.')
      return
    }
    const generation = ++generationRef.current
    cleanup()
    sessionIdRef.current = ''
    setSessionId('')
    persistedSessionRef.current = ''
    fragmentsRef.current = []
    setFragments([])
    setActivities([])
    voiceSecondsRef.current = 0
    usageFinalizedRef.current = false
    setVoiceSeconds(0)
    setError('')
    setStatus('requesting')
    try {
      if (!await ensureMicrophonePermission()) {
        throw new Error('Microphone access was blocked.')
      }
      const { RTCPeerConnection, mediaDevices, MediaStream } = webrtc
      const peer = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] })
      peerRef.current = peer
      peer.ontrack = (event: { track?: unknown; streams?: unknown[] }) => {
        remoteStreamRef.current = event.streams?.[0] ?? (event.track ? new MediaStream([event.track as never]) : null)
      }
      const microphone = await mediaDevices.getUserMedia({ audio: true, video: false })
      if (generation !== generationRef.current) {
        microphone.getTracks().forEach(track => track.stop())
        return
      }
      const liveTracks = microphone.getAudioTracks().filter(track => track.readyState !== 'ended')
      if (!liveTracks.length) throw new Error('The emulator microphone is silent. Restart it without -no-audio.')
      microphoneRef.current = microphone
      liveTracks.forEach(track => {
        track.enabled = true
        peer.addTrack(track, microphone)
      })
      const channel = peer.createDataChannel('oai-events')
      channelRef.current = channel
      channel.onmessage = (event: { data: string }) => {
        const parsed = parseLiveEvent(event.data)
        if (!parsed) return
        const reportedSeconds = liveVoiceUsageSeconds(parsed.raw)
        if (reportedSeconds !== null) {
          voiceSecondsRef.current = reportedSeconds
          setVoiceSeconds(reportedSeconds)
        }
        if (parsed.type === 'session.started') setStatus('live')
        else if (parsed.type === 'session.input_transcript.delta' || parsed.type === 'session.output_transcript.delta') {
          const fragment: VoiceFragment = {
            role: parsed.type === 'session.input_transcript.delta' ? 'user' : 'assistant',
            text: parsed.delta,
            startMs: parsed.start_ms,
            endMs: parsed.end_ms,
            order: fragmentsRef.current.length,
          }
          fragmentsRef.current = [...fragmentsRef.current, fragment]
          setFragments(fragmentsRef.current)
        } else if (parsed.type === 'session.closed') {
          usageFinalizedRef.current = reportedSeconds !== null
          setStatus('ended')
          void persistKnownTranscript()
          cleanup()
        } else if (parsed.type === 'response.event') {
          const call = liveToolCall(parsed.raw)
          if (call) setActivities(current => addVoiceToolActivity(current, call))
          const startedAt = Date.now()
          const onToolFinished = (result: VoiceToolResult) => {
            if (!call) return
            setActivities(current => finishVoiceToolActivity(current, call.callId, result))
            const activeSessionId = sessionIdRef.current
            if (!activeSessionId) return
            void logVoiceToolResult({
              roomId,
              sessionId: activeSessionId,
              callId: call.callId,
              toolName: call.name,
              detail: voiceToolDetail(call),
              ok: result.ok,
              resultPreview: result.message,
              latencyMs: Date.now() - startedAt,
            }).catch(() => undefined)
          }
          if (call?.name === 'generate_image') {
            void fulfillTool(channel, async () => {
              const result = call.prompt
                ? await createVoiceImage({ roomId, prompt: call.prompt, kind: call.kind, style: call.style, language: call.language })
                : { ok: false, message: 'Describe the family-safe image you want.' }
              onToolFinished(result)
              return result
            }, call.callId, setError)
          } else if (call?.name === 'search_public_web') {
            void fulfillTool(channel, () => searchVoiceWeb({ roomId, query: stringArg(call.arguments, 'query') }), call.callId, setError, onToolFinished)
          } else if (call?.name === 'use_computer') {
            void fulfillTool(channel, () => executeVoiceComputer({
              roomId,
              sessionId: sessionIdRef.current,
              callId: call.callId,
              url: stringArg(call.arguments, 'url'),
              task: stringArg(call.arguments, 'task'),
            }), call.callId, setError, onToolFinished)
          } else if (call) {
            const action = conversationActionFromTool(call.name, call.arguments) as ConversationAction | null
            void fulfillTool(channel, async () => {
              if (!action) return { ok: false, message: 'I could not understand that settings change.' }
              return executeConversationAction({ roomId, action })
            }, call.callId, setError, onToolFinished)
          }
        } else if (parsed.type === 'error') {
          setError(parsed.message || 'Saathi encountered a voice error.')
        }
      }
      setStatus('connecting')
      const offer = await peer.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: false })
      await peer.setLocalDescription(offer)
      await waitForIce(peer)
      if (generation !== generationRef.current) return
      const sdp = peer.localDescription?.sdp
      if (!sdp) throw new Error('The phone could not create a voice connection.')
      const result = await createSession({ roomId, sdp })
      if (generation !== generationRef.current) return
      sessionIdRef.current = result.sessionId
      setSessionId(result.sessionId)
      await peer.setRemoteDescription({ type: 'answer', sdp: result.sdp })
    } catch (caught) {
      cleanup()
      setStatus('error')
      const code = convexErrorCode(caught)
      const message = caught instanceof Error ? caught.message : ''
      setError(code === 'LIVE_VOICE_NOT_CONFIGURED'
        ? 'Voice mode needs an OpenAI API key on this Convex deployment.'
        : code === 'RATE_LIMITED'
          ? 'You have started several voice conversations. Please wait before trying again.'
          : message.includes('Microphone') || message.includes('-no-audio')
            ? message
            : 'Voice mode could not start. On the emulator, restart without -no-audio and allow the microphone.')
    }
  }, [cleanup, createSession, createVoiceImage, executeConversationAction, executeVoiceComputer, logVoiceToolResult, persistKnownTranscript, roomId, searchVoiceWeb])

  const end = useCallback(() => {
    const channel = channelRef.current
    if (!channel || channel.readyState !== 'open') {
      void persistKnownTranscript()
      cleanup()
      setStatus('ended')
      return
    }
    setStatus('ending')
    channel.send(JSON.stringify({ type: 'session.close' }))
    closeTimerRef.current = setTimeout(() => {
      void persistKnownTranscript()
      cleanup()
      setStatus('ended')
    }, 15_000)
  }, [cleanup, persistKnownTranscript])

  const toggleMute = useCallback(() => {
    const nextMuted = status !== 'muted'
    microphoneRef.current?.getAudioTracks().forEach(track => { track.enabled = !nextMuted })
    const channel = channelRef.current
    if (channel?.readyState === 'open') {
      channel.send(JSON.stringify({ type: nextMuted ? 'session.input_audio.mute' : 'session.input_audio.unmute', event_id: crypto.randomUUID() }))
    }
    setStatus(nextMuted ? 'muted' : 'live')
  }, [status])

  return {
    status,
    error,
    turns: useMemo(() => groupVoiceFragments(fragments), [fragments]),
    activities,
    computerTool,
    voiceSeconds,
    summarizing: savingSummary || status === 'ending',
    start,
    end,
    toggleMute,
  }
}

async function ensureMicrophonePermission() {
  if (Platform.OS !== 'android') return true
  const granted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO, {
    title: 'Talk to Saathi',
    message: 'Saath needs the microphone so your voice can reach Saathi.',
    buttonPositive: 'Allow',
  })
  return granted === PermissionsAndroid.RESULTS.GRANTED
}

export function isVoiceCallOpen(status: VoiceStatus) {
  return status === 'requesting' || status === 'connecting' || status === 'live' || status === 'muted' || status === 'ending'
}

function groupVoiceFragments(fragments: VoiceFragment[]): VoiceTurn[] {
  const ordered = [...fragments].sort((left, right) => left.startMs - right.startMs || left.order - right.order)
  const turns: Array<VoiceTurn & { endMs: number }> = []
  for (const fragment of ordered) {
    if (!fragment.text) continue
    const previous = turns.at(-1)
    if (previous?.role === fragment.role && fragment.startMs - previous.endMs <= 1_200) {
      previous.text += fragment.text
      previous.endMs = Math.max(previous.endMs, fragment.endMs)
    } else {
      turns.push({ role: fragment.role, text: fragment.text, startMs: fragment.startMs, endMs: fragment.endMs })
    }
  }
  return turns.map(({ role, text, startMs }) => ({ role, text, startMs }))
}

async function waitForIce(peer: { iceGatheringState: string; onicegatheringstatechange: ((event: unknown) => void) | null }) {
  if (peer.iceGatheringState === 'complete') return
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      peer.onicegatheringstatechange = null
      reject(new Error('The voice connection timed out.'))
    }, 10_000)
    peer.onicegatheringstatechange = () => {
      if (peer.iceGatheringState !== 'complete') return
      clearTimeout(timeout)
      peer.onicegatheringstatechange = null
      resolve()
    }
  })
}

function parseLiveEvent(value: unknown) {
  try {
    const parsed = JSON.parse(String(value)) as Record<string, unknown>
    if (typeof parsed.type !== 'string') return null
    const error = parsed.error && typeof parsed.error === 'object' ? parsed.error as Record<string, unknown> : null
    return {
      type: parsed.type,
      delta: typeof parsed.delta === 'string' ? parsed.delta : '',
      start_ms: typeof parsed.start_ms === 'number' ? parsed.start_ms : 0,
      end_ms: typeof parsed.end_ms === 'number' ? parsed.end_ms : 0,
      message: typeof error?.message === 'string' ? error.message : '',
      raw: parsed,
    }
  } catch {
    return null
  }
}

function liveToolCall(event: Record<string, unknown>): LiveToolCall | null {
  const nested = event.event && typeof event.event === 'object' ? event.event as Record<string, unknown> : event
  if (nested.type !== 'response.output_item.done') return null
  const item = nested.item && typeof nested.item === 'object' ? nested.item as Record<string, unknown> : nested
  const name = typeof item.name === 'string' ? item.name : ''
  const callId = typeof item.call_id === 'string' ? item.call_id : typeof nested.call_id === 'string' ? nested.call_id : ''
  if (!callId) return null
  const args = parseToolArgs(item.arguments)
  if (name === 'generate_image') return { name, callId, prompt: stringArg(args, 'prompt'), kind: optionalStringArg(args, 'kind'), style: optionalStringArg(args, 'style'), language: optionalStringArg(args, 'language') }
  if (APPLICATION_ASSISTANT_TOOLS.some(tool => tool.name === name)) {
    return { name: name as Exclude<ApplicationAssistantToolName, 'generate_image'>, callId, arguments: args }
  }
  return null
}

function parseToolArgs(value: unknown) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  if (typeof value !== 'string') return {}
  try {
    return parseToolArgs(JSON.parse(value))
  } catch {
    return {}
  }
}

function stringArg(args: Record<string, unknown>, key: string) {
  return typeof args[key] === 'string' ? args[key] : ''
}

function optionalStringArg(args: Record<string, unknown>, key: string) {
  return typeof args[key] === 'string' ? args[key] : undefined
}

function addVoiceToolActivity(current: VoiceToolActivity[], call: LiveToolCall): VoiceToolActivity[] {
  const tool = APPLICATION_ASSISTANT_TOOLS.find(candidate => candidate.name === call.name)
  const next: VoiceToolActivity = {
    id: call.callId,
    name: call.name,
    title: tool?.label ?? 'Saathi action',
    detail: voiceToolDetail(call),
    status: 'running',
  }
  return [...current.filter(item => item.id !== call.callId), next].slice(-6)
}

function voiceToolDetail(call: LiveToolCall) {
  if (call.name === 'generate_image') return call.prompt
  if (call.name === 'search_public_web') return stringArg(call.arguments, 'query')
  if (call.name === 'use_computer') return stringArg(call.arguments, 'task')
  return ''
}

function finishVoiceToolActivity(current: VoiceToolActivity[], callId: string, result: VoiceToolResult): VoiceToolActivity[] {
  return current.map(activity => activity.id === callId
    ? { ...activity, status: result.ok ? 'complete' as const : 'error' as const, result: result.message, imageUrl: result.imageUrl }
    : activity)
}

async function fulfillTool(
  channel: { readyState: string; send: (value: string) => void },
  execute: () => Promise<{ ok: boolean; message: string }>,
  callId: string,
  setError: (message: string) => void,
  onFinished?: (result: VoiceToolResult) => void,
) {
  let result: VoiceToolResult
  try {
    result = await execute()
  } catch {
    result = { ok: false, message: 'That action could not be completed.' }
  }
  onFinished?.(result)
  if (!result.ok) setError(result.message)
  if (channel.readyState !== 'open') return
  channel.send(JSON.stringify({
    type: 'response.item.create',
    event_id: crypto.randomUUID(),
    item: { type: 'function_call_output', call_id: callId, output: JSON.stringify({ ok: result.ok, message: result.message }) },
  }))
  channel.send(JSON.stringify({ type: 'response.create', event_id: crypto.randomUUID() }))
}
