import { useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { Redirect } from 'expo-router'
import { useMutation, useQuery } from 'convex/react'
import { SafeAreaView } from 'react-native-safe-area-context'
import { api } from '../../convex/_generated/api'
import { Display, ErrorText, Field, Muted, PrimaryButton } from '../src/components/ui'
import { usernameErrorMessage } from '../src/errors'
import { colors, space } from '../src/theme'

export default function Username() {
  const user = useQuery(api.users.current)
  const setUsername = useMutation(api.users.setUsername)
  const [username, setUsernameDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  if (user?.username) return <Redirect href="/" />

  return (
    <SafeAreaView style={styles.page}>
      <Muted>One last step</Muted>
      <Display style={{ marginTop: 10 }}>How should your family tag you?</Display>
      <Muted style={{ marginTop: 10 }}>
        Choose a short username for family chats. People can type it after @ when they want your attention.
      </Muted>
      <View style={{ marginTop: 28, gap: 16 }}>
        <Field
          label="Your username"
          value={username}
          onChangeText={value => setUsernameDraft(value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
          autoCapitalize="none"
          autoComplete="username"
          placeholder="priya_shah"
          maxLength={24}
        />
        <PrimaryButton
          label={busy ? 'Saving…' : 'Continue to chat'}
          loading={busy}
          disabled={username.length < 3}
          onPress={() => {
            setBusy(true)
            setError('')
            void setUsername({ username }).catch(caught => {
              setError(usernameErrorMessage(caught))
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
