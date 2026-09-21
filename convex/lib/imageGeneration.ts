import { SAATHI_IMAGE_MODEL } from "./saathi";

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

export async function generateFamilyImageBytes(prompt: string, apiKey: string) {
  const response = await fetch("https://openrouter.ai/api/v1/images", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: SAATHI_IMAGE_MODEL, prompt, n: 1 }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) {
    const detail = await response.text();
    const failure = imageGenerationFailure(response.status, detail);
    console.warn("OPENROUTER_IMAGE_REJECTED", response.status, failure.reason);
    throw new Error(failure.message);
  }
  const payload: unknown = await response.json();
  const image = payload && typeof payload === "object" && "data" in payload && Array.isArray(payload.data)
    ? payload.data[0] : undefined;
  if (!image || typeof image !== "object" || !("b64_json" in image) || typeof image.b64_json !== "string") {
    throw new Error("Image provider returned no image data.");
  }
  const mediaType = "media_type" in image && typeof image.media_type === "string" ? image.media_type : "image/png";
  if (!new Set(["image/png", "image/jpeg", "image/webp"]).has(mediaType)) throw new Error("Image provider returned an unsupported format.");
  const bytes = decodeBase64(image.b64_json);
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_IMAGE_BYTES) throw new Error("Generated image size is invalid.");
  return { bytes, mediaType };
}

export function imageGenerationFailure(status: number, body: string) {
  const provider = parseProviderFailure(body);
  const missingAttestations = provider?.error?.metadata?.missing_attestation_types;
  if (Array.isArray(missingAttestations) && missingAttestations.includes("age_18plus")) {
    return {
      reason: "missing_age_attestation",
      message: "The OpenRouter key used by this family needs 18+ age confirmation before it can generate images. Confirm it at https://openrouter.ai/settings/preferences, then try again.",
    };
  }
  if (status === 401) {
    return {
      reason: "invalid_api_key",
      message: "The family's OpenRouter key is invalid or expired. Update it in Saathi settings, then try again.",
    };
  }
  if (status === 402) {
    return {
      reason: "insufficient_credits",
      message: "The family's OpenRouter account needs credits before it can generate images.",
    };
  }
  if (status === 429) {
    return {
      reason: "rate_limited",
      message: "Image generation is busy right now. Please wait a moment and try again.",
    };
  }
  return {
    reason: `provider_${status}`,
    message: "Saathi could not create that image because the image provider rejected the request. Please try again later.",
  };
}

function parseProviderFailure(value: string) {
  try {
    return JSON.parse(value) as {
      error?: { metadata?: { missing_attestation_types?: unknown } };
    };
  } catch {
    return null;
  }
}

function decodeBase64(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
