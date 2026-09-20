import { useEffect } from 'react'
import { Redirect } from 'expo-router'
import { useConvexAuth } from '@convex-dev/auth/react'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { StatusScreen } from '../src/components/ui'

export default function Gate() {
  const { isLoading, isAuthenticated } = useConvexAuth()
  const ensureCurrent = useMutation(api.users.ensureCurrent)
  const user = useQuery(api.users.current, isAuthenticated ? {} : 'skip')
  const spaces = useQuery(api.spaces.mine, isAuthenticated && user?.username ? {} : 'skip')

  useEffect(() => {
    if (isAuthenticated) void ensureCurrent({}).catch(() => undefined)
  }, [ensureCurrent, isAuthenticated])

  if (isLoading) return <StatusScreen message="Opening Saath securely…" />
  if (!isAuthenticated) return <Redirect href="/sign-in" />
  if (user === undefined) return <StatusScreen message="Preparing your Saathi profile…" />
  if (!user.username) return <Redirect href="/username" />
  if (spaces === undefined) return <StatusScreen message="Loading your private family spaces…" />
  const families = spaces.flatMap(row => row.space ? [row.space] : [])
  if (families.length === 0) return <Redirect href="/create-family" />
  return <Redirect href="/(app)/(tabs)" />
}
