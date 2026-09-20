export function convexErrorCode(error: unknown) {
  if (!error || typeof error !== 'object' || !('data' in error)) return ''
  const data = (error as { data?: unknown }).data
  return data && typeof data === 'object' && 'code' in data && typeof data.code === 'string' ? data.code : ''
}

export function otpRequestErrorMessage(error: unknown) {
  const data = typeof error === 'object' && error !== null && 'data' in error
    ? (error as { data?: unknown }).data
    : null
  if (typeof data !== 'object' || data === null || !('kind' in data)) {
    return 'We could not send a code. Please try again in a moment.'
  }
  const kind = (data as { kind?: unknown }).kind
  if (kind === 'OtpRateLimited') return 'Too many code requests. Please wait before trying again.'
  if (kind === 'OtpConfigurationMissing') return 'Email sign-in is not configured yet.'
  if (kind === 'OtpDeliveryRejected') return 'The sign-in email could not be delivered. Try again shortly.'
  return 'We could not send a code. Please try again in a moment.'
}

export function usernameErrorMessage(error: unknown) {
  const code = convexErrorCode(error)
  if (code === 'USERNAME_TAKEN') return 'That username is already being used. Try another one.'
  if (code === 'USERNAME_RESERVED') return 'That username is kept for Saathi. Try another one.'
  return 'Start with a letter and use 3–24 letters, numbers, or underscores.'
}
