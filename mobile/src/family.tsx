import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import type { Doc, Id } from '../../convex/_generated/dataModel'
import { StatusScreen } from './components/ui'
import { readSelectedSpaceId, writeSelectedSpaceId } from './storage'

export type FamilyRow = { membership: Doc<'memberships'>; space: Doc<'spaces'> }

type FamilyContextValue = {
  user: Doc<'users'>
  families: FamilyRow[]
  family: FamilyRow
  selectFamily: (spaceId: Id<'spaces'>) => void
}

const FamilyContext = createContext<FamilyContextValue | null>(null)

export function FamilyProvider({ children }: { children: ReactNode }) {
  const user = useQuery(api.users.current)
  const spaces = useQuery(api.spaces.mine)
  const ensurePersonalRoom = useMutation(api.rooms.ensurePersonal)
  const [selectedSpaceId, setSelectedSpaceId] = useState<Id<'spaces'> | null>(null)

  useEffect(() => {
    void readSelectedSpaceId().then(value => {
      if (value) setSelectedSpaceId(value as Id<'spaces'>)
    })
  }, [])

  const families = useMemo(() => {
    if (!spaces) return []
    return spaces.flatMap(row => row.space ? [{ membership: row.membership, space: row.space }] : [])
  }, [spaces])

  const family = families.find(({ space }) => space._id === selectedSpaceId) ?? families[0]

  useEffect(() => {
    if (!family) return
    void ensurePersonalRoom({ spaceId: family.space._id }).catch(() => undefined)
  }, [ensurePersonalRoom, family?.space._id])

  const selectFamily = (spaceId: Id<'spaces'>) => {
    setSelectedSpaceId(spaceId)
    void writeSelectedSpaceId(spaceId)
  }

  if (user === undefined || spaces === undefined) return <StatusScreen message="Opening your family workspace…" />
  if (!user || !family) return null

  return (
    <FamilyContext.Provider value={{ user, families, family, selectFamily }}>
      {children}
    </FamilyContext.Provider>
  )
}

export function useFamily() {
  const value = useContext(FamilyContext)
  if (!value) throw new Error('useFamily must be used inside FamilyProvider')
  return value
}
