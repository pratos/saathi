export const modelProfiles = {
  family: { provider: "openrouter", model: "deepseek/deepseek-v4.1-flash" },
  luna: { provider: "openai", modelEnv: "OPENAI_MODEL_LUNA" },
  terra: { provider: "openai", modelEnv: "OPENAI_MODEL_TERRA" },
  sol: { provider: "openai", modelEnv: "OPENAI_MODEL_SOL" },
  astra: { provider: "openai", modelEnv: "OPENAI_MODEL_ASTRA" },
} as const;

export type ModelProfile = keyof typeof modelProfiles;

export function resolveModelProfile(profile: ModelProfile) {
  const route = modelProfiles[profile];
  if ("model" in route) return { profile, provider: route.provider, model: route.model };
  const model = process.env[route.modelEnv];
  if (!model) throw new Error(`${route.modelEnv} is not configured`);
  return { profile, provider: route.provider, model };
}
