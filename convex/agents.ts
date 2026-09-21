import { MINUTE, RateLimiter } from "@convex-dev/rate-limiter";
import { ConvexError, v } from "convex/values";
import { components, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { buildAgentMemoryContext, recordAgentEpisode } from "./lib/agentMemory";
import { requireAiAccess, requireRoomPermission } from "./lib/authz";
import { profileNameForUser } from "./lib/firecrawlInteract";
import { imageKindValidator, imageLanguageValidator, imageStyleValidator } from "./lib/imageSafety";
import { isNoReplyText } from "./lib/saathi";

const MAX_CONTEXT_MESSAGES = 200;
const MAX_CONTEXT_CHARS = 60_000;
const MAX_JOB_ATTEMPTS = 3;

const limits = new RateLimiter(components.rateLimiter, {
  promptAgent: { kind: "token bucket", rate: 20, period: MINUTE, capacity: 5 },
});

const agentStatus = v.union(v.literal("idle"), v.literal("running"));
const jobStatus = v.union(v.literal("queued"), v.literal("running"), v.literal("complete"), v.literal("failed"));
const agentDoc = v.object({
  _id: v.id("agents"), _creationTime: v.number(), spaceId: v.id("spaces"), roomId: v.id("rooms"),
  createdBy: v.id("users"), creationKey: v.string(), name: v.string(), systemPrompt: v.string(),
  provider: v.literal("openrouter"), model: v.string(), status: agentStatus,
  lastError: v.optional(v.string()), createdAt: v.number(), updatedAt: v.number(),
});
const jobDoc = v.object({
  _id: v.id("agentJobs"), _creationTime: v.number(), agentId: v.id("agents"), requestedBy: v.id("users"),
  prompt: v.string(), clientOperationId: v.string(), status: jobStatus, attempt: v.number(),
  leaseId: v.optional(v.string()), createdAt: v.number(), startedAt: v.optional(v.number()),
  completedAt: v.optional(v.number()), error: v.optional(v.string()), responseText: v.optional(v.string()),
  trigger: v.optional(v.union(v.literal("mention"), v.literal("ambient"), v.literal("automatic"))),
  activity: v.optional(v.union(v.literal("searching_web"), v.literal("generating_image"), v.literal("using_computer"))),
  computerLiveViewUrl: v.optional(v.string()),
  computerInteractiveLiveViewUrl: v.optional(v.string()),
});
const workItem = v.object({
  agent: agentDoc,
  job: jobDoc,
  messages: v.array(v.any()),
  memoryContext: v.string(),
  requesterRole: v.union(v.literal("owner"), v.literal("member")),
  memoryPolicyContext: v.object({
    roomType: v.union(v.literal("private"), v.literal("shared"), v.literal("case")),
    requesterOwnsPrivateRoom: v.boolean(),
  }),
  nextSequence: v.number(),
  leaseId: v.string(),
});

export const send = mutation({
  args: { agentId: v.id("agents"), prompt: v.string(), clientOperationId: v.string() },
  returns: v.id("agentJobs"),
  handler: async (ctx, args) => {
    const agent = await ctx.db.get(args.agentId);
    if (!agent) throw new ConvexError({ code: "NOT_FOUND", message: "Agent not found" });
    const { userId } = await requireRoomPermission(ctx, agent.roomId, "post_message");
    await requireAiAccess(ctx, agent.spaceId, "openrouter");
    const prompt = args.prompt.trim();
    validateOperationId(args.clientOperationId);
    if (!prompt || prompt.length > 20_000) throw invalid("Prompt must be between 1 and 20,000 characters");

    const existing = await ctx.db.query("agentJobs").withIndex("by_agent_client_operation", q =>
      q.eq("agentId", args.agentId).eq("clientOperationId", args.clientOperationId),
    ).unique();
    if (existing) {
      if (existing.requestedBy !== userId) throw new ConvexError({ code: "IDEMPOTENCY_CONFLICT", message: "Operation ID already used" });
      return existing._id;
    }
    const rate = await limits.limit(ctx, "promptAgent", { key: `${agent.spaceId}:${userId}` });
    if (!rate.ok) throw new ConvexError({ code: "RATE_LIMITED", retryAfter: rate.retryAfter });

    const jobId = await ctx.db.insert("agentJobs", {
      agentId: agent._id, requestedBy: userId, prompt, clientOperationId: args.clientOperationId,
      status: "queued", attempt: 0, trigger: "mention", createdAt: Date.now(),
    });
    if (agent.status === "idle") {
      await ctx.db.patch(agent._id, { status: "running", lastError: undefined, updatedAt: Date.now() });
      await ctx.scheduler.runAfter(0, internal.agentWorker.run, { agentId: agent._id });
    }
    return jobId;
  },
});

export const forRoom = query({
  args: { roomId: v.id("rooms") },
  returns: v.union(v.object({ agent: agentDoc, jobs: v.array(jobDoc) }), v.null()),
  handler: async (ctx, { roomId }) => {
    await requireRoomPermission(ctx, roomId, "read");
    const agent = await ctx.db.query("agents").withIndex("by_room", q => q.eq("roomId", roomId)).first();
    if (!agent) return null;
    const jobs = await ctx.db.query("agentJobs").withIndex("by_agent_created", q =>
      q.eq("agentId", agent._id),
    ).order("desc").take(10);
    return { agent, jobs };
  },
});

export const beginNext = internalMutation({
  args: { agentId: v.id("agents") },
  returns: v.union(workItem, v.null()),
  handler: async (ctx, { agentId }) => {
    const agent = await ctx.db.get(agentId);
    if (!agent) return null;
    const alreadyRunning = await ctx.db.query("agentJobs").withIndex("by_agent_status_created", q =>
      q.eq("agentId", agentId).eq("status", "running"),
    ).first();
    if (alreadyRunning) return null;

    const job = await ctx.db.query("agentJobs").withIndex("by_agent_status_created", q =>
      q.eq("agentId", agentId).eq("status", "queued"),
    ).order("asc").first();
    if (!job) {
      await ctx.db.patch(agentId, { status: "idle", updatedAt: Date.now() });
      return null;
    }
    const access = await promptAccess(ctx, agent, job.requestedBy);
    if (!access) {
      const error = "Authorization expired before agent execution";
      await ctx.db.patch(job._id, { status: "failed", completedAt: Date.now(), error });
      await scheduleNextOrIdle(ctx, agentId, error);
      return null;
    }

    const startedAt = Date.now();
    const attempt = job.attempt + 1;
    const leaseId = `${job._id}:${attempt}`;
    await ctx.db.patch(job._id, {
      status: "running", startedAt, attempt, leaseId, error: undefined, activity: undefined,
      computerLiveViewUrl: undefined, computerInteractiveLiveViewUrl: undefined,
    });
    await ctx.scheduler.runAfter(10 * 60 * 1000 + 30_000, internal.agents.recover, { agentId, jobId: job._id, leaseId });

    const recentMessages = await ctx.db.query("agentMessages").withIndex("by_agent_sequence", q =>
      q.eq("agentId", agentId),
    ).order("desc").take(MAX_CONTEXT_MESSAGES);
    const nextSequence = (recentMessages[0]?.sequence ?? -1) + 1;
    const history = boundContext(recentMessages.reverse().map(entry => entry.message));
    const roomHistory = await seedRoomHistory(ctx, agent.roomId, agent.model);
    const seeded = roomHistory.length > 0 ? roomHistory : history;
    const memoryContext = await buildAgentMemoryContext(ctx, agentId, job.prompt);
    return {
      agent,
      job: { ...job, status: "running" as const, startedAt, attempt, leaseId },
      messages: seeded,
      memoryContext,
      requesterRole: access.membership.role,
      memoryPolicyContext: {
        roomType: access.room.type,
        requesterOwnsPrivateRoom: access.room.type === "private" && access.room.personalOwnerId === job.requestedBy,
      },
      nextSequence,
      leaseId,
    };
  },
});

export const finish = internalMutation({
  args: {
    agentId: v.id("agents"), jobId: v.id("agentJobs"), leaseId: v.string(),
    nextSequence: v.number(), messages: v.array(v.any()), error: v.optional(v.string()),
    inputTokens: v.optional(v.number()), outputTokens: v.optional(v.number()),
    cachedInputTokens: v.optional(v.number()), cacheWriteTokens: v.optional(v.number()),
    costUsd: v.optional(v.number()),
    billingSource: v.optional(v.union(v.literal("platform"), v.literal("family"))),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.agentId !== args.agentId || job.status !== "running" || job.leaseId !== args.leaseId) return false;
    const agent = await ctx.db.get(args.agentId);
    if (!agent || !(await stillCanPrompt(ctx, agent, job.requestedBy))) {
      const error = "Authorization expired before agent result commit";
      await ctx.db.patch(job._id, { status: "failed", completedAt: Date.now(), error, leaseId: undefined });
      if (agent) await scheduleNextOrIdle(ctx, args.agentId, error);
      return false;
    }
    const responseText = lastAssistantText(args.messages);
    for (let index = 0; index < args.messages.length; index++) {
      await ctx.db.insert("agentMessages", {
        agentId: args.agentId, sequence: args.nextSequence + index, message: args.messages[index], createdAt: Date.now(),
      });
    }
    await ctx.db.patch(job._id, {
      status: args.error ? "failed" : "complete", completedAt: Date.now(), error: args.error,
      leaseId: undefined, responseText: responseText || undefined, activity: undefined,
      computerLiveViewUrl: undefined, computerInteractiveLiveViewUrl: undefined,
    });
    if (!args.error && responseText) {
      const completedAt = Date.now();
      await ctx.db.insert("messages", {
        spaceId: agent.spaceId, roomId: agent.roomId, actorType: "assistant", origin: "assistant",
        originalText: responseText, language: "en", idempotencyKey: `agent-${job._id}`, createdAt: completedAt,
      });
      await recordAgentEpisode(ctx, {
        agentId: agent._id, spaceId: agent.spaceId, roomId: agent.roomId, requestedBy: job.requestedBy,
        source: "chat", sourceKey: `job:${job._id}`, request: job.prompt, response: responseText, createdAt: completedAt,
      });
    }
    const inputTokens = finiteNonnegative(args.inputTokens);
    const outputTokens = finiteNonnegative(args.outputTokens);
    const cachedInputTokens = finiteNonnegative(args.cachedInputTokens);
    const cacheWriteTokens = finiteNonnegative(args.cacheWriteTokens);
    const quantity = inputTokens + outputTokens + cachedInputTokens + cacheWriteTokens;
    if (quantity > 0) {
      await ctx.db.insert("usageLedger", {
        spaceId: agent.spaceId,
        userId: job.requestedBy,
        provider: "openrouter",
        model: agent.model,
        unit: "token",
        quantity,
        costUsd: finiteNonnegative(args.costUsd),
        costClass: "chat",
        inputTokens,
        outputTokens,
        cachedInputTokens,
        cacheWriteTokens,
        billingSource: args.billingSource,
        createdAt: Date.now(),
      });
    }
    await scheduleNextOrIdle(ctx, args.agentId, args.error);
    return true;
  },
});

