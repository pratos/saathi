import { env } from "../_generated/server";

const PROVIDERS = ["openai", "openrouter", "codex"] as const;
export type ByokProvider = (typeof PROVIDERS)[number];

export function isByokProvider(value: string): value is ByokProvider {
  return (PROVIDERS as readonly string[]).includes(value);
}

export function keyLooksValid(provider: ByokProvider, secret: string) {
  const trimmed = secret.trim();
  if (trimmed.length < 20 || trimmed.length > 400) return false;
  if (/\s/.test(trimmed)) return false;
  if (provider === "openrouter") return /^sk-or-/.test(trimmed);
  return /^(sk-|cr-)[A-Za-z0-9_-]+$/.test(trimmed);
}

export function keyLastFour(secret: string) {
  const trimmed = secret.trim();
  return trimmed.slice(-4);
}

export async function sealSecret(secret: string) {
  const key = await currentWrappingKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(secret.trim()));
  return `v2:${toHex(iv)}:${toHex(new Uint8Array(encrypted))}`;
}

export async function openSecret(sealed: string) {
  const parts = sealed.split(":");
  const versioned = parts[0] === "v2";
  const ivHex = parts[versioned ? 1 : 0];
  const dataHex = parts[versioned ? 2 : 1];
  if (!ivHex || !dataHex) throw new Error("Stored key is invalid.");
  const key = versioned ? await currentWrappingKey() : await legacyWrappingKey();
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromHex(ivHex) },
    key,
    fromHex(dataHex),
  );
  return new TextDecoder().decode(decrypted);
}

async function currentWrappingKey() {
  const material = env.BYOK_ENCRYPTION_KEY?.trim() || env.OPENROUTER_API_KEY?.trim() || env.OPENAI_API_KEY?.trim();
  if (!material) throw new Error("Set BYOK_ENCRYPTION_KEY before saving provider keys.");
  return wrappingKey(material);
}

function legacyWrappingKey() {
  const material = env.OPENROUTER_API_KEY?.trim() || env.OPENAI_API_KEY?.trim() || "saathi-local-byok";
  return wrappingKey(material);
}

async function wrappingKey(material: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`saathi-byok:${material}`));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

function toHex(bytes: Uint8Array) {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}

function fromHex(value: string) {
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  return bytes;
}
