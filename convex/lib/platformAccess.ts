import { env } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";

export type AccessStatus = "pending" | "approved" | "blocked";

function normalizedEmailMatches(email: string | undefined, configured: string[]) {
  if (!email) return false;
  const normalized = email.trim().toLowerCase();
  return configured
    .map((value: string) => value.trim().toLowerCase())
    .filter(Boolean)
    .includes(normalized);
}

export function isConfiguredPermanentSuperadmin(email: string | undefined) {
  return normalizedEmailMatches(email, env.SUPERADMIN_EMAILS?.split(",") ?? []);
}

export function isConfiguredAdminReviewer(email: string | undefined) {
  return Boolean(env.ADMIN_REVIEW_CODE_SHA256?.trim())
    && normalizedEmailMatches(email, [env.ADMIN_REVIEW_EMAIL ?? ""]);
}

export function isSuperadminUser(user: Doc<"users">) {
  return user.platformRole === "superadmin"
    || isConfiguredPermanentSuperadmin(user.email)
    || (user.adminReviewer === true && isConfiguredAdminReviewer(user.email));
}

export function effectiveAccessStatus(user: Doc<"users">): AccessStatus {
  if (isSuperadminUser(user)) return "approved";
  return user.accessStatus ?? "pending";
}
