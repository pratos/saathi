import { MINUTE, RateLimiter } from "@convex-dev/rate-limiter";
import { ConvexError, v } from "convex/values";
import { components, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { requireRoomPermission } from "./lib/authz";

const DEFAULT_MODEL = "deepseek/deepseek-v4.1-flash";
const DEFAULT_SYSTEM_PROMPT = `You are Saathi, a concise multilingual family assistant.
Use memory only for facts the family explicitly asks you to retain.
Never claim an external action was taken unless Saath records its confirmed result.
Say when you do not know something.`;
const MAX_CONTEXT_MESSAGES = 200;

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
  completedAt: v.optional(v.number()), error: v.optional(v.string()),
});
const workItem = v.object({
  agent: agentDoc,
  job: jobDoc,
  messages: v.array(v.any()),
  nextSequence: v.number(),
  leaseId: v.string(),
});

export const create = mutation({
  args: {
    roomId: v.id("rooms"), name: v.string(), systemPrompt: v.optional(v.string()), clientOperationId: v.string(),
  },
  returns: v.id("agents"),
  handler: async (ctx, args) => {
    const { userId, room } = await requireRoomPermission(ctx, args.roomId, "manage_room");
    const name = args.name.trim();
    const systemPrompt = args.systemPrompt?.trim() || DEFAULT_SYSTEM_PROMPT;
    validateOperationId(args.clientOperationId);
    if (name.length < 2 || name.length > 80) throw invalid("Agent name must be between 2 and 80 characters");
    if (systemPrompt.length > 10_000) throw invalid("System prompt must be 10,000 characters or shorter");

    const existing = await ctx.db.query("agents").withIndex("by_room_creation_key", q =>
      q.eq("roomId", args.roomId).eq("creationKey", args.clientOperationId),
    ).unique();
    if (existing) {
      if (existing.createdBy !== userId) throw new ConvexError({ code: "IDEMPOTENCY_CONFLICT", message: "Operation ID already used" });
      return existing._id;
    }

    const now = Date.now();
    return ctx.db.insert("agents", {
      spaceId: room.spaceId, roomId: room._id, createdBy: userId, creationKey: args.clientOperationId,
      name, systemPrompt, provider: "openrouter", model: DEFAULT_MODEL, status: "idle", createdAt: now, updatedAt: now,
    });
  },
});

export const send = mutation({
  args: { agentId: v.id("agents"), prompt: v.string(), clientOperationId: v.string() },
  returns: v.id("agentJobs"),
  handler: async (ctx, args) => {
    const agent = await ctx.db.get(args.agentId);
    if (!agent) throw new ConvexError({ code: "NOT_FOUND", message: "Agent not found" });
    const { userId } = await requireRoomPermission(ctx, agent.roomId, "post_message");
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
      status: "queued", attempt: 0, createdAt: Date.now(),
    });
    if (agent.status === "idle") {
      await ctx.db.patch(agent._id, { status: "running", lastError: undefined, updatedAt: Date.now() });
      await ctx.scheduler.runAfter(0, internal.agentWorker.run, { agentId: agent._id });
    }
    return jobId;
  },
});

export const get = query({
  args: { agentId: v.id("agents") },
  returns: v.union(v.object({ agent: agentDoc, messages: v.array(v.any()), jobs: v.array(jobDoc) }), v.null()),
  handler: async (ctx, { agentId }) => {
    const agent = await ctx.db.get(agentId);
    if (!agent) return null;
    await requireRoomPermission(ctx, agent.roomId, "read");
    const [recentMessages, jobs] = await Promise.all([
      ctx.db.query("agentMessages").withIndex("by_agent_sequence", q => q.eq("agentId", agentId)).order("desc").take(MAX_CONTEXT_MESSAGES),
      ctx.db.query("agentJobs").withIndex("by_agent_created", q => q.eq("agentId", agentId)).order("desc").take(20),
    ]);
    return { agent, messages: recentMessages.reverse().map(entry => entry.message), jobs };
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
    if (!(await stillCanPrompt(ctx, agent, job.requestedBy))) {
      const error = "Authorization expired before agent execution";
      await ctx.db.patch(job._id, { status: "failed", completedAt: Date.now(), error });
      await scheduleNextOrIdle(ctx, agentId, error);
      return null;
    }

    const startedAt = Date.now();
    const attempt = job.attempt + 1;
    const leaseId = `${job._id}:${attempt}`;
    await ctx.db.patch(job._id, { status: "running", startedAt, attempt, leaseId, error: undefined });
    await ctx.scheduler.runAfter(10 * 60 * 1000 + 30_000, internal.agents.recover, { agentId, jobId: job._id, leaseId });

    const recentMessages = await ctx.db.query("agentMessages").withIndex("by_agent_sequence", q =>
      q.eq("agentId", agentId),
    ).order("desc").take(MAX_CONTEXT_MESSAGES);
    const nextSequence = (recentMessages[0]?.sequence ?? -1) + 1;
    return {
      agent,
      job: { ...job, status: "running" as const, startedAt, attempt, leaseId },
      messages: recentMessages.reverse().map(entry => entry.message),
      nextSequence,
      leaseId,
    };
  },
});

