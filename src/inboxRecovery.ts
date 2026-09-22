type InboxExtractionFields = {
  category: 'needs_review' | string
  extractedAmount?: string
  extractedAmountInr?: string
  extractedAmountUsd?: string
}

export type InboxExtractionRecovery = {
  pending: string
  failed: string
  action: string
} | null

export function inboxExtractionRecovery(item: InboxExtractionFields): InboxExtractionRecovery {
  const hasAmount = Boolean(item.extractedAmount || item.extractedAmountInr || item.extractedAmountUsd)
  const hasCategory = item.category !== 'needs_review'

  if (hasAmount && hasCategory) return null
  if (hasAmount) return {
    pending: 'Classifying this email…',
    failed: 'Could not classify this email.',
    action: 'Classify email',
  }
  if (hasCategory) return {
    pending: 'Finding the amount…',
    failed: 'Could not find the amount.',
    action: 'Find amount',
  }
  return {
    pending: 'Finding the amount and category…',
    failed: 'Could not find the amount or category.',
    action: 'Find amount and category',
  }
}
