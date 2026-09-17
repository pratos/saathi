import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAction, useMutation } from 'convex/react'
import { api } from '../convex/_generated/api'
import type { Id } from '../convex/_generated/dataModel'
import { isImageStyle, type ImageStyle } from '../convex/lib/imageSafety'

export type VoiceStatus = 'idle' | 'requesting' | 'connecting' | 'live' | 'muted' | 'ending' | 'ended' | 'error'
type VoiceFragment = { role: 'user' | 'assistant'; text: string; startMs: number; endMs: number; order: number }
export type VoiceTurn = { role: 'user' | 'assistant'; text: string; startMs: number }
type VoiceConversationAction =
  | { type: 'set_language'; language: 'en' | 'hi' | 'mr' }
  | { type: 'set_image_style'; style: ImageStyle }
  | { type: 'set_food_budget'; amount: number; currency: 'INR' | 'USD' }
  | { type: 'set_model_tier'; tier: 'low' | 'med' | 'high' | 'ultra' }

export function useLiveVoice(roomId: Id<'rooms'>) {
  const createSession = useAction(api.liveVoice.startSession)
  const finishSession = useAction(api.liveVoice.finishSession)
  const createVoiceImage = useAction(api.images.createFromVoice)
  const executeConversationAction = useMutation(api.conversationActions.execute)
  const [status, setStatus] = useState<VoiceStatus>('idle')
  const [error, setError] = useState('')
  const [fragments, setFragments] = useState<VoiceFragment[]>([])
  const [voiceLevel, setVoiceLevel] = useState(0)
  const [savingSummary, setSavingSummary] = useState(false)
  const peerRef = useRef<RTCPeerConnection | null>(null)
  const channelRef = useRef<RTCDataChannel | null>(null)
  const microphoneRef = useRef<MediaStream | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const sessionIdRef = useRef('')
  const fragmentsRef = useRef<VoiceFragment[]>([])
  const persistedSessionRef = useRef('')
  const closeTimerRef = useRef<number | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const animationFrameRef = useRef<number | null>(null)
  const generationRef = useRef(0)

  const cleanup = useCallback(() => {
    if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current)
    closeTimerRef.current = null
    microphoneRef.current?.getTracks().forEach(track => track.stop())
    microphoneRef.current = null
    channelRef.current?.close()
    channelRef.current = null
    peerRef.current?.close()
    peerRef.current = null
    if (audioRef.current) audioRef.current.srcObject = null
    audioRef.current = null
    if (animationFrameRef.current !== null) window.cancelAnimationFrame(animationFrameRef.current)
    animationFrameRef.current = null
    void audioContextRef.current?.close()
    audioContextRef.current = null
    analyserRef.current = null
    setVoiceLevel(0)
  }, [])

  const persistKnownTranscript = useCallback(async () => {
    const sessionId = sessionIdRef.current
    if (!sessionId || persistedSessionRef.current === sessionId) return
    persistedSessionRef.current = sessionId
    const turns = groupVoiceFragments(fragmentsRef.current)
    setSavingSummary(true)
    try {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          await finishSession({ roomId, sessionId, turns })
          break
        } catch (caught) {
          if (attempt === 1) throw caught
          await new Promise(resolve => window.setTimeout(resolve, 750))
        }
      }
      setFragments([])
      fragmentsRef.current = []
    } catch {
      persistedSessionRef.current = ''
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
    const generation = ++generationRef.current
    cleanup()
    sessionIdRef.current = ''
    persistedSessionRef.current = ''
    fragmentsRef.current = []
    setFragments([])
    setError('')
    setStatus('requesting')
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Microphone access is not available in this browser.')
      const peer = new RTCPeerConnection()
      peerRef.current = peer
      const audio = new Audio()
      audio.autoplay = true
      audioRef.current = audio
      peer.addEventListener('track', event => {
        const remoteStream = event.streams[0] ?? new MediaStream([event.track])
        audio.srcObject = remoteStream
        const analyser = analyserRef.current
        const audioContext = audioContextRef.current
        if (analyser && audioContext) audioContext.createMediaStreamSource(remoteStream).connect(analyser)
        void audio.play().catch(() => setError('Select the page to allow Saathi’s voice to play.'))
      })
      const microphone = await navigator.mediaDevices.getUserMedia({ audio: true })
      if (generation !== generationRef.current) return microphone.getTracks().forEach(track => track.stop())
      microphoneRef.current = microphone
      microphone.getAudioTracks().forEach(track => peer.addTrack(track, microphone))
      const audioContext = new AudioContext()
      const analyser = audioContext.createAnalyser()
      const silentOutput = audioContext.createGain()
      analyser.fftSize = 256
      analyser.smoothingTimeConstant = 0.72
      silentOutput.gain.value = 0
      analyser.connect(silentOutput).connect(audioContext.destination)
      audioContext.createMediaStreamSource(microphone).connect(analyser)
      audioContextRef.current = audioContext
      analyserRef.current = analyser
      const samples = new Uint8Array(analyser.fftSize)
      let lastLevelUpdate = 0
      const measureLevel = (now: number) => {
        analyser.getByteTimeDomainData(samples)
        let sum = 0
        for (const sample of samples) {
          const amplitude = (sample - 128) / 128
          sum += amplitude * amplitude
        }
        if (now - lastLevelUpdate > 50) {
          setVoiceLevel(Math.min(1, Math.sqrt(sum / samples.length) * 5.5))
          lastLevelUpdate = now
        }
        animationFrameRef.current = window.requestAnimationFrame(measureLevel)
      }
      animationFrameRef.current = window.requestAnimationFrame(measureLevel)

      const channel = peer.createDataChannel('oai-events')
      channelRef.current = channel
      channel.addEventListener('message', ({ data }) => {
        const event = parseLiveEvent(data)
        if (!event) return
        if (event.type === 'session.started') {
          setStatus('live')
        } else if (event.type === 'session.input_transcript.delta' || event.type === 'session.output_transcript.delta') {
          const fragment: VoiceFragment = {
            role: event.type === 'session.input_transcript.delta' ? 'user' : 'assistant',
            text: event.delta,
            startMs: event.start_ms,
            endMs: event.end_ms,
            order: fragmentsRef.current.length,
          }
          fragmentsRef.current = [...fragmentsRef.current, fragment]
          setFragments(fragmentsRef.current)
        } else if (event.type === 'session.closed') {
          setStatus('ended')
          void persistKnownTranscript()
          cleanup()
        } else if (event.type === 'response.event') {
          const call = liveToolCall(event.raw)
          if (call?.name === 'generate_image') {
            void fulfillVoiceImage(channel, roomId, call, createVoiceImage, setError)
          } else if (call) {
            void fulfillVoiceAction(channel, roomId, call, executeConversationAction, setError)
          }
        } else if (event.type === 'error') {
          setError(event.message || 'Saathi encountered a voice error.')
        }
      })
      channel.addEventListener('close', () => {
        if (status === 'ending' || status === 'ended') return
        void persistKnownTranscript()
      })

      setStatus('connecting')
      const offer = await peer.createOffer()
      await peer.setLocalDescription(offer)
      await waitForIce(peer)
      if (generation !== generationRef.current) return
      const sdp = peer.localDescription?.sdp
      if (!sdp) throw new Error('The browser could not create a voice connection.')
      const result = await createSession({ roomId, sdp })
      if (generation !== generationRef.current) return
      sessionIdRef.current = result.sessionId
      await peer.setRemoteDescription({ type: 'answer', sdp: result.sdp })
    } catch (caught) {
      cleanup()
      setStatus('error')
      const name = caught instanceof DOMException ? caught.name : ''
      const code = convexErrorCode(caught)
      setError(name === 'NotAllowedError'
        ? 'Microphone access was blocked. Allow it in your browser and try again.'
        : code === 'LIVE_VOICE_NOT_CONFIGURED'
          ? 'Voice mode needs an OpenAI API key on this Convex deployment.'
          : code === 'RATE_LIMITED'
            ? 'You have started several voice conversations. Please wait before trying again.'
            : 'Voice mode could not start. Please try again.')
    }
  }, [cleanup, createSession, createVoiceImage, executeConversationAction, persistKnownTranscript, roomId, status])

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
    closeTimerRef.current = window.setTimeout(() => {
      void persistKnownTranscript()
      cleanup()
      setStatus('ended')
      setError('The voice connection ended before final usage was confirmed.')
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
    voiceLevel,
    summarizing: savingSummary || status === 'ending',
    start,
    end,
    toggleMute,
  }
}

