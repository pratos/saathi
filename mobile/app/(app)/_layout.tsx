import { Redirect, Stack } from 'expo-router'
import { useConvexAuth } from '@convex-dev/auth/react'
import { FamilyProvider } from '../../src/family'
import { colors } from '../../src/theme'

export default function AppLayout() {
  const { isAuthenticated, isLoading } = useConvexAuth()
  if (isLoading) return null
  if (!isAuthenticated) return <Redirect href="/sign-in" />
  return (
    <FamilyProvider>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="room/[id]" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="inbox/[id]" options={{ animation: 'slide_from_right' }} />
      </Stack>
    </FamilyProvider>
  )
}
