import { ConvexError } from "convex/values";

export const FAMILY_ALIAS_MIN_LENGTH = 3;
export const FAMILY_ALIAS_MAX_LENGTH = 32;

const FAMILY_ALIAS_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const RESERVED_FAMILY_ALIASES = new Set([
  "admin", "family", "help", "mail", "postmaster", "saath", "saathi", "support", "www",
]);

export function normalizeFamilyAlias(value: string) {
  return value.trim().toLowerCase().replace(/^@+/, "").replace(/@.*$/, "");
}

export function suggestFamilyAlias(name: string) {
  const slug = name
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, FAMILY_ALIAS_MAX_LENGTH)
    .replace(/-+$/g, "");
  if (!slug || !FAMILY_ALIAS_PATTERN.test(slug) || RESERVED_FAMILY_ALIASES.has(slug)) return "";
  return slug;
}

export function validateFamilyAlias(value: string) {
  const username = normalizeFamilyAlias(value);
  if (username.length < FAMILY_ALIAS_MIN_LENGTH || username.length > FAMILY_ALIAS_MAX_LENGTH) {
    throw new ConvexError({ code: "ALIAS_INVALID", message: "Use 3 to 32 characters" });
  }
  if (!FAMILY_ALIAS_PATTERN.test(username) || RESERVED_FAMILY_ALIASES.has(username)) {
    throw new ConvexError({ code: "ALIAS_INVALID", message: "Start with a letter. Use lowercase letters, numbers, and single hyphens." });
  }
  return username;
}