export const updateProgress = internalMutation({
  args: {
    agentId: v.id("agents"), jobId: v.id("agentJobs"), leaseId: v.string(), responseText: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.agentId !== args.agentId || job.status !== "running" || job.leaseId !== args.leaseId) return null;
    await ctx.db.patch(job._id, { responseText: args.responseText.slice(0, 20_000) });
    return null;
  },
});

export const updateActivity = internalMutation({
  args: {
    agentId: v.id("agents"), jobId: v.id("agentJobs"), leaseId: v.string(),
    activity: v.optional(v.union(v.literal("searching_web"), v.literal("generating_image"), v.literal("using_computer"))),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.agentId !== args.agentId || job.status !== "running" || job.leaseId !== args.leaseId) return null;
    await ctx.db.patch(job._id, { activity: args.activity });
    return null;
  },
});

export const updateComputerView = internalMutation({
  args: {
    agentId: v.id("agents"), jobId: v.id("agentJobs"), leaseId: v.string(),
    liveViewUrl: v.optional(v.string()), interactiveLiveViewUrl: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.agentId !== args.agentId || job.status !== "running" || job.leaseId !== args.leaseId) return null;
    await ctx.db.patch(job._id, {
      activity: "using_computer",
      computerLiveViewUrl: args.liveViewUrl,
      computerInteractiveLiveViewUrl: args.interactiveLiveViewUrl,
    });
    return null;
  },
});

