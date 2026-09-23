import { describe, expect, test } from 'vitest'
import { isIosInstallSurface, isMobileInstallSurface } from './usePwaInstall'

describe('isMobileInstallSurface', () => {
  test('suppresses desktop install offers', () => {
    expect(isMobileInstallSurface({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/140 Safari/537.36',
      maxTouchPoints: 0,
    })).toBe(false)
  })

  test('allows phones and iPads using desktop-mode user agents', () => {
    expect(isMobileInstallSurface({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile', maxTouchPoints: 5 })).toBe(true)
    expect(isMobileInstallSurface({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) Safari/605.1', maxTouchPoints: 5 })).toBe(true)
  })
})

describe('isIosInstallSurface', () => {
  test('identifies iPhone and desktop-mode iPad without relying on navigator.standalone', () => {
    expect(isIosInstallSurface({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) CriOS/140 Mobile', maxTouchPoints: 5 })).toBe(true)
    expect(isIosInstallSurface({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) Safari/605.1', maxTouchPoints: 5 })).toBe(true)
  })

  test('does not send Android through the manual iOS install flow', () => {
    expect(isIosInstallSurface({ userAgent: 'Mozilla/5.0 (Linux; Android 16; Pixel 9) Chrome/140 Mobile', maxTouchPoints: 5 })).toBe(false)
  })
})
