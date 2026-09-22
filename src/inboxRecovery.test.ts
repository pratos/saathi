import { describe, expect, test } from 'vitest'
import { inboxExtractionRecovery } from './inboxRecovery'

describe('inbox extraction recovery copy', () => {
  test('requests only classification when an amount is already present', () => {
    expect(inboxExtractionRecovery({ category: 'needs_review', extractedAmountInr: '₹219' })).toEqual({
      pending: 'Classifying this email…',
      failed: 'Could not classify this email.',
      action: 'Classify email',
    })
  })

  test('requests only an amount when the email is already classified', () => {
    expect(inboxExtractionRecovery({ category: 'receipts' })).toEqual({
      pending: 'Finding the amount…',
      failed: 'Could not find the amount.',
      action: 'Find amount',
    })
  })

  test('keeps full recovery when both fields are missing', () => {
    expect(inboxExtractionRecovery({ category: 'needs_review' })?.action).toBe('Find amount and category')
  })

  test('does not offer extraction when amount and classification are both present', () => {
    expect(inboxExtractionRecovery({ category: 'receipts', extractedAmountUsd: '$18.00' })).toBeNull()
  })
})
