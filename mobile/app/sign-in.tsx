import { useState } from 'react'
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import { Redirect, useRouter } from 'expo-router'
import { useAuthActions, useConvexAuth } from '@convex-dev/auth/react'
import { SafeAreaView } from 'react-native-safe-area-context'
import { LinearGradient } from 'expo-linear-gradient'
import { ArrowLeft } from 'lucide-react-native'
import { Body, BrandMark, Display, ErrorText, Field, Muted, PrimaryButton } from '../src/components/ui'
import { otpRequestErrorMessage } from '../src/errors'
import { colors, fonts, space } from '../src/theme'

export default function SignIn() {
  const { signIn } = useAuthActions()
  const { isAuthenticated } = useConvexAuth()
  const router = useRouter()
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const sendCode = async () => {
    await signIn('saath-email', { email: email.trim().toLowerCase() })
    setStep('code')
  }

  if (isAuthenticated) return <Redirect href="/" />

  return (
    <LinearGradient colors={[colors.bg, '#18241F']} style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1 }}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.page}>
          <Pressable onPress={() => router.back()} style={styles.back} hitSlop={12}>
            <ArrowLeft color={colors.textMuted} size={20} />
            <Text style={styles.backLabel}>Back</Text>
          </Pressable>
          <BrandMark size={52} />
          <Text style={styles.brand}>Saath</Text>
          <Display style={{ marginTop: 28 }}>
            {step === 'email' ? 'Sign in with your email' : 'Enter your six-digit code'}
          </Display>
          <Muted style={{ marginTop: 10 }}>
            {step === 'email'
              ? 'We’ll email you a one-time code. There is no password to remember.'
              : `We sent a sign-in code to ${email}.`}
          </Muted>

          {step === 'email' ? (
            <View style={styles.form}>
              <Field
                label="Email address"
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
                placeholder="you@example.com"
              />
              <PrimaryButton
                label={busy ? 'Sending your code…' : 'Email me a code'}
                loading={busy}
                disabled={!email.includes('@')}
                onPress={() => {
                  setBusy(true)
                  setError('')
                  void sendCode().catch(requestError => setError(otpRequestErrorMessage(requestError))).finally(() => setBusy(false))
                }}
              />
            </View>
          ) : (
            <View style={styles.form}>
              <Field
                label="One-time code"
                value={code}
                onChangeText={value => setCode(value.replace(/\D/g, '').slice(0, 6))}
                keyboardType="number-pad"
                autoComplete="one-time-code"
                placeholder="000000"
                maxLength={6}
              />
              <PrimaryButton
                label={busy ? 'Checking code…' : 'Verify and continue'}
                loading={busy}
                disabled={code.length !== 6}
                onPress={() => {
                  setBusy(true)
                  setError('')
                  void signIn('saath-email', { email: email.trim().toLowerCase(), code })
                    .then(result => {
                      if (!result.signingIn) throw new Error('Sign-in was not completed')
                    })
                    .catch(() => {
                      setError('That code is incorrect or expired. Request a new code and try again.')
                      setBusy(false)
                    })
                }}
              />
              <Pressable onPress={() => {
                setNotice('')
                setError('')
                setCode('')
                setBusy(true)
                void sendCode()
                  .then(() => setNotice('A new code is on its way. The previous one will no longer work.'))
                  .catch(requestError => setError(otpRequestErrorMessage(requestError)))
                  .finally(() => setBusy(false))
              }}>
                <Text style={styles.link}>Request a new code</Text>
              </Pressable>
              <Pressable onPress={() => { setStep('email'); setCode(''); setError(''); setNotice('') }}>
                <Text style={styles.link}>Use a different email</Text>
              </Pressable>
            </View>
          )}
          {notice ? <Body style={{ color: colors.teal, marginTop: 12 }}>{notice}</Body> : null}
          <ErrorText>{error}</ErrorText>
          <Muted style={{ marginTop: 'auto', fontSize: 13 }}>
            Private by design. Your code expires after 10 minutes and can only be used once.
          </Muted>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </LinearGradient>
  )
}

const styles = StyleSheet.create({
  page: { flex: 1, paddingHorizontal: space.lg, paddingTop: 8, paddingBottom: 24 },
  back: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 28 },
  backLabel: { color: colors.textMuted, fontFamily: fonts.sansMedium, fontSize: 15 },
  brand: { color: colors.text, fontFamily: fonts.serif, fontSize: 22, marginTop: 14 },
  form: { marginTop: 28, gap: 16 },
  link: { color: colors.teal, fontFamily: fonts.sansMedium, fontSize: 15, textAlign: 'center' },
})
