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
      currency: budget?.currency ?? "INR",
    };
  },
});

export const setFoodLimit = mutation({
  args: { spaceId: v.id("spaces"), monthlyLimit: v.number(), currency: v.optional(v.union(v.literal("INR"), v.literal("USD"))) },
  returns: v.id("familyBudgets"),
  handler: async (ctx, { spaceId, monthlyLimit, currency }) => {
    const { userId } = await requireSpacePermission(ctx, spaceId, "manage_members");
    const chosen = currency ?? "INR";
    const min = chosen === "USD" ? 20 : 500;
    const max = chosen === "USD" ? 20_000 : 1_000_000;
    if (!Number.isFinite(monthlyLimit) || monthlyLimit < min || monthlyLimit > max) {
      throw new ConvexError({ code: "INVALID_ARGUMENT", message: chosen === "USD" ? "Set a monthly food budget between $20 and $20,000" : "Set a monthly food budget between ₹500 and ₹10,00,000" });
    }
    const existing = await ctx.db.query("familyBudgets").withIndex("by_space_category", q => q.eq("spaceId", spaceId).eq("category", "food")).unique();
    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, { monthlyLimit, currency: chosen, updatedBy: userId, updatedAt: now });
      return existing._id;
    }
    return await ctx.db.insert("familyBudgets", {
      spaceId, category: "food", monthlyLimit, currency: chosen, updatedBy: userId, updatedAt: now,
    });
  },
});
