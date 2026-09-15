import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireInboxItemPermission, requireSpacePermission } from "./lib/authz";

export const list = query({
  args: { spaceId: v.id("spaces"), limit: v.optional(v.number()) },
  handler: async (ctx, { spaceId, limit }) => {
    await requireSpacePermission(ctx, spaceId, "read");
    const candidates = await ctx.db.query("inboxItems").withIndex("by_space_received", q => q.eq("spaceId", spaceId)).order("desc").take(Math.min(Math.max(limit ?? 50, 1), 100));
    const allowed = [];
    for (const item of candidates) {
      if (item.visibility !== "space") continue;
      try {
        await requireInboxItemPermission(ctx, item._id, "read");
        allowed.push(item);
      } catch { /* Deliberately omit unauthorized private/room items. */ }
    }
    return allowed;
  },
});
