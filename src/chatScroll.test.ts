import { describe, expect, test } from 'vitest'
import { isNearLatestMessage } from './chatScroll'

describe('chat scroll following', () => {
  test('follows when the reader is at or close to the latest message', () => {
    expect(isNearLatestMessage({ scrollHeight: 1_000, scrollTop: 400, clientHeight: 520 })).toBe(true)
    expect(isNearLatestMessage({ scrollHeight: 1_000, scrollTop: 384, clientHeight: 520 })).toBe(true)
  })

  test('does not follow when the reader intentionally scrolled into history', () => {
    expect(isNearLatestMessage({ scrollHeight: 1_000, scrollTop: 300, clientHeight: 520 })).toBe(false)
  })
})