export const saveGeneratedImage = internalMutation({
  args: {
    agentId: v.id("agents"), jobId: v.id("agentJobs"), leaseId: v.string(),
    storageId: v.id("_storage"), prompt: v.string(), model: v.string(), mediaType: v.string(),
    kind: v.optional(imageKindValidator),
    style: v.optional(imageStyleValidator),
    language: v.optional(imageLanguageValidator),
  },
  returns: v.union(v.id("generatedImages"), v.null()),
  handler: async (ctx, args) => {
    const [agent, job] = await Promise.all([ctx.db.get(args.agentId), ctx.db.get(args.jobId)]);
    if (!agent || !job || job.agentId !== agent._id || job.status !== "running" || job.leaseId !== args.leaseId) return null;
    if (!(await stillCanPrompt(ctx, agent, job.requestedBy))) return null;
    return ctx.db.insert("generatedImages", {
      spaceId: agent.spaceId, roomId: agent.roomId, requestedBy: job.requestedBy,
      storageId: args.storageId, prompt: args.prompt, model: args.model, mediaType: args.mediaType, createdAt: Date.now(),
      kind: args.kind, style: args.style, language: args.language,
    });
  },
});

export const fail = internalMutation({
  args: { agentId: v.id("agents"), jobId: v.id("agentJobs"), leaseId: v.string(), error: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.agentId !== args.agentId || job.status !== "running" || job.leaseId !== args.leaseId) return null;
    await ctx.db.patch(job._id, {
      status: "failed", completedAt: Date.now(), error: args.error, leaseId: undefined, activity: undefined,
      computerLiveViewUrl: undefined, computerInteractiveLiveViewUrl: undefined,
    });
    await scheduleNextOrIdle(ctx, args.agentId, args.error);
    return null;
  },
});

