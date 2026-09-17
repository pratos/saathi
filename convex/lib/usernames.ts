import { ConvexError } from "convex/values";

export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 24;

const USERNAME_PATTERN = /^[a-z][a-z0-9_]*$/;
const RESERVED_USERNAMES = new Set([
  "admin",
  "everyone",
  "here",
  "moderator",
  "saath",
  "saathi",
  "support",
  "system",
]);

export function normalizeUsername(value: string) {
  return value.trim().replace(/^@+/, "").toLowerCase();
}

export function validateUsername(value: string) {
  const username = normalizeUsername(value);
  if (username.length < USERNAME_MIN_LENGTH || username.length > USERNAME_MAX_LENGTH) {
    throw new ConvexError({ code: "USERNAME_INVALID", message: "Use 3 to 24 characters" });
  }
  if (!USERNAME_PATTERN.test(username)) {
    throw new ConvexError({ code: "USERNAME_INVALID", message: "Start with a letter and use only letters, numbers, or underscores" });
  }
  if (RESERVED_USERNAMES.has(username)) {
    throw new ConvexError({ code: "USERNAME_RESERVED", message: "That username is reserved" });
  }
  return username;
}
