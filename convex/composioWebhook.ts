import { env, httpAction } from "./_generated/server";
import { internal } from "./_generated/api";

export const handle = httpAction(async (ctx, request) => {
  const secret = env.COMPOSIO_WEBHOOK_SECRET?.trim();
  if (!secret) return new Response("Webhook not configured", { status: 503 });
  const webhookId = request.headers.get("webhook-id") ?? "";
  const timestamp = request.headers.get("webhook-timestamp") ?? "";
  const signature = request.headers.get("webhook-signature") ?? "";
  const rawBody = await request.text();
  if (!await verifyStandardWebhook({ secret, webhookId, timestamp, signature, rawBody })) {
    return new Response("Invalid signature", { status: 401 });
  }

  let body: unknown;
  try { body = JSON.parse(rawBody); } catch { return new Response("Invalid payload", { status: 400 }); }
  if (!body || typeof body !== "object") return new Response("Invalid payload", { status: 400 });
  const event = body as Record<string, unknown>;
  if (event.type !== "composio.trigger.message") return Response.json({ status: "ignored" });
  const metadata = event.metadata && typeof event.metadata === "object" ? event.metadata as Record<string, unknown> : null;
  if (metadata?.trigger_slug !== "GMAIL_NEW_GMAIL_MESSAGE") return Response.json({ status: "ignored" });
  const connectedAccountId = typeof metadata.connected_account_id === "string" ? metadata.connected_account_id : "";
  const eventId = typeof event.id === "string" ? event.id : "";
  if (!connectedAccountId || !eventId || !event.data || typeof event.data !== "object") return new Response("Invalid Gmail event", { status: 400 });
  await ctx.scheduler.runAfter(0, internal.gmail.processIncoming, { connectedAccountId, eventId, payload: event.data });
  return Response.json({ status: "accepted" });
});

export async function verifyStandardWebhook({ secret, webhookId, timestamp, signature, rawBody, now = Date.now() }: {
  secret: string;
  webhookId: string;
  timestamp: string;
  signature: string;
  rawBody: string;
  now?: number;
}) {
  if (!secret || !webhookId || !/^\d+$/.test(timestamp)) return false;
  const seconds = Number(timestamp);
  if (!Number.isSafeInteger(seconds) || Math.abs(Math.floor(now / 1_000) - seconds) > 300) return false;
  try {
    const keyBytes = secret.startsWith("whsec_") ? base64Bytes(secret.slice(6)) : new TextEncoder().encode(secret);
    const expected = await hmacBytes(keyBytes, `${webhookId}.${timestamp}.${rawBody}`);
    const candidates = signature.trim().split(/\s+/).flatMap(candidate => {
      const [version, encoded, ...extra] = candidate.split(",");
      return version === "v1" && encoded && extra.length === 0 ? [encoded] : [];
    });
    for (const candidate of candidates) {
      try {
        if (constantTimeEqual(expected, base64Bytes(candidate))) return true;
      } catch { /* Ignore malformed signatures while checking rotated keys. */ }
    }
    return false;
  } catch {
    return false;
  }
}

async function hmacBytes(secret: Uint8Array, message: string) {
  const key = await crypto.subtle.importKey("raw", new Uint8Array(secret).buffer, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)));
}

function base64Bytes(value: string) {
  if (!value || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw new Error("Invalid base64");
  return Uint8Array.from(atob(value), character => character.charCodeAt(0));
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}
