import { describe, expect, test } from 'vitest'
import { prepareAssistantMarkdown } from './assistantMarkdown'

describe('assistant Markdown preparation', () => {
  test('turns dense numbered place results into readable Markdown items', () => {
    const output = prepareAssistantMarkdown('Places: 1. **Zoreko** * **Rating:** 4.7 stars * **Address/Area:** 2nd Korum Mall 2. **Fun City** * **Rating:** 4.2 stars * **Address/Area:** Viviana Mall')

    expect(output).toContain('Places:\n\n1. **Zoreko**\n   - **Rating:** 4.7 stars\n   - **Address/Area:** 2nd Korum Mall')
    expect(output).toContain('\n\n2. **Fun City**')
  })

  test('leaves normal prose unchanged', () => {
    expect(prepareAssistantMarkdown('The family trip starts tomorrow morning.')).toBe('The family trip starts tomorrow morning.')
  })

  test('hides unmatched bold and code markers while a reply is streaming', () => {
    expect(prepareAssistantMarkdown('Here is **the latest', true)).toBe('Here is the latest')
    expect(prepareAssistantMarkdown('Use `family', true)).toBe('Use family')
    expect(prepareAssistantMarkdown('Here is **the latest**', true)).toBe('Here is **the latest**')
  })
})
