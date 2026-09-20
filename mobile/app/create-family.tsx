import { useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { Redirect } from 'expo-router'
import { useMutation, useQuery } from 'convex/react'
import { SafeAreaView } from 'react-native-safe-area-context'
import { api } from '../../convex/_generated/api'
import { Display, ErrorText, Field, Muted, PrimaryButton } from '../src/components/ui'
import { operationId } from '../src/format'
import { colors, space } from '../src/theme'

export default function CreateFamily() {
  const spaces = useQuery(api.spaces.mine)
  const createSpace = useMutation(api.spaces.create)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  if (spaces?.some(row => row.space)) return <Redirect href="/" />

  return (
    <SafeAreaView style={styles.page}>
      <Muted>Live workspace</Muted>
      <Display style={{ marginTop: 10 }}>Create your first family space</Display>
      <Muted style={{ marginTop: 10 }}>
        Each family keeps its conversations, inbox, members, and Saathi context separate.
      </Muted>
      <View style={{ marginTop: 28, gap: 16 }}>
        <Field
          label="What should we call this family?"
          value={name}
          onChangeText={setName}
          placeholder="For example, Parents’ home"
          maxLength={80}
        />
        <PrimaryButton
          label={busy ? 'Creating…' : 'Create private family space'}
          loading={busy}
          disabled={name.trim().length < 2}
          onPress={() => {
            setBusy(true)
            setError('')
            void createSpace({ name, creationKey: operationId() }).catch(() => {
              setError('We could not create this family space. Please try again.')
              setBusy(false)
            })
          }}
        />
        <ErrorText>{error}</ErrorText>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: space.lg, paddingTop: 24 },
})
