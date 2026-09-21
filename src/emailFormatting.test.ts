import { describe, expect, test } from 'vitest'
import { emailBodyHtml } from './emailFormatting'

describe('emailBodyHtml', () => {
  test('uses the stored HTML representation when available', () => {
    expect(emailBodyHtml('<html><body><strong>Formatted</strong></body></html>', 'Fallback'))
      .toBe('<html><body><strong>Formatted</strong></body></html>')
  })

  test('recovers existing records whose HTML was stored as text', () => {
    const html = '<html><head><style>h1{color:red}</style></head><body><h1>Changes</h1></body></html>'
    expect(emailBodyHtml(undefined, html)).toBe(html)
  })

  test('escapes actual plain text instead of interpreting it as markup', () => {
    expect(emailBodyHtml(undefined, 'Amount < ₹500\nPay & review'))
      .toBe('<p>Amount &lt; ₹500<br>Pay &amp; review</p>')
  })
})