export const finish = internalMutation({
  args: {
    agentId: v.id("agents"), jobId: v.id("agentJobs"), leaseId: v.string(),
    nextSequence: v.number(), messages: v.array(v.any()), error: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.agentId !== args.agentId || job.status !== "running" || job.leaseId !== args.leaseId) return null;
    const agent = await ctx.db.get(args.agentId);
    if (!agent || !(await stillCanPrompt(ctx, agent, job.requestedBy))) {
      const error = "Authorization expired before agent result commit";
      await ctx.db.patch(job._id, { status: "failed", completedAt: Date.now(), error, leaseId: undefined });
      if (agent) await scheduleNextOrIdle(ctx, args.agentId, error);
      return null;
    }
    for (let index = 0; index < args.messages.length; index++) {
      await ctx.db.insert("agentMessages", {
        agentId: args.agentId, sequence: args.nextSequence + index, message: args.messages[index], createdAt: Date.now(),
      });
    }
    await ctx.db.patch(job._id, {
      status: args.error ? "failed" : "complete", completedAt: Date.now(), error: args.error,
      leaseId: undefined,
    });
    await scheduleNextOrIdle(ctx, args.agentId, args.error);
    return null;
  },
});

export const fail = internalMutation({
  args: { agentId: v.id("agents"), jobId: v.id("agentJobs"), leaseId: v.string(), error: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.agentId !== args.agentId || job.status !== "running" || job.leaseId !== args.leaseId) return null;
    await ctx.db.patch(job._id, { status: "failed", completedAt: Date.now(), error: args.error, leaseId: undefined });
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
    await ctx.db.patch(job._id, {
      status: "queued", startedAt: undefined, leaseId: undefined, error: "Recovered after the worker lease expired",
    });
    await ctx.scheduler.runAfter(0, internal.agentWorker.run, { agentId: args.agentId });
    return null;
  },
});

export const remember = internalMutation({
  args: { agentId: v.id("agents"), key: v.string(), value: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const key = args.key.trim();
    const value = args.value.trim();
    if (!key || key.length > 100 || !value || value.length > 10_000) throw invalid("Invalid memory key or value");
    const existing = await ctx.db.query("agentMemory").withIndex("by_agent_key", q =>
      q.eq("agentId", args.agentId).eq("key", key),
    ).unique();
    if (existing) await ctx.db.patch(existing._id, { value, updatedAt: Date.now() });
    else await ctx.db.insert("agentMemory", { agentId: args.agentId, key, value, updatedAt: Date.now() });
    return null;
  },
});

export const recall = internalQuery({
  args: { agentId: v.id("agents"), key: v.string() },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) => {
    const memory = await ctx.db.query("agentMemory").withIndex("by_agent_key", q =>
      q.eq("agentId", args.agentId).eq("key", args.key.trim()),
    ).unique();
    return memory?.value ?? null;
  },
});

async function scheduleNextOrIdle(ctx: MutationCtx, agentId: Id<"agents">, error?: string) {
  const next = await ctx.db.query("agentJobs").withIndex("by_agent_status_created", q =>
    q.eq("agentId", agentId).eq("status", "queued"),
  ).first();
  await ctx.db.patch(agentId, { status: next ? "running" : "idle", lastError: error, updatedAt: Date.now() });
  if (next) await ctx.scheduler.runAfter(0, internal.agentWorker.run, { agentId });
}

async function stillCanPrompt(ctx: MutationCtx, agent: Doc<"agents">, userId: Id<"users">) {
  const [room, membership, roomMember] = await Promise.all([
    ctx.db.get(agent.roomId),
    ctx.db.query("memberships").withIndex("by_space_user", q =>
      q.eq("spaceId", agent.spaceId).eq("userId", userId),
    ).unique(),
    ctx.db.query("roomMembers").withIndex("by_room_user", q =>
      q.eq("roomId", agent.roomId).eq("userId", userId),
    ).unique(),
  ]);
  return room?.spaceId === agent.spaceId && membership?.status === "active" &&
    (roomMember?.role === "manager" || roomMember?.role === "participant");
}

function validateOperationId(value: string) {
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(value)) throw invalid("Invalid client operation ID");
}

function invalid(message: string) {
  return new ConvexError({ code: "INVALID_ARGUMENT", message });
}
