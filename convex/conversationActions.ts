import { ConvexError, v } from "convex/values";
import { internalMutation, mutation } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import type { ConversationAction } from "./lib/assistantCapabilities";
import { normalizeMemoryKey } from "./lib/agentMemory";
import { requireRoomPermission } from "./lib/authz";
import { imagePreset, imageStyleValidator } from "./lib/imageSafety";
import { MODEL_TIERS } from "./lib/modelTiers";

const language = v.union(v.literal("en"), v.literal("hi"), v.literal("mr"));
const currency = v.union(v.literal("INR"), v.literal("USD"));
const modelTier = v.union(v.literal("low"), v.literal("med"), v.literal("high"), v.literal("ultra"));

export const conversationAction = v.union(
  v.object({ type: v.literal("set_language"), language }),
  v.object({ type: v.literal("set_image_style"), style: imageStyleValidator }),
  v.object({ type: v.literal("set_food_budget"), amount: v.number(), currency }),
  v.object({ type: v.literal("set_model_tier"), tier: modelTier }),
  v.object({ type: v.literal("remember"), key: v.string(), value: v.string() }),
  v.object({ type: v.literal("recall"), key: v.string() }),
);

const result = v.object({ ok: v.boolean(), message: v.string() });

export const execute = mutation({
  args: { roomId: v.id("rooms"), action: conversationAction },
  returns: result,
  handler: async (ctx, { roomId, action }) => {
    const { userId, membership, room } = await requireRoomPermission(ctx, roomId, "post_message");
    const agent = await ctx.db.query("agents").withIndex("by_room", q => q.eq("roomId", roomId)).first();
    return applyConversationAction(ctx, room.spaceId, userId, membership.role, agent?._id ?? null, action);
  },
});

export const executeForJob = internalMutation({
  args: {
    agentId: v.id("agents"),
    jobId: v.id("agentJobs"),
    leaseId: v.string(),
    action: conversationAction,
  },
  returns: result,
  handler: async (ctx, args) => {
    const [agent, job] = await Promise.all([ctx.db.get(args.agentId), ctx.db.get(args.jobId)]);
    if (!agent || !job || job.agentId !== agent._id || job.status !== "running" || job.leaseId !== args.leaseId) {
      throw new ConvexError({ code: "FORBIDDEN", message: "This Saathi request is no longer active." });
    }
    const [room, membership, roomMember] = await Promise.all([
      ctx.db.get(agent.roomId),
      ctx.db.query("memberships").withIndex("by_space_user", q =>
        q.eq("spaceId", agent.spaceId).eq("userId", job.requestedBy),
      ).unique(),
      ctx.db.query("roomMembers").withIndex("by_room_user", q =>
        q.eq("roomId", agent.roomId).eq("userId", job.requestedBy),
      ).unique(),
    ]);
    if (room?.spaceId !== agent.spaceId || !membership || membership.status !== "active" || !roomMember || roomMember.role === "viewer") {
      throw new ConvexError({ code: "FORBIDDEN", message: "You no longer have permission to change this setting." });
    }
    return applyConversationAction(ctx, agent.spaceId, job.requestedBy, membership.role, agent._id, args.action);
  },
});

async function applyConversationAction(
  ctx: MutationCtx,
  spaceId: Id<"spaces">,
  userId: Id<"users">,
  role: "owner" | "member",
  agentId: Id<"agents"> | null,
  action: ConversationAction,
) {
  if (action.type === "set_language") {
    await ctx.db.patch(userId, { preferredLanguage: action.language });
    return { ok: true, message: `Your reading language is now ${languageLabel(action.language)}.` };
  }
  if (action.type === "set_image_style") {
    await ctx.db.patch(userId, { preferredImageStyle: action.style });
    return { ok: true, message: `Your default image style is now ${imagePreset(action.style).label}.` };
  }
  if (action.type === "remember" || action.type === "recall") {
    if (!agentId) return { ok: false, message: "Saathi memory is not available in this conversation yet." };
    const key = normalizeMemoryKey(action.key);
    if (!key || key.length > 100) return { ok: false, message: "Use a short memory label under 100 characters." };
    const existing = await ctx.db.query("agentMemory").withIndex("by_agent_key", q =>
      q.eq("agentId", agentId).eq("key", key),
    ).unique();
    if (action.type === "recall") {
      return existing
        ? { ok: true, message: `${existing.key}: ${existing.value}` }
        : { ok: false, message: `I don't have a saved fact for “${key}”.` };
    }
    const value = action.value.trim();
    if (!value || value.length > 10_000) return { ok: false, message: "A remembered fact must be between 1 and 10,000 characters." };
    const now = Date.now();
    if (existing) await ctx.db.patch(existing._id, { value, updatedAt: now });
    else await ctx.db.insert("agentMemory", { agentId, key, value, updatedAt: now });
    return { ok: true, message: `I'll remember ${key}: ${value}` };
  }
  if (role !== "owner") {
    return { ok: false, message: "Only a family owner can change family-wide settings." };
  }
  if (action.type === "set_food_budget") {
    const min = action.currency === "USD" ? 20 : 500;
    const max = action.currency === "USD" ? 20_000 : 1_000_000;
    if (!Number.isFinite(action.amount) || action.amount < min || action.amount > max) {
      return {
        ok: false,
        message: action.currency === "USD"
          ? "Choose a monthly food budget between $20 and $20,000."
          : "Choose a monthly food budget between ₹500 and ₹10,00,000.",
      };
    }
    const existing = await ctx.db.query("familyBudgets").withIndex("by_space_category", q =>
      q.eq("spaceId", spaceId).eq("category", "food"),
    ).unique();
    const now = Date.now();
    if (existing) await ctx.db.patch(existing._id, { monthlyLimit: action.amount, currency: action.currency, updatedBy: userId, updatedAt: now });
    else await ctx.db.insert("familyBudgets", {
      spaceId, category: "food", monthlyLimit: action.amount, currency: action.currency, updatedBy: userId, updatedAt: now,
    });
    const symbol = action.currency === "USD" ? "$" : "₹";
    return { ok: true, message: `The family food budget is now ${symbol}${action.amount.toLocaleString("en-IN")} per month.` };
  }

  await ctx.db.patch(spaceId, { modelTier: action.tier });
  const rooms = await ctx.db.query("rooms").withIndex("by_space", q => q.eq("spaceId", spaceId)).take(40);
  for (const room of rooms) {
    const agent = await ctx.db.query("agents").withIndex("by_room", q => q.eq("roomId", room._id)).first();
    if (agent) await ctx.db.patch(agent._id, { model: MODEL_TIERS[action.tier].model, updatedAt: Date.now() });
  }
  return { ok: true, message: `Saathi's family thinking level is now ${MODEL_TIERS[action.tier].label}.` };
}

function languageLabel(value: "en" | "hi" | "mr") {
  return value === "hi" ? "Hindi" : value === "mr" ? "Marathi" : "English";
}
