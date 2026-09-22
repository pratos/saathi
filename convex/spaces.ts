import { ConvexError, v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { requireSpacePermission, requireUser } from "./lib/authz";
import { isByokProvider, keyLastFour, keyLooksValid, openSecret, sealSecret } from "./lib/byok";
import { isModelTier, resolveModelTier } from "./lib/modelTiers";
import { effectiveAccessStatus, isSuperadminUser } from "./lib/platformAccess";

export const create = mutation({
  args: { name: v.string(), creationKey: v.string() },
  handler: async (ctx, args) => {
    const { userId } = await requireUser(ctx);
    const name = args.name.trim();
    if (name.length < 2 || name.length > 80) {
      throw new ConvexError({ code: "INVALID_ARGUMENT", message: "Family name must be between 2 and 80 characters" });
    }
    if (!/^[A-Za-z0-9_-]{8,128}$/.test(args.creationKey)) {
      throw new ConvexError({ code: "INVALID_ARGUMENT", message: "Invalid creation key" });
    }
    const existing = await ctx.db.query("spaces").withIndex("by_creator_key", q => q.eq("createdBy", userId).eq("creationKey", args.creationKey)).unique();
    if (existing) return existing._id;
    const owned = await ctx.db.query("memberships").withIndex("by_user_status", q => q.eq("userId", userId).eq("status", "active")).take(20);
    const ownedCount = owned.filter(membership => membership.role === "owner").length;
    if (ownedCount >= 3) {
      throw new ConvexError({ code: "FAMILY_LIMIT", message: "You can own up to 3 family spaces" });
    }

    const now = Date.now();
    const spaceId = await ctx.db.insert("spaces", { name, createdBy: userId, creationKey: args.creationKey, createdAt: now });
    await ctx.db.insert("memberships", { spaceId, userId, role: "owner", status: "active", joinedAt: now });
    const roomId = await ctx.db.insert("rooms", {
      spaceId, type: "shared", title: "Family conversation", assistantMode: "mention", createdBy: userId, createdAt: now,
    });
    await ctx.db.insert("roomMembers", { roomId, userId, role: "manager", createdAt: now });
    await ctx.db.insert("auditEvents", {
      spaceId, actorUserId: userId, action: "space.created", resourceType: "space", resourceId: String(spaceId), createdAt: now,
    });
    return spaceId;
  },
});

export const mine = query({
  args: {},
  handler: async (ctx) => {
    const { userId } = await requireUser(ctx);
    const memberships = await ctx.db.query("memberships").withIndex("by_user_status", q => q.eq("userId", userId).eq("status", "active")).collect();
    return Promise.all(memberships.map(async membership => ({ membership, space: await ctx.db.get(membership.spaceId) })));
  },
});

const MAX_FAMILY_MEMBER_SUMMARIES = 100;

export const members = query({
  args: { spaceId: v.id("spaces") },
  returns: v.array(v.object({
    userId: v.id("users"),
    name: v.string(),
    username: v.union(v.string(), v.null()),
    image: v.union(v.string(), v.null()),
    role: v.union(v.literal("owner"), v.literal("member")),
    isCurrentUser: v.boolean(),
  })),
  handler: async (ctx, { spaceId }) => {
    const { userId } = await requireSpacePermission(ctx, spaceId, "read");
    const memberships = await ctx.db.query("memberships")
      .withIndex("by_space_status", q => q.eq("spaceId", spaceId).eq("status", "active"))
      .take(MAX_FAMILY_MEMBER_SUMMARIES);

    return Promise.all(memberships.map(async membership => {
      const member = await ctx.db.get(membership.userId);
      const username = member?.username?.trim() || null;
      const name = member?.displayName?.trim() || member?.name?.trim() || (username ? `@${username}` : "Family member");
      return {
        userId: membership.userId,
        name,
        username,
        image: member?.image ?? null,
        role: membership.role,
        isCurrentUser: membership.userId === userId,
      };
    }));
  },
});

export const prepareInboxCreation = internalQuery({
  args: { spaceId: v.id("spaces") },
  returns: v.object({ name: v.string(), existingInboxId: v.union(v.string(), v.null()) }),
  handler: async (ctx, { spaceId }) => {
    await requireSpacePermission(ctx, spaceId, "configure_inbox");
    const space = await ctx.db.get(spaceId);
    if (!space) throw new ConvexError({ code: "NOT_FOUND", message: "Family space not found" });
    return { name: space.name, existingInboxId: space.agentmailInboxId ?? null };
  },
});

export const aliasTaken = internalQuery({
  args: { username: v.string() },
  returns: v.boolean(),
  handler: async (ctx, { username }) => {
    const existing = await ctx.db.query("spaces").withIndex("by_agentmail_inbox", q => q.eq("agentmailInboxId", username)).unique();
    return existing !== null;
  },
});

export const attachCreatedInbox = internalMutation({
  args: { spaceId: v.id("spaces"), inboxId: v.string(), email: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, { spaceId, inboxId, email }) => {
    const { userId } = await requireSpacePermission(ctx, spaceId, "configure_inbox");
    const space = await ctx.db.get(spaceId);
    if (!space) throw new ConvexError({ code: "NOT_FOUND", message: "Family space not found" });
    if (space.agentmailInboxId) {
      if (space.agentmailInboxId === inboxId) return null;
      throw new ConvexError({ code: "INBOX_ALREADY_CONNECTED", message: "This family already has an inbox" });
    }
    const existing = await ctx.db.query("spaces")
      .withIndex("by_agentmail_inbox", q => q.eq("agentmailInboxId", inboxId))
      .unique();
    if (existing) throw new ConvexError({ code: "INBOX_ALREADY_CONNECTED", message: "This inbox belongs to another family space" });
    await ctx.db.patch(spaceId, { agentmailInboxId: inboxId, agentmailEmail: email });
    await ctx.db.insert("auditEvents", {
      spaceId,
      actorUserId: userId,
      action: "space.inbox_created",
      resourceType: "space",
      resourceId: String(spaceId),
      createdAt: Date.now(),
    });
    return null;
  },
});

const byokProvider = v.union(v.literal("openai"), v.literal("openrouter"), v.literal("codex"));

export const providerKeyStatus = query({
  args: { spaceId: v.id("spaces") },
  returns: v.array(v.object({ provider: byokProvider, lastFour: v.string(), updatedAt: v.number() })),
  handler: async (ctx, { spaceId }) => {
    await requireSpacePermission(ctx, spaceId, "read");
    const rows = await ctx.db.query("providerKeys").withIndex("by_space_provider", q => q.eq("spaceId", spaceId)).take(8);
    return rows.map(row => ({ provider: row.provider, lastFour: row.lastFour, updatedAt: row.updatedAt }));
  },
});

export const aiAccess = query({
  args: { spaceId: v.id("spaces") },
  returns: v.object({
    status: v.union(v.literal("pending"), v.literal("approved"), v.literal("blocked")),
    ready: v.boolean(),
    source: v.union(v.literal("byok"), v.literal("platform"), v.literal("none")),
    hasOpenRouter: v.boolean(),
    isSuperadmin: v.boolean(),
    requestedAt: v.union(v.number(), v.null()),
  }),
  handler: async (ctx, { spaceId }) => {
    const { user } = await requireSpacePermission(ctx, spaceId, "read");
    const rows = await ctx.db.query("providerKeys").withIndex("by_space_provider", q => q.eq("spaceId", spaceId)).take(8);
    const hasOpenRouter = rows.some(row => row.provider === "openrouter");
    const status = effectiveAccessStatus(user);
    const ready = status !== "blocked" && (hasOpenRouter || status === "approved");
    const source: "none" | "byok" | "platform" = !ready ? "none" : hasOpenRouter ? "byok" : "platform";
    return {
      status,
      ready,
      source,
      hasOpenRouter,
      isSuperadmin: isSuperadminUser(user),
      requestedAt: user.accessRequestedAt ?? null,
    };
  },
});

export const saveProviderKey = mutation({
  args: { spaceId: v.id("spaces"), provider: byokProvider, secret: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { userId } = await requireSpacePermission(ctx, args.spaceId, "manage_members");
    if (!isByokProvider(args.provider) || !keyLooksValid(args.provider, args.secret)) {
      throw new ConvexError({ code: "INVALID_ARGUMENT", message: "That does not look like a valid API key." });
    }
    const sealedSecret = await sealSecret(args.secret);
    const lastFour = keyLastFour(args.secret);
    const existing = await ctx.db.query("providerKeys").withIndex("by_space_provider", q =>
      q.eq("spaceId", args.spaceId).eq("provider", args.provider),
    ).unique();
    const now = Date.now();
    if (existing) await ctx.db.patch(existing._id, { sealedSecret, lastFour, updatedBy: userId, updatedAt: now });
    else await ctx.db.insert("providerKeys", {
      spaceId: args.spaceId, provider: args.provider, sealedSecret, lastFour, updatedBy: userId, updatedAt: now,
    });
    await ctx.db.insert("auditEvents", {
      spaceId: args.spaceId, actorUserId: userId, action: "space.provider_key_saved",
      resourceType: "providerKey", resourceId: args.provider, createdAt: now,
    });
    return null;
  },
});

export const removeProviderKey = mutation({
  args: { spaceId: v.id("spaces"), provider: byokProvider },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { userId } = await requireSpacePermission(ctx, args.spaceId, "manage_members");
    const existing = await ctx.db.query("providerKeys").withIndex("by_space_provider", q =>
      q.eq("spaceId", args.spaceId).eq("provider", args.provider),
    ).unique();
    if (existing) await ctx.db.delete(existing._id);
    await ctx.db.insert("auditEvents", {
      spaceId: args.spaceId, actorUserId: userId, action: "space.provider_key_removed",
      resourceType: "providerKey", resourceId: args.provider, createdAt: Date.now(),
    });
    return null;
  },
});

