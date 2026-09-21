const PDF_URL = /https:\/\/[^\s"'<>]+\.pdf(?:\?[^\s"'<>]*)?/gi;
const PASSWORD_LINE = /(?:password|passcode|passwd|pdf\s*password)\s*[:-]\s*([^\n.]{3,80})/i;
const HINT_LINE = /(?:password|passcode).{0,40}(?:invoice|policy|account|customer|reference|dob|date of birth|phone|mobile).{0,40}/i;
const SENSITIVE_HINT = /\b(?:\d{12,19}|cvv|otp)\b/i;

const ATTACHMENT_HINT = /\b(pdf|invoice|attachment|tax invoice|receipt)\b/i;

export function findDocumentUrls(html: string, text: string) {
  const found = new Set<string>();
  for (const match of `${html}\n${text}`.matchAll(PDF_URL)) {
    const url = sanitizeHttpsUrl(match[0]);
    if (url) found.add(url);
    if (found.size >= 2) break;
  }
  return [...found];
}

export function attachmentHint(html: string, text: string, subject: string) {
  return ATTACHMENT_HINT.test(`${subject}\n${html}\n${text}`);
}

export function extractPasswordHints(subject: string, text: string) {
  const source = `${subject}\n${text}`;
  const direct = source.match(PASSWORD_LINE)?.[1]?.trim();
  if (direct && !SENSITIVE_HINT.test(direct)) return direct.slice(0, 120);
  const hint = source.match(HINT_LINE)?.[0]?.trim();
  if (hint && !SENSITIVE_HINT.test(hint)) return hint.slice(0, 180);
  if (/password[-\s]?protect|encrypted pdf|protected attachment/i.test(source)) {
    return "The attachment looks password-protected. Check the email body for the invoice, policy, or account number.";
  }
  return undefined;
}

export function inferDirection(sender: string, familyInboxId: string | undefined, text: string) {
  const haystack = `${sender}\n${text}`.toLowerCase();
  if (familyInboxId && haystack.includes(familyInboxId.toLowerCase())) return "outgoing" as const;
  if (/\b(?:you sent|sent from|thank you for (?:your )?(?:payment|order)|payment received)\b/i.test(text)) {
    return "outgoing" as const;
  }
  return "incoming" as const;
}

export function sanitizeHttpsUrl(value: string) {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:") return undefined;
    if (url.username || url.password) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

export function isPasswordParseError(_status: number, body: string) {
  return /\b(?:password[-\s]?protected|password (?:is )?(?:required|incorrect|invalid)|encrypted pdf|pdf (?:is )?encrypted|document (?:is )?encrypted)\b/i.test(body);
}

export function parseMarkdownFromFirecrawl(payload: unknown) {
  if (!payload || typeof payload !== "object") return "";
  const root = payload as Record<string, unknown>;
  const data = root.data && typeof root.data === "object" ? root.data as Record<string, unknown> : root;
  for (const value of [data.markdown, root.markdown]) {
    if (typeof value === "string" && value.trim()) return value.trim().slice(0, 40_000);
  }
  return "";
}
