import { describe, expect, test } from "vitest";

const TOOL_COUNT = 200;
const BUNDLE_COUNT = 20;
const TOOLS_PER_BUNDLE = TOOL_COUNT / BUNDLE_COUNT;

describe("hierarchical tool routing scale benchmark", () => {
  test("reduces a 200-tool catalog to one bounded domain bundle", () => {
    const tools = Array.from({ length: TOOL_COUNT }, (_, index) => ({
      type: "function",
      name: `domain_${Math.floor(index / TOOLS_PER_BUNDLE) + 1}_action_${index + 1}`,
      description: `Perform authorized household action ${index + 1} in domain ${Math.floor(index / TOOLS_PER_BUNDLE) + 1}. Never exceed the caller's permissions.`,
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "The specific target or value supplied by the caller." },
          confirmed: { type: "boolean", description: "Whether required confirmation was explicitly supplied." },
        },
        required: ["query"],
        additionalProperties: false,
      },
    }));
    const selectedBundle = tools.slice(70, 70 + TOOLS_PER_BUNDLE);
    const fullTokens = estimatedTokens(tools);
    const bundleTokens = estimatedTokens(selectedBundle);
    const reduction = 1 - bundleTokens / fullTokens;

    console.info(JSON.stringify({
      benchmark: "tool-scale",
      toolCount: TOOL_COUNT,
      bundleCount: BUNDLE_COUNT,
      selectedToolCount: selectedBundle.length,
      estimatedFullSchemaTokens: fullTokens,
      estimatedBundleSchemaTokens: bundleTokens,
      schemaTokenReduction: reduction,
      cacheVariants: BUNDLE_COUNT,
    }));

    expect(selectedBundle).toHaveLength(10);
    expect(reduction).toBeGreaterThan(0.94);
  });
});

function estimatedTokens(value: unknown) {
  return Math.ceil(JSON.stringify(value).length / 4);
}