const modelTier = v.union(v.literal("low"), v.literal("med"), v.literal("high"), v.literal("ultra"));

export const setModelTier = mutation({
  args: { spaceId: v.id("spaces"), tier: modelTier },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { userId } = await requireSpacePermission(ctx, args.spaceId, "manage_members");
    if (!isModelTier(args.tier)) throw new ConvexError({ code: "INVALID_ARGUMENT", message: "Unknown model tier" });
    await ctx.db.patch(args.spaceId, { modelTier: args.tier });
    const route = resolveModelTier(args.tier);
    const rooms = await ctx.db.query("rooms").withIndex("by_space", q => q.eq("spaceId", args.spaceId)).take(40);
    for (const room of rooms) {
      const agent = await ctx.db.query("agents").withIndex("by_room", q => q.eq("roomId", room._id)).first();
      if (agent) await ctx.db.patch(agent._id, { model: route.model, updatedAt: Date.now() });
    }
    await ctx.db.insert("auditEvents", {
      spaceId: args.spaceId, actorUserId: userId, action: "space.model_tier_changed",
      resourceType: "space", resourceId: args.tier, createdAt: Date.now(),
    });
    return null;
  },
});

export const usageBreakdown = query({
  args: { spaceId: v.id("spaces") },
  returns: v.object({
    tier: modelTier,
    model: v.string(),
    rows: v.array(v.object({
      provider: v.string(), model: v.string(), unit: v.string(), quantity: v.number(), costUsd: v.optional(v.number()), costClass: v.string(),
    })),
    entries: v.array(v.object({
      _id: v.id("usageLedger"),
      createdAt: v.number(),
      provider: v.string(),
      model: v.string(),
      unit: v.string(),
      quantity: v.number(),
      costUsd: v.optional(v.number()),
      costClass: v.string(),
    })),
  }),
  handler: async (ctx, { spaceId }) => {
    await requireSpacePermission(ctx, spaceId, "manage_members");
    const space = await ctx.db.get(spaceId);
    const tier = resolveModelTier(space?.modelTier);
    const ledger = await ctx.db.query("usageLedger").withIndex("by_space_created", q => q.eq("spaceId", spaceId)).order("desc").take(200);
    const grouped = new Map<string, { provider: string; model: string; unit: string; quantity: number; costUsd?: number; costClass: string }>();
    for (const row of ledger) {
      const model = row.model ?? "unknown";
      const key = `${row.provider}|${model}|${row.unit}|${row.costClass}`;
      const existing = grouped.get(key);
      if (existing) {
        existing.quantity += row.quantity;
        if (row.costUsd !== undefined) existing.costUsd = (existing.costUsd ?? 0) + row.costUsd;
      } else grouped.set(key, { provider: row.provider, model, unit: row.unit, quantity: row.quantity, costUsd: row.costUsd, costClass: row.costClass });
    }
    return {
      tier: tier.id,
      model: tier.model,
      rows: [...grouped.values()],
      entries: ledger.slice(0, 40).map(row => ({
        _id: row._id,
        createdAt: row.createdAt,
        provider: row.provider,
        model: row.model ?? "unknown",
        unit: row.unit,
        quantity: row.quantity,
        costUsd: row.costUsd,
        costClass: row.costClass,
      })),
    };
  },
});

