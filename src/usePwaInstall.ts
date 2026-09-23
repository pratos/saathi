import { useEffect, useMemo, useState } from 'react'

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

type NavigatorWithStandalone = Navigator & { standalone?: boolean }
export type PwaInstallMode = 'native' | 'ios'
export type PwaInstallController = {
  mode: PwaInstallMode | null
  install: () => Promise<void>
  dismiss: () => void
}

// Keep the legacy key so existing installations retain their reminder preference.
const DISMISSED_UNTIL_KEY = 'saath:pwa-install-dismissed-until'
const DISMISSAL_MS = 7 * 24 * 60 * 60 * 1_000

export function usePwaInstall(): PwaInstallController {
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [installed, setInstalled] = useState(isStandalone)
  const [snoozed, setSnoozed] = useState(() => readDismissedUntil() > Date.now())
  const mobileInstallSurface = useMemo(() => isMobileInstallSurface(), [])
  const iosInstallAvailable = useMemo(() => isIosInstallSurface(), [])

  useEffect(() => {
    const displayMode = window.matchMedia('(display-mode: standalone)')
    const capturePrompt = (event: Event) => {
      event.preventDefault()
      if (mobileInstallSurface) setInstallPrompt(event as BeforeInstallPromptEvent)
    }
    const updateInstalledState = () => setInstalled(isStandalone())
    const markInstalled = () => {
      setInstalled(true)
      setInstallPrompt(null)
      clearDismissal()
      setSnoozed(false)
    }
    window.addEventListener('beforeinstallprompt', capturePrompt)
    window.addEventListener('appinstalled', markInstalled)
    displayMode.addEventListener('change', updateInstalledState)
    return () => {
      window.removeEventListener('beforeinstallprompt', capturePrompt)
      window.removeEventListener('appinstalled', markInstalled)
      displayMode.removeEventListener('change', updateInstalledState)
    }
  }, [mobileInstallSurface])

  const dismiss = () => {
    writeDismissedUntil(Date.now() + DISMISSAL_MS)
    setSnoozed(true)
  }

  const install = async () => {
    if (!installPrompt) return
    await installPrompt.prompt()
    const choice = await installPrompt.userChoice
    setInstallPrompt(null)
    if (choice.outcome === 'accepted') {
      setInstalled(true)
      clearDismissal()
      setSnoozed(false)
    } else {
      dismiss()
    }
  }

  const mode = !mobileInstallSurface || installed || snoozed ? null : installPrompt ? 'native' : iosInstallAvailable ? 'ios' : null
  return { mode, install, dismiss }
}

export function isMobileInstallSurface(currentNavigator: Pick<Navigator, 'userAgent' | 'maxTouchPoints'> = navigator) {
  return /Android|Mobile/i.test(currentNavigator.userAgent) || isIosInstallSurface(currentNavigator)
}

export function isIosInstallSurface(currentNavigator: Pick<Navigator, 'userAgent' | 'maxTouchPoints'> = navigator) {
  const iosUserAgent = /iPhone|iPad|iPod/i.test(currentNavigator.userAgent)
  const iPadDesktopMode = /Macintosh/i.test(currentNavigator.userAgent) && currentNavigator.maxTouchPoints > 1
  return iosUserAgent || iPadDesktopMode
}

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches
    || (navigator as NavigatorWithStandalone).standalone === true
}

function readDismissedUntil() {
  try {
    const value = Number.parseInt(localStorage.getItem(DISMISSED_UNTIL_KEY) ?? '', 10)
    return Number.isFinite(value) ? value : 0
  } catch {
    return 0
  }
}

function writeDismissedUntil(value: number) {
  try {
    localStorage.setItem(DISMISSED_UNTIL_KEY, String(value))
  } catch {
    // Private browsing can make storage unavailable; state still suppresses this render.
  }
}

function clearDismissal() {
  try {
    localStorage.removeItem(DISMISSED_UNTIL_KEY)
  } catch {
    // Storage cleanup is best-effort.
  }
}
