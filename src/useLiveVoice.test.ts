import { describe, expect, test } from 'vitest'
import { groupVoiceFragments, liveImageCallFromEvent } from './useLiveVoice'

describe('live voice caption grouping', () => {
  test('preserves exact deltas and splits turns when speakers overlap', () => {
    expect(groupVoiceFragments([
      { role: 'assistant', text: 'नमस्कार', startMs: 1_100, endMs: 1_400, order: 2 },
      { role: 'user', text: 'Hello ', startMs: 100, endMs: 300, order: 0 },
      { role: 'user', text: 'Saathi', startMs: 310, endMs: 600, order: 1 },
      { role: 'user', text: 'Yes', startMs: 1_250, endMs: 1_350, order: 3 },
      { role: 'assistant', text: ', how can I help?', startMs: 1_410, endMs: 1_900, order: 4 },
    ])).toEqual([
      { role: 'user', text: 'Hello Saathi', startMs: 100 },
      { role: 'assistant', text: 'नमस्कार', startMs: 1_100 },
      { role: 'user', text: 'Yes', startMs: 1_250 },
      { role: 'assistant', text: ', how can I help?', startMs: 1_410 },
    ])
  })

  test('reads generate_image calls from GPT-Live response envelopes', () => {
    expect(liveImageCallFromEvent({
      type: 'response.event',
      event: {
        type: 'response.output_item.done',
        item: { type: 'function_call', name: 'generate_image', call_id: 'call_img_1', arguments: '{"prompt":"Hindi waste sorting chart","kind":"infographic","language":"hi"}' },
      },
    })).toEqual({ callId: 'call_img_1', prompt: 'Hindi waste sorting chart', kind: 'infographic', style: undefined, language: 'hi' })
    expect(liveImageCallFromEvent({ type: 'session.output_transcript.delta', delta: 'hello' })).toBeNull()
  })
})
