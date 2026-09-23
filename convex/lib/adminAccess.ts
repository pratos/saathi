export async function adminAccessDigest(email: string, code: string) {
  const value = `${email.trim().toLowerCase()}:${code}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

export function constantTimeHexEqual(left: string, right: string) {
  const normalizedLeft = left.trim().toLowerCase();
  const normalizedRight = right.trim().toLowerCase();
  let difference = normalizedLeft.length ^ normalizedRight.length;
  const length = Math.max(normalizedLeft.length, normalizedRight.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (normalizedLeft.charCodeAt(index) || 0) ^ (normalizedRight.charCodeAt(index) || 0);
  }
  return difference === 0;
}
