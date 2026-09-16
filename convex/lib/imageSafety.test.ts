import { describe, expect, test } from "vitest";
import { composeFamilyImagePrompt, familySafeImageFailure, imageCaption, IMAGE_PRESETS } from "./imageSafety";

describe("family image safety", () => {
  test("blocks sexual, child-sexual, and graphic requests", () => {
    expect(familySafeImageFailure("nude portrait")).toBe("Saathi only creates family-safe images. That request is not allowed.");
    expect(familySafeImageFailure("child porn")).toBe("Saathi cannot create sexual or suggestive images involving children.");
    expect(familySafeImageFailure("erotic scene with a teenager")).toBe("Saathi only creates family-safe images. That request is not allowed.");
    expect(familySafeImageFailure("graphic violence")).toBe("Saathi cannot create graphic or violent images.");
    expect(familySafeImageFailure("Hindi infographic about saving water")).toBeNull();
  });

  test("adds infographic, devotional, and language directions without storing secrets", () => {
    const infographic = composeFamilyImagePrompt({
      prompt: "How to sort kitchen waste",
      kind: "infographic",
      style: "infographic",
      language: "hi",
    });
    expect(infographic).toContain("How to sort kitchen waste");
    expect(infographic).toContain("Hindi");
    expect(infographic).toContain("infographic");
    expect(infographic).toContain("Family-safe");

    const aarti = composeFamilyImagePrompt({
      prompt: "Quiet evening aarti at home",
      kind: "devotional",
      style: "devotional",
      language: "mr",
    });
    expect(aarti).toContain("devotional");
    expect(aarti).toContain("Marathi");
    expect(aarti.toLowerCase()).not.toContain("nude");
    expect(() => composeFamilyImagePrompt({ prompt: "pornographic temple art", kind: "devotional" })).toThrow(/family-safe/i);
    expect(imageCaption("Waste sorting", "infographic", "hi")).toContain("Infographic · Hindi");
    expect(IMAGE_PRESETS).toHaveLength(20);
    expect(composeFamilyImagePrompt({ prompt: "Our Diwali snapshots", style: "family_collage" })).toContain("collage");
    expect(composeFamilyImagePrompt({ prompt: "Kids chore chart", style: "kids_chart", kind: "infographic", language: "hi" })).toContain("Child-friendly");
    expect(composeFamilyImagePrompt({ prompt: "Evening lamps", style: "diya_aarti", kind: "devotional", language: "mr" })).toContain("aarti");
    expect(composeFamilyImagePrompt({ prompt: "Folk wall hanging", style: "folk_art" })).toContain("folk-art");
  });
});
