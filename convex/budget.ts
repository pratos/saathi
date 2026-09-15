import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireSpacePermission } from "./lib/authz";

export const food = query({
  args: { spaceId: v.id("spaces") },
  handler: async (ctx, { spaceId }) => {
    await requireSpacePermission(ctx, spaceId, "read");
    const budget = await ctx.db.query("familyBudgets").withIndex("by_space_category", q => q.eq("spaceId", spaceId).eq("category", "food")).unique();
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const spentAt = monthStart.getTime();
    const rows = await ctx.db.query("familySpend").withIndex("by_space_category_spent", q => q.eq("spaceId", spaceId).eq("category", "food")).order("desc").take(100);
    const spentThisMonth = rows.filter(row => row.spentAt >= spentAt).reduce((total, row) => total + row.amount, 0);
    return {
      monthlyLimit: budget?.monthlyLimit ?? null,
      spentThisMonth,
      remaining: budget ? Math.max(0, budget.monthlyLimit - spentThisMonth) : null,
      currency: "INR" as const,
    };
  },
});

export const setFoodLimit = mutation({
  args: { spaceId: v.id("spaces"), monthlyLimit: v.number() },
  returns: v.id("familyBudgets"),
  handler: async (ctx, { spaceId, monthlyLimit }) => {
    const { userId } = await requireSpacePermission(ctx, spaceId, "manage_members");
    if (!Number.isFinite(monthlyLimit) || monthlyLimit < 500 || monthlyLimit > 1_000_000) {
      throw new ConvexError({ code: "INVALID_ARGUMENT", message: "Set a monthly food budget between ₹500 and ₹10,00,000" });
    }
    const existing = await ctx.db.query("familyBudgets").withIndex("by_space_category", q => q.eq("spaceId", spaceId).eq("category", "food")).unique();
    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, { monthlyLimit, updatedBy: userId, updatedAt: now });
      return existing._id;
    }
    return await ctx.db.insert("familyBudgets", {
      spaceId, category: "food", monthlyLimit, currency: "INR", updatedBy: userId, updatedAt: now,
    });
  },
});
