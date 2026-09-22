export const OTP_SHARE_TTL_MS = 5 * 60 * 1_000;

const CODE_CONTEXT = "(?:otp|one[ -]?time(?: password| code)?|verification code|login code|security code|authentication code|passcode)";
const CODE_TOKEN = "((?:(?:\\d[ -]?){3,7}\\d)|[A-Z0-9]{4,8})(?![A-Z0-9])";
const OTP_PATTERNS = [
  new RegExp(`${CODE_CONTEXT}\\s*(?:is|[:=-])?\\s*${CODE_TOKEN}`, "i"),
  new RegExp(`${CODE_TOKEN}\\s*(?:is\\s+)?(?:your\\s+)?${CODE_CONTEXT}`, "i"),
];

export function extractOtpCode(value: string) {
  const text = value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  for (const pattern of OTP_PATTERNS) {
    const token = text.match(pattern)?.[1]?.replace(/[ -]/g, "").toUpperCase();
    if (token && token.length >= 4 && token.length <= 8 && /\d/.test(token)) return token;
  }
  return null;
}

export function isUnexpiredOtp(receivedAt: number, now = Date.now()) {
  return Number.isFinite(receivedAt) && receivedAt > now - OTP_SHARE_TTL_MS && receivedAt <= now + 60_000;
}
