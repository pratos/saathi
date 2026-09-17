import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireUser } from "./lib/authz";
import { imageStyleValidator } from "./lib/imageSafety";
import { validateUsername } from "./lib/usernames";

// Convex Auth creates the row; this provisions Saath-owned profile defaults.
export const ensureCurrent = mutation({
  args: {
    displayName: v.optional(v.string()),
    preferredLanguage: v.optional(v.union(v.literal("en"), v.literal("hi"), v.literal("mr"))),
    preferredImageStyle: v.optional(imageStyleValidator),
  },
  handler: async (ctx, args) => {
    const { userId, user } = await requireUser(ctx);
    const displayName = args.displayName?.trim();
    if (displayName !== undefined && (displayName.length < 1 || displayName.length > 100)) throw new Error("Invalid display name");
    const patch = {
      displayName: displayName ?? user.displayName ?? user.name,
      preferredLanguage: args.preferredLanguage ?? user.preferredLanguage ?? ("en" as const),
      preferredImageStyle: args.preferredImageStyle ?? user.preferredImageStyle ?? ("warm_family" as const),
    };
    await ctx.db.patch(userId, patch);
    return { ...user, ...patch };
  },
});

export const current = query({
  args: {},
  handler: async (ctx) => (await requireUser(ctx)).user,
});

export const setUsername = mutation({
  args: { username: v.string() },
  returns: v.string(),
  handler: async (ctx, args) => {
    const { userId } = await requireUser(ctx);
    const username = validateUsername(args.username);
    const collision = await ctx.db.query("usernameClaims")
      .withIndex("by_normalized", q => q.eq("normalized", username))
      .unique();
    if (collision && collision.userId !== userId) {
      throw new ConvexError({ code: "USERNAME_TAKEN", message: "That username is already taken" });
    }

    const currentClaim = await ctx.db.query("usernameClaims")
      .withIndex("by_user_id", q => q.eq("userId", userId))
      .unique();
    if (!collision) {
      await ctx.db.insert("usernameClaims", { normalized: username, userId, claimedAt: Date.now() });
    }
    if (currentClaim && currentClaim.normalized !== username) await ctx.db.delete(currentClaim._id);
    await ctx.db.patch(userId, { username });
    return username;
  },
});
