import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireUser } from "./lib/authz";

// Convex Auth creates the row; this provisions Saath-owned profile defaults.
export const ensureCurrent = mutation({
  args: {
    displayName: v.optional(v.string()),
    preferredLanguage: v.optional(v.union(v.literal("en"), v.literal("hi"), v.literal("mr"))),
  },
  handler: async (ctx, args) => {
    const { userId, user } = await requireUser(ctx);
    const displayName = args.displayName?.trim();
    if (displayName !== undefined && (displayName.length < 1 || displayName.length > 100)) throw new Error("Invalid display name");
    const patch = {
      displayName: displayName ?? user.displayName ?? user.name,
      preferredLanguage: args.preferredLanguage ?? user.preferredLanguage ?? ("en" as const),
    };
    await ctx.db.patch(userId, patch);
    return { ...user, ...patch };
  },
});

export const current = query({
  args: {},
  handler: async (ctx) => (await requireUser(ctx)).user,
});