export const recover = internalMutation({
  args: { agentId: v.id("agents"), jobId: v.id("agentJobs"), leaseId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.agentId !== args.agentId || job.status !== "running" || job.leaseId !== args.leaseId) return null;
    if (job.attempt >= MAX_JOB_ATTEMPTS) {
      const error = `Agent worker lease expired after ${job.attempt} attempts`;
      await ctx.db.patch(job._id, {
        status: "failed", completedAt: Date.now(), leaseId: undefined, activity: undefined,
        computerLiveViewUrl: undefined, computerInteractiveLiveViewUrl: undefined, error,
      });
      await scheduleNextOrIdle(ctx, args.agentId, error);
      return null;
    }
    await ctx.db.patch(job._id, {
      status: "queued", startedAt: undefined, leaseId: undefined, activity: undefined,
      computerLiveViewUrl: undefined, computerInteractiveLiveViewUrl: undefined,
      error: "Recovered after the worker lease expired",
    });
    await ctx.scheduler.runAfter(0, internal.agentWorker.run, { agentId: args.agentId });
    return null;
  },
});

export const computerJobContext = internalQuery({
  args: { agentId: v.id("agents"), jobId: v.id("agentJobs"), leaseId: v.string() },
  returns: v.union(v.object({
    profileName: v.string(),
    imageStyle: imageStyleValidator,
    language: v.union(v.literal("en"), v.literal("hi"), v.literal("mr")),
  }), v.null()),
  handler: async (ctx, args) => {
    const [agent, job] = await Promise.all([ctx.db.get(args.agentId), ctx.db.get(args.jobId)]);
    if (!agent || !job || job.agentId !== agent._id || job.status !== "running" || job.leaseId !== args.leaseId) return null;
    if (!(await stillCanPrompt(ctx, agent, job.requestedBy))) return null;
    const requester = await ctx.db.get(job.requestedBy);
    return {
      profileName: profileNameForUser(job.requestedBy),
      imageStyle: requester?.preferredImageStyle ?? "warm_family",
      language: requester?.preferredLanguage ?? "en",
    };
  },
});