export function groupVoiceFragments(fragments: VoiceFragment[]): VoiceTurn[] {
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

async function waitForIce(peer: RTCPeerConnection) {
  if (peer.iceGatheringState === 'complete') return
  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      peer.removeEventListener('icegatheringstatechange', check)
      reject(new Error('The voice connection timed out.'))
    }, 10_000)
    function check() {
      if (peer.iceGatheringState !== 'complete') return
      window.clearTimeout(timeout)
      peer.removeEventListener('icegatheringstatechange', check)
      resolve()
    }
    peer.addEventListener('icegatheringstatechange', check)
    check()
  })
}

function parseLiveEvent(value: unknown): null | { type: string; delta: string; start_ms: number; end_ms: number; message: string; raw: Record<string, unknown> } {
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

type LiveToolCall = {
  name: 'generate_image'
  callId: string
  prompt: string
  kind?: string
  style?: string
  language?: string
} | {
  name: 'set_reading_language' | 'set_image_style' | 'set_food_budget' | 'set_model_tier'
  callId: string
  arguments: Record<string, unknown>
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
  if (name === 'set_reading_language' || name === 'set_image_style' || name === 'set_food_budget' || name === 'set_model_tier') {
    return { name, callId, arguments: args }
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

async function fulfillVoiceImage(
  channel: RTCDataChannel,
  roomId: Id<'rooms'>,
  call: { callId: string; prompt: string; kind?: string; style?: string; language?: string },
  createVoiceImage: (args: { roomId: Id<'rooms'>; prompt: string; kind?: string; style?: string; language?: string }) => Promise<{ ok: boolean; message: string }>,
  setError: (message: string) => void,
) {
  const result = call.prompt
    ? await createVoiceImage({ roomId, prompt: call.prompt, kind: call.kind, style: call.style, language: call.language })
    : { ok: false, message: 'Describe the family-safe image you want.' }
  if (!result.ok) setError(result.message)
  if (channel.readyState !== 'open') return
  channel.send(JSON.stringify({
    type: 'response.item.create',
    event_id: crypto.randomUUID(),
    item: { type: 'function_call_output', call_id: call.callId, output: JSON.stringify(result) },
  }))
  channel.send(JSON.stringify({ type: 'response.create', event_id: crypto.randomUUID() }))
}

async function fulfillVoiceAction(
  channel: RTCDataChannel,
  roomId: Id<'rooms'>,
  call: Exclude<LiveToolCall, { name: 'generate_image' }>,
  execute: (args: {
    roomId: Id<'rooms'>
    action: VoiceConversationAction
  }) => Promise<{ ok: boolean; message: string }>,
  setError: (message: string) => void,
) {
  const action = voiceConversationAction(call)
  let result = { ok: false, message: 'I could not understand that settings change.' }
  if (action) {
    try {
      result = await execute({ roomId, action })
    } catch {
      result = { ok: false, message: 'That setting could not be changed. Check your family permissions and try again.' }
    }
  }
  if (!result.ok) setError(result.message)
  if (channel.readyState !== 'open') return
  channel.send(JSON.stringify({
    type: 'response.item.create',
    event_id: crypto.randomUUID(),
    item: { type: 'function_call_output', call_id: call.callId, output: JSON.stringify(result) },
  }))
  channel.send(JSON.stringify({ type: 'response.create', event_id: crypto.randomUUID() }))
}

function voiceConversationAction(call: Exclude<LiveToolCall, { name: 'generate_image' }>): VoiceConversationAction | null {
  const args = call.arguments
  if (call.name === 'set_reading_language' && (args.language === 'en' || args.language === 'hi' || args.language === 'mr')) {
    return { type: 'set_language' as const, language: args.language }
  }
  if (call.name === 'set_image_style' && typeof args.style === 'string' && isImageStyle(args.style)) {
    return { type: 'set_image_style', style: args.style }
  }
  if (call.name === 'set_food_budget' && typeof args.amount === 'number' && (args.currency === 'INR' || args.currency === 'USD')) {
    return { type: 'set_food_budget' as const, amount: args.amount, currency: args.currency }
  }
  if (call.name === 'set_model_tier' && (args.tier === 'low' || args.tier === 'med' || args.tier === 'high' || args.tier === 'ultra')) {
    return { type: 'set_model_tier' as const, tier: args.tier }
  }
  return null
}

export function liveToolCallFromEvent(value: unknown) {
  const event = parseLiveEvent(typeof value === 'string' ? value : JSON.stringify(value))
  return event ? liveToolCall(event.raw) : null
}

function convexErrorCode(error: unknown) {
  if (!error || typeof error !== 'object' || !('data' in error)) return ''
  const data = (error as { data?: unknown }).data
  return data && typeof data === 'object' && 'code' in data && typeof data.code === 'string' ? data.code : ''
}
