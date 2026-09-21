import { env } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";

export type AccessStatus = "pending" | "approved" | "blocked";

export function isConfiguredSuperadmin(email: string | undefined) {
  if (!email) return false;
  const normalized = email.trim().toLowerCase();
  return (env.SUPERADMIN_EMAILS?.split(",") ?? [])
    .map((value: string) => value.trim().toLowerCase())
    .filter(Boolean)
    .includes(normalized);
}

export function isSuperadminUser(user: Doc<"users">) {
  return user.platformRole === "superadmin" || isConfiguredSuperadmin(user.email);
}

export function effectiveAccessStatus(user: Doc<"users">): AccessStatus {
  if (isSuperadminUser(user)) return "approved";
  return user.accessStatus ?? "pending";
}
