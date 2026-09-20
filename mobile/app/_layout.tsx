import 'react-native-gesture-handler'
import 'react-native-reanimated'
import { useEffect } from 'react'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { ConvexAuthProvider } from '@convex-dev/auth/react'
import { ConvexReactClient } from 'convex/react'
import { useFonts, DMSans_400Regular, DMSans_500Medium, DMSans_600SemiBold } from '@expo-google-fonts/dm-sans'
import { Newsreader_600SemiBold } from '@expo-google-fonts/newsreader'
import * as SplashScreen from 'expo-splash-screen'
import { authStorage } from '../src/storage'
import { colors } from '../src/theme'
import { StatusScreen } from '../src/components/ui'

SplashScreen.preventAutoHideAsync().catch(() => undefined)

const convexUrl = process.env.EXPO_PUBLIC_CONVEX_URL?.trim()
const convex = convexUrl
  ? new ConvexReactClient(convexUrl, { unsavedChangesWarning: false })
  : null

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    DMSans_400Regular,
    DMSans_500Medium,
    DMSans_600SemiBold,
    Newsreader_600SemiBold,
  })

  useEffect(() => {
    if (fontsLoaded) void SplashScreen.hideAsync()
  }, [fontsLoaded])

  if (!fontsLoaded) return null
  if (!convex) return <StatusScreen message="Set EXPO_PUBLIC_CONVEX_URL to open your family workspace." />

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.bg }}>
      <ConvexAuthProvider client={convex} storage={authStorage}>
        <StatusBar style="light" />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg }, animation: 'fade' }} />
      </ConvexAuthProvider>
    </GestureHandlerRootView>
  )
}
