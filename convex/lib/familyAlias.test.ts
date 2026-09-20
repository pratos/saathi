import { describe, expect, test } from "vitest";
import { suggestFamilyAlias, validateFamilyAlias } from "./familyAlias.js";

describe("family email aliases", () => {
  test("suggests a lowercase hyphenated alias from the family name", () => {
    expect(suggestFamilyAlias("Parents’ home")).toBe("parents-home");
    expect(suggestFamilyAlias("The Kapoor Family")).toBe("the-kapoor-family");
  });

  test("rejects reserved or malformed aliases", () => {
    expect(() => validateFamilyAlias("Saathi")).toThrow(/ALIAS_INVALID|reserved|hyphen/i);
    expect(() => validateFamilyAlias("a")).toThrow(/ALIAS_INVALID|3 to 32/i);
    expect(() => validateFamilyAlias("-kapoor")).toThrow(/ALIAS_INVALID/i);
    expect(validateFamilyAlias("Kapoor-Family")).toBe("kapoor-family");
  });
});