export const resolveDecisionCredential = internalQuery({
  args: { spaceId: v.id("spaces"), userId: v.id("users") },
  returns: v.object({
    ownedOpenRouterSecret: v.union(v.string(), v.null()),
    openRouterModel: v.string(),
    platformAllowed: v.boolean(),
    blocked: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const [user, membership, space] = await Promise.all([
      ctx.db.get(args.userId),
      ctx.db.query("memberships").withIndex("by_space_user", q =>
        q.eq("spaceId", args.spaceId).eq("userId", args.userId),
      ).unique(),
      ctx.db.get(args.spaceId),
    ]);
    const openRouterModel = resolveModelTier(space?.modelTier).model;
    if (!user || !membership || membership.status !== "active") {
      return { ownedOpenRouterSecret: null, openRouterModel, platformAllowed: false, blocked: true };
    }
    const status = effectiveAccessStatus(user);
    if (status === "blocked") {
      return { ownedOpenRouterSecret: null, openRouterModel, platformAllowed: false, blocked: true };
    }
    const row = await ctx.db.query("providerKeys").withIndex("by_space_provider", q =>
      q.eq("spaceId", args.spaceId).eq("provider", "openrouter"),
    ).unique();
    return {
      ownedOpenRouterSecret: row ? await openSecret(row.sealedSecret) : null,
      openRouterModel,
      platformAllowed: status === "approved",
      blocked: false,
    };
  },
});

export const resolveProviderCredential = internalQuery({
  args: { spaceId: v.id("spaces"), userId: v.id("users"), provider: byokProvider },
  returns: v.object({
    ownedSecret: v.union(v.string(), v.null()),
    platformAllowed: v.boolean(),
    blocked: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const [user, membership] = await Promise.all([
      ctx.db.get(args.userId),
      ctx.db.query("memberships").withIndex("by_space_user", q =>
        q.eq("spaceId", args.spaceId).eq("userId", args.userId),
      ).unique(),
    ]);
    if (!user || !membership || membership.status !== "active") {
      return { ownedSecret: null, platformAllowed: false, blocked: true };
    }
    const status = effectiveAccessStatus(user);
    if (status === "blocked") return { ownedSecret: null, platformAllowed: false, blocked: true };
    const row = await ctx.db.query("providerKeys").withIndex("by_space_provider", q =>
      q.eq("spaceId", args.spaceId).eq("provider", args.provider),
    ).unique();
    return {
      ownedSecret: row ? await openSecret(row.sealedSecret) : null,
      platformAllowed: status === "approved",
      blocked: false,
    };
  },
});
