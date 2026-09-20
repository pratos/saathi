export function formatRelativeTime(timestamp: number) {
  const elapsed = Date.now() - timestamp
  if (elapsed < 60_000) return 'Just now'
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)} min`
  if (elapsed < 86_400_000) {
    return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(timestamp)
  }
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(timestamp)
}

export function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function formatVoiceDuration(seconds: number) {
  const rounded = Math.max(0, Math.round(seconds))
  const minutes = Math.floor(rounded / 60)
  const remainder = rounded % 60
  return minutes ? `${minutes}m ${remainder}s` : `${remainder}s`
}

export function formatVoiceCost(costUsd: number) {
  return `$${costUsd.toFixed(4)}`
}

export function languageLabel(value: 'en' | 'hi' | 'mr' | undefined) {
  return value === 'hi' ? 'Hindi' : value === 'mr' ? 'Marathi' : 'English'
}

export function initialsFor(value: string) {
  const clean = value.includes('<') ? value.split('<')[0].trim() : value.split('@')[0]
  return clean.split(/\s|[._-]/).filter(Boolean).slice(0, 2).map(part => part[0]?.toUpperCase()).join('') || 'F'
}

export function displaySender(value: string) {
  return value.match(/^\s*([^<]+)\s*</)?.[1]?.trim() || value
}

export function categoryLabel(category: string) {
  if (category === 'needs_review') return 'Needs review'
  if (category === 'bank') return 'Bank'
  if (category === 'receipts') return 'Purchase'
  return category.charAt(0).toUpperCase() + category.slice(1)
}

export function greetingForNow() {
  const hour = new Date().getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}

export function operationId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
}

export function readableEmailBody(raw: string) {
  const stripped = raw
    .replace(/<style[\s\S]*?<\/style>/gi, '\n')
    .replace(/<script[\s\S]*?<\/script>/gi, '\n')
    .replace(/<head[\s\S]*?<\/head>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/}/g, '}\n')
    .replace(/;/g, ';\n')
  const prose = stripped.split(/\n+/).map(line => line.trim()).filter(line => line && !isCssJunk(line))
  return prose.join('\n').replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim().slice(0, 4_000)
}

function isCssJunk(line: string) {
  const hits = (line.match(/padding|margin|background|border|font-|color:|width:|height:|display:|text-align|white-space|box-shadow|inline-block|gradient|webkit|moz-|opacity:|cursor:|outline:|min-width|max-width|letter-spacing|text-decoration|vertical-align|line-height|border-radius/gi) ?? []).length
  if (hits >= 2) return true
  if (/[{}]/.test(line) && /px|em|rem|#([0-9a-f]{3,8})\b/i.test(line)) return true
  if (/^[a-z0-9.#:[\s>-]+\{/i.test(line)) return true
  if (/^\s*[a-z-]+\s*:\s*[^:]{1,80};?\s*$/i.test(line)) return true
  if (!line.includes(' ') && /^(none|block|flex|inline-block|center|left|right|#?[0-9a-f]{3,8}|[0-9.]+(?:px|em|rem|%)|rgba?\([^)]*\))$/i.test(line)) return true
  return false
}
