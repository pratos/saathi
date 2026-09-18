import { ConvexError, v } from "convex/values";
import { internalMutation, mutation } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import type { ConversationAction } from "./lib/assistantCapabilities";
import { normalizeMemoryKey } from "./lib/agentMemory";
import { requireRoomPermission } from "./lib/authz";
import { imagePreset, imageStyleValidator } from "./lib/imageSafety";
import { containsProhibitedSecret } from "./lib/memoryTriage";
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
  v.object({ type: v.literal("forget_memory"), key: v.string() }),
  v.object({ type: v.literal("list_memories") }),
  v.object({ type: v.literal("get_food_budget") }),
  v.object({ type: v.literal("find_room_files"), query: v.string() }),
  v.object({ type: v.literal("search_family_inbox"), query: v.string() }),
);

const result = v.object({ ok: v.boolean(), message: v.string() });

export const execute = mutation({
  args: { roomId: v.id("rooms"), action: conversationAction },
  returns: result,
  handler: async (ctx, { roomId, action }) => {
    const { userId, membership, room } = await requireRoomPermission(ctx, roomId, "post_message");
    const agent = await ctx.db.query("agents").withIndex("by_room", q => q.eq("roomId", roomId)).first();
    return applyConversationAction(ctx, room.spaceId, room._id, userId, membership.role, agent?._id ?? null, action);
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
    return applyConversationAction(ctx, agent.spaceId, agent.roomId, job.requestedBy, membership.role, agent._id, args.action);
  },
});

async function applyConversationAction(
  ctx: MutationCtx,
  spaceId: Id<"spaces">,
  roomId: Id<"rooms">,
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
  if (action.type === "remember" || action.type === "recall" || action.type === "forget_memory" || action.type === "list_memories") {
    if (!agentId) return { ok: false, message: "Saathi memory is not available in this conversation yet." };
    if (action.type === "list_memories") {
      const memories = await ctx.db.query("agentMemory").withIndex("by_agent_updated", q => q.eq("agentId", agentId)).order("desc").take(20);
      return memories.length
        ? { ok: true, message: memories.map(memory => `${memory.key}: ${memory.value}`).join("\n") }
        : { ok: true, message: "I don't have any explicitly remembered facts in this conversation." };
    }
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
    if (action.type === "forget_memory") {
      if (!existing) return { ok: false, message: `I don't have a saved fact for “${key}”.` };
      await ctx.db.delete(existing._id);
      return { ok: true, message: `I forgot the saved fact “${key}”.` };
    }
    const value = action.value.trim();
    if (!value || value.length > 10_000) return { ok: false, message: "A remembered fact must be between 1 and 10,000 characters." };
    if (containsProhibitedSecret(`${key} ${value}`)) {
      return { ok: false, message: "I can't retain passwords, OTPs, API keys, payment credentials, or exact account identifiers." };
    }
    const now = Date.now();
    if (existing) await ctx.db.patch(existing._id, { value, updatedAt: now });
    else await ctx.db.insert("agentMemory", { agentId, key, value, updatedAt: now });
    return { ok: true, message: `I'll remember ${key}: ${value}` };
  }
  if (action.type === "get_food_budget") {
    const budget = await ctx.db.query("familyBudgets").withIndex("by_space_category", q => q.eq("spaceId", spaceId).eq("category", "food")).unique();
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const spending = await ctx.db.query("familySpend").withIndex("by_space_category_spent", q =>
      q.eq("spaceId", spaceId).eq("category", "food"),
    ).order("desc").take(100);
    const spent = spending.filter(row => row.spentAt >= monthStart.getTime()).reduce((total, row) => total + row.amount, 0);
    const currency = budget?.currency ?? "INR";
    const symbol = currency === "USD" ? "$" : "₹";
    if (!budget) return { ok: true, message: `${symbol}${spent.toLocaleString("en-IN")} in food spending is tracked this month. No monthly limit is set.` };
    const remaining = Math.max(0, budget.monthlyLimit - spent);
    return { ok: true, message: `Food budget: ${symbol}${spent.toLocaleString("en-IN")} spent of ${symbol}${budget.monthlyLimit.toLocaleString("en-IN")}; ${symbol}${remaining.toLocaleString("en-IN")} remaining.` };
  }
  if (action.type === "find_room_files") {
    const query = searchQuery(action.query);
    if (!query) return { ok: false, message: "Describe the file you want to find." };
    const files = await ctx.db.query("attachments").withIndex("by_room_created", q => q.eq("roomId", roomId)).order("desc").take(40);
    const matches = files.filter(file => searchable(file.fileName, file.transcript).includes(query)).slice(0, 8);
    return matches.length
      ? { ok: true, message: matches.map(file => `${file.fileName}${file.transcript ? ` — ${file.transcript.slice(0, 240)}` : ""}`).join("\n") }
      : { ok: false, message: `I couldn't find a file matching “${action.query.trim()}” in this conversation.` };
  }
  if (action.type === "search_family_inbox") {
    const query = searchQuery(action.query);
    if (!query) return { ok: false, message: "Describe the saved email you want to find." };
    const items = await ctx.db.query("inboxItems").withIndex("by_space_received", q => q.eq("spaceId", spaceId)).order("desc").take(100);
    const visible = items.filter(item => item.visibility === "space"
      || (item.visibility === "room" && item.roomId === roomId)
      || (item.visibility === "private" && item.roomId === roomId && item.privateOwnerId === userId));
    const matches = visible.filter(item => searchable(item.sender, item.subject, item.originalText, item.extractedMerchant).includes(query)).slice(0, 8);
    return matches.length
      ? { ok: true, message: matches.map(item => `${item.subject} — ${item.sender}${item.extractedAmount ? ` — ${item.extractedAmount}` : ""}`).join("\n") }
      : { ok: false, message: `I couldn't find a visible saved email matching “${action.query.trim()}”.` };
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

function searchQuery(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase().slice(0, 200);
}

function searchable(...values: Array<string | undefined>) {
  return values.filter(Boolean).join(" ").replace(/\s+/g, " ").toLocaleLowerCase();
}
