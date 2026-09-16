import { env } from "../_generated/server";
import { SAATHI_IMAGE_MODEL } from "./saathi";

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

export async function generateFamilyImageBytes(prompt: string, apiKey = env.OPENROUTER_API_KEY) {
  const response = await fetch("https://openrouter.ai/api/v1/images", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: SAATHI_IMAGE_MODEL, prompt, n: 1 }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) {
    const detail = (await response.text()).replace(/\s+/g, " ").slice(0, 500);
    throw new Error(`Image generation failed (${response.status})${detail ? `: ${detail}` : ""}`);
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

function decodeBase64(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
