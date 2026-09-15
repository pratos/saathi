import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAction, useMutation } from 'convex/react'
import { api } from '../convex/_generated/api'
import type { Id } from '../convex/_generated/dataModel'

type VoiceStatus = 'idle' | 'requesting' | 'connecting' | 'live' | 'muted' | 'ending' | 'ended' | 'error'
type VoiceFragment = { role: 'user' | 'assistant'; text: string; startMs: number; endMs: number; order: number }
export type VoiceTurn = { role: 'user' | 'assistant'; text: string; startMs: number }

export function useLiveVoice(roomId: Id<'rooms'>) {
  const createSession = useAction(api.liveVoice.startSession)
  const saveTranscript = useMutation(api.liveVoice.saveTranscript)
  const [status, setStatus] = useState<VoiceStatus>('idle')
  const [error, setError] = useState('')
  const [fragments, setFragments] = useState<VoiceFragment[]>([])
  const peerRef = useRef<RTCPeerConnection | null>(null)
  const channelRef = useRef<RTCDataChannel | null>(null)
  const microphoneRef = useRef<MediaStream | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const sessionIdRef = useRef('')
  const fragmentsRef = useRef<VoiceFragment[]>([])
  const persistedSessionRef = useRef('')
  const closeTimerRef = useRef<number | null>(null)
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
  }, [])

  const persistKnownTranscript = useCallback(async () => {
    const sessionId = sessionIdRef.current
    if (!sessionId || persistedSessionRef.current === sessionId) return
    persistedSessionRef.current = sessionId
    const turns = groupVoiceFragments(fragmentsRef.current)
    if (!turns.length) return
    try {
      await saveTranscript({ roomId, sessionId, turns })
      setFragments([])
      fragmentsRef.current = []
    } catch {
      setError('The conversation ended, but its transcript could not be saved.')
      setStatus('error')
    }
  }, [roomId, saveTranscript])

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
        audio.srcObject = event.streams[0] ?? new MediaStream([event.track])
        void audio.play().catch(() => setError('Select the page to allow Saathi’s voice to play.'))
      })
      const microphone = await navigator.mediaDevices.getUserMedia({ audio: true })
      if (generation !== generationRef.current) return microphone.getTracks().forEach(track => track.stop())
      microphoneRef.current = microphone
      microphone.getAudioTracks().forEach(track => peer.addTrack(track, microphone))

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
  }, [cleanup, createSession, persistKnownTranscript, roomId, status])

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

function parseLiveEvent(value: unknown): null | { type: string; delta: string; start_ms: number; end_ms: number; message: string } {
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
    }
  } catch {
    return null
  }
}

function convexErrorCode(error: unknown) {
  if (!error || typeof error !== 'object' || !('data' in error)) return ''
  const data = (error as { data?: unknown }).data
  return data && typeof data === 'object' && 'code' in data && typeof data.code === 'string' ? data.code : ''
}
