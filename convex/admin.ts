import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { requireUser } from "./lib/authz";
import { effectiveAccessStatus, isSuperadminUser } from "./lib/platformAccess";

const accessStatus = v.union(v.literal("pending"), v.literal("approved"), v.literal("blocked"));

async function requireSuperadmin(ctx: QueryCtx | MutationCtx) {
  const principal = await requireUser(ctx);
  if (!isSuperadminUser(principal.user)) {
    throw new ConvexError({ code: "FORBIDDEN", message: "Superadmin access required" });
  }
  return principal;
}

export const currentRole = query({
  args: {},
  returns: v.object({ isSuperadmin: v.boolean() }),
  handler: async (ctx) => ({ isSuperadmin: isSuperadminUser((await requireUser(ctx)).user) }),
});

export const listUsers = query({
  args: {},
  returns: v.array(v.object({
    _id: v.id("users"),
    createdAt: v.number(),
    email: v.string(),
    name: v.string(),
    status: accessStatus,
    requestedAt: v.union(v.number(), v.null()),
    reviewedAt: v.union(v.number(), v.null()),
    note: v.union(v.string(), v.null()),
    isSuperadmin: v.boolean(),
  })),
  handler: async (ctx) => {
    await requireSuperadmin(ctx);
    const users = await ctx.db.query("users").order("desc").take(200);
    return users.map(user => ({
      _id: user._id,
      createdAt: user._creationTime,
      email: user.email ?? "No email",
      name: user.displayName ?? user.name ?? user.username ?? "New account",
      status: effectiveAccessStatus(user),
      requestedAt: user.accessRequestedAt ?? null,
      reviewedAt: user.accessReviewedAt ?? null,
      note: user.accessNote ?? null,
      isSuperadmin: isSuperadminUser(user),
    }));
  },
});

export const setAccessStatus = mutation({
  args: { userId: v.id("users"), status: accessStatus, note: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { userId: reviewerId } = await requireSuperadmin(ctx);
    const user = await ctx.db.get(args.userId);
    if (!user) throw new ConvexError({ code: "NOT_FOUND", message: "User not found" });
    if (isSuperadminUser(user) && args.status !== "approved") {
      throw new ConvexError({ code: "INVALID_ARGUMENT", message: "A superadmin cannot be blocked" });
    }
    const note = args.note?.trim();
    if (note && note.length > 500) throw new ConvexError({ code: "INVALID_ARGUMENT", message: "Note is too long" });
    const now = Date.now();
    await ctx.db.patch(args.userId, {
      accessStatus: args.status,
      accessReviewedAt: now,
      accessReviewedBy: reviewerId,
      accessNote: note || undefined,
    });
    await ctx.db.insert("auditEvents", {
      actorUserId: reviewerId,
      action: `admin.access_${args.status}`,
      resourceType: "user",
      resourceId: String(args.userId),
      metadata: note ? { note } : undefined,
      createdAt: now,
    });
    return null;
  },
});