async function scheduleNextOrIdle(ctx: MutationCtx, agentId: Id<"agents">, error?: string) {
  const next = await ctx.db.query("agentJobs").withIndex("by_agent_status_created", q =>
    q.eq("agentId", agentId).eq("status", "queued"),
  ).first();
  await ctx.db.patch(agentId, { status: next ? "running" : "idle", lastError: error, updatedAt: Date.now() });
  if (next) await ctx.scheduler.runAfter(0, internal.agentWorker.run, { agentId });
}

async function stillCanPrompt(ctx: QueryCtx | MutationCtx, agent: Doc<"agents">, userId: Id<"users">) {
  return (await promptAccess(ctx, agent, userId)) !== null;
}

async function promptAccess(ctx: QueryCtx | MutationCtx, agent: Doc<"agents">, userId: Id<"users">) {
  const [room, membership, roomMember] = await Promise.all([
    ctx.db.get(agent.roomId),
    ctx.db.query("memberships").withIndex("by_space_user", q =>
      q.eq("spaceId", agent.spaceId).eq("userId", userId),
    ).unique(),
    ctx.db.query("roomMembers").withIndex("by_room_user", q =>
      q.eq("roomId", agent.roomId).eq("userId", userId),
    ).unique(),
  ]);
  if (room?.spaceId !== agent.spaceId || membership?.status !== "active"
    || (roomMember?.role !== "manager" && roomMember?.role !== "participant")) return null;
  return { room, membership, roomMember };
}

function validateOperationId(value: string) {
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(value)) throw invalid("Invalid client operation ID");
}

async function seedRoomHistory(ctx: MutationCtx, roomId: Id<"rooms">, model: string) {
  const rows = await ctx.db.query("messages").withIndex("by_room_created", q => q.eq("roomId", roomId)).order("desc").take(24);
  const attachments = await ctx.db.query("attachments").withIndex("by_room_created", q => q.eq("roomId", roomId)).order("desc").take(12);
  const byMessage = new Map(attachments.map(attachment => [String(attachment.messageId), attachment]));
  const messages = rows.reverse().map(message => {
    const attachment = byMessage.get(String(message._id));
    const fileNote = attachment
      ? `\n[Shared file: ${attachment.fileName}${attachment.transcript ? ` — ${attachment.transcript.slice(0, 800)}` : ""}]`
      : "";
    const speaker = message.actorType === "assistant" ? "Saathi" : message.actorType === "email_guest" ? "Email" : "Family member";
    const text = `${speaker}: ${message.originalText}${fileNote}`.slice(0, 4_000);
    if (message.actorType !== "assistant") return { role: "user" as const, content: text, timestamp: message.createdAt };
    return {
      role: "assistant" as const,
      content: [{ type: "text" as const, text }],
      api: "openai-completions" as const,
      provider: "openrouter" as const,
      model,
      usage: {
        input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop" as const,
      timestamp: message.createdAt,
    };
  });
  return boundContext(messages);
}

function boundContext(messages: unknown[]) {
  const selected: unknown[] = [];
  let chars = 0;
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    const size = JSON.stringify(message).length;
    if (selected.length > 0 && chars + size > MAX_CONTEXT_CHARS) break;
    selected.unshift(message);
    chars += size;
  }
  return selected;
}

function finiteNonnegative(value: number | undefined) {
  return value !== undefined && Number.isFinite(value) ? Math.max(0, value) : 0;
}

function invalid(message: string) {
  return new ConvexError({ code: "INVALID_ARGUMENT", message });
}

function lastAssistantText(messages: unknown[]) {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (!message || typeof message !== "object" || !("role" in message) || message.role !== "assistant" || !("content" in message)) continue;
    if (typeof message.content === "string") return visibleAssistantText(message.content);
    if (!Array.isArray(message.content)) continue;
    const text = message.content.flatMap(block =>
      block && typeof block === "object" && "type" in block && block.type === "text" && "text" in block && typeof block.text === "string"
        ? [block.text]
        : [],
    ).join("").trim();
    if (text) return visibleAssistantText(text);
  }
  return "";
}

function visibleAssistantText(value: string) {
  const text = value.trim();
  return isNoReplyText(text) ? "" : text;
}
