import { describe, expect, test } from 'vitest'
import { APPLICATION_ASSISTANT_TOOLS, assistantProviderTools } from '../convex/lib/assistantCapabilities'
import {
  addVoiceToolActivity,
  finishVoiceToolActivity,
  groupVoiceFragments,
  liveToolCallFromEvent,
  voiceConversationAction,
} from './useLiveVoice'

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
    expect(liveToolCallFromEvent({
      type: 'response.event',
      event: {
        type: 'response.output_item.done',
        item: { type: 'function_call', name: 'generate_image', call_id: 'call_img_1', arguments: '{"prompt":"Hindi waste sorting chart","kind":"infographic","language":"hi"}' },
      },
    })).toEqual({ name: 'generate_image', callId: 'call_img_1', prompt: 'Hindi waste sorting chart', kind: 'infographic', style: undefined, language: 'hi' })
    expect(liveToolCallFromEvent({
      type: 'response.event',
      event: {
        type: 'response.output_item.done',
        item: { type: 'function_call', name: 'set_food_budget', call_id: 'call_budget_1', arguments: '{"amount":15000,"currency":"INR"}' },
      },
    })).toEqual({ name: 'set_food_budget', callId: 'call_budget_1', arguments: { amount: 15000, currency: 'INR' } })
    expect(liveToolCallFromEvent({ type: 'session.output_transcript.delta', delta: 'hello' })).toBeNull()
  })

  test('uses the same application capabilities as Pi and routes voice memory and browser calls', () => {
    const names = APPLICATION_ASSISTANT_TOOLS.map(tool => tool.name)
    expect(names).toHaveLength(14)
    expect(assistantProviderTools().map(tool => tool.name)).toEqual(names)

    const remember = liveToolCallFromEvent({
      type: 'response.event',
      event: {
        type: 'response.output_item.done',
        item: { type: 'function_call', name: 'remember', call_id: 'call_memory_1', arguments: '{"key":"school pickup","value":"Friday at 3 PM"}' },
      },
    })
    expect(remember).toEqual({
      name: 'remember', callId: 'call_memory_1', arguments: { key: 'school pickup', value: 'Friday at 3 PM' },
    })
    if (!remember || remember.name === 'generate_image') throw new Error('Expected a memory tool call')
    expect(voiceConversationAction(remember)).toEqual({ type: 'remember', key: 'school pickup', value: 'Friday at 3 PM' })

    expect(liveToolCallFromEvent({
      type: 'response.event',
      event: {
        type: 'response.output_item.done',
        item: { type: 'function_call', name: 'use_computer', call_id: 'call_browser_1', arguments: '{"url":"https://example.com","task":"Find the admissions page"}' },
      },
    })).toEqual({
      name: 'use_computer', callId: 'call_browser_1',
      arguments: { url: 'https://example.com', task: 'Find the admissions page' },
    })
  })

  test('keeps rich voice activities keyed to the matching tool call', () => {
    const search = liveToolCallFromEvent({
      type: 'response.event',
      event: {
        type: 'response.output_item.done',
        item: { type: 'function_call', name: 'search_public_web', call_id: 'call_search_1', arguments: '{"query":"Pune school closure today"}' },
      },
    })
    const browser = liveToolCallFromEvent({
      type: 'response.event',
      event: {
        type: 'response.output_item.done',
        item: { type: 'function_call', name: 'use_computer', call_id: 'call_browser_2', arguments: '{"url":"https://example.com","task":"Open the parent login page"}' },
      },
    })
    if (!search || !browser) throw new Error('Expected voice tool calls')

    const running = addVoiceToolActivity(addVoiceToolActivity([], search), browser)
    expect(running).toEqual([
      expect.objectContaining({ id: 'call_search_1', title: 'Search public web', detail: 'Pune school closure today', status: 'running' }),
      expect.objectContaining({ id: 'call_browser_2', title: 'Use computer', detail: 'Open the parent login page', status: 'running' }),
    ])

    expect(finishVoiceToolActivity(running, 'call_search_1', {
      ok: true,
      message: 'Schools remain open. [Source](https://example.com/news)',
    })).toEqual([
      expect.objectContaining({ id: 'call_search_1', status: 'complete', result: expect.stringContaining('Source') }),
      expect.objectContaining({ id: 'call_browser_2', status: 'running' }),
    ])
  })
})
