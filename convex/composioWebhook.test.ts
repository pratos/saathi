import { createHmac } from "node:crypto";
import { describe, expect, test } from "vitest";
import { verifyStandardWebhook } from "./composioWebhook";

const now = 1_800_000_000_000;
const timestamp = String(Math.floor(now / 1_000));
const webhookId = "msg_asymmetric_123";
const rawBody = '{"type":"composio.trigger.message","data":{"subject":"Rent due"}}';

function signature(secret: string, body = rawBody) {
  return createHmac("sha256", secret).update(`${webhookId}.${timestamp}.${body}`).digest("base64");
}

describe("Composio Standard Webhooks verification", () => {
  test("accepts a valid rotated v1 signature and rejects body tampering", async () => {
    const secret = "test_webhook_secret_with_enough_entropy";
    const rotated = `v1,not-base64! v1,${signature(secret)}`;
    await expect(verifyStandardWebhook({ secret, webhookId, timestamp, signature: rotated, rawBody, now })).resolves.toBe(true);
    await expect(verifyStandardWebhook({ secret, webhookId, timestamp, signature: rotated, rawBody: `${rawBody} `, now })).resolves.toBe(false);
  });

  test("supports whsec_ base64 secrets and enforces the 300-second replay window", async () => {
    const rawSecret = "standard-webhooks-secret";
    const secret = `whsec_${Buffer.from(rawSecret).toString("base64")}`;
    const signed = `v1,${signature(rawSecret)}`;
    await expect(verifyStandardWebhook({ secret, webhookId, timestamp, signature: signed, rawBody, now: now + 300_000 })).resolves.toBe(true);
    await expect(verifyStandardWebhook({ secret, webhookId, timestamp, signature: signed, rawBody, now: now + 301_000 })).resolves.toBe(false);
    await expect(verifyStandardWebhook({ secret, webhookId, timestamp: `${timestamp}.5`, signature: signed, rawBody, now })).resolves.toBe(false);
  });
});
