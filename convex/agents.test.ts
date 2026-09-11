import rateLimiter from "@convex-dev/rate-limiter/test";
import { convexTest, type TestConvex } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api.js";
import type { Id } from "./_generated/dataModel.js";
import { enableOpenRouterWebSearch, formatFirecrawlResults, withWebAccessPrompt } from "./agentWorker.js";
import schema from "./schema.js";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

describe("durable family agent", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  test("inherits room authorization and deduplicates client operations", async () => {
    const t = convexTest(schema, modules);
    rateLimiter.register(t);
    const { ownerId, participantId, outsiderId, roomId } = await seedFamily(t);
    const owner = t.withIdentity({ subject: String(ownerId) });
    const participant = t.withIdentity({ subject: String(participantId) });
    const outsider = t.withIdentity({ subject: String(outsiderId) });

    await expect(participant.mutation(api.agents.create, {
      roomId, name: "Saathi", clientOperationId: "create-participant",
    })).rejects.toThrow(/permission/i);

    const agentId = await owner.mutation(api.agents.create, {
      roomId, name: "Saathi", clientOperationId: "create-owner-001",
    });
    expect(await owner.mutation(api.agents.create, {
      roomId, name: "Saathi", clientOperationId: "create-owner-001",
    })).toBe(agentId);

    await expect(outsider.query(api.agents.get, { agentId })).rejects.toThrow(/permission/i);
    await expect(outsider.mutation(api.agents.send, {
      agentId, prompt: "private request", clientOperationId: "outsider-request",
    })).rejects.toThrow(/permission/i);

    const jobId = await participant.mutation(api.agents.send, {
      agentId, prompt: "Summarize the electricity bill", clientOperationId: "participant-request-001",
    });
    expect(await participant.mutation(api.agents.send, {
      agentId, prompt: "Summarize the electricity bill", clientOperationId: "participant-request-001",
    })).toBe(jobId);
    const snapshot = await owner.query(api.agents.get, { agentId });
    expect(snapshot?.agent).toMatchObject({
      roomId, provider: "openrouter", model: "deepseek/deepseek-v4.1-flash", status: "running",
    });
    expect(snapshot?.jobs).toEqual(expect.arrayContaining([expect.objectContaining({ _id: jobId, status: "queued" })]));
  });

  test("creates Saathi lazily and distinguishes ambient checks from explicit mentions", async () => {
    const t = convexTest(schema, modules);
    rateLimiter.register(t);
    const { ownerId, roomId } = await seedFamily(t);
    const owner = t.withIdentity({ subject: String(ownerId) });

    await owner.mutation(api.messages.post, {
      roomId, text: "Hi everyone", language: "en", clientOperationId: "ordinary-message-001",
    });
    expect(await t.run(ctx => ctx.db.query("agents").collect())).toHaveLength(1);
    expect(await t.run(ctx => ctx.db.query("agentJobs").collect())).toEqual([
      expect.objectContaining({ trigger: "ambient", status: "queued" }),
    ]);

    const messageId = await owner.mutation(api.messages.post, {
      roomId, text: "@saathi, help us plan dinner", language: "en", clientOperationId: "mention-message-001",
    });
    expect(await owner.mutation(api.messages.post, {
      roomId, text: "@saathi, help us plan dinner", language: "en", clientOperationId: "mention-message-001",
    })).toBe(messageId);

    const agents = await t.run(ctx => ctx.db.query("agents").collect());
    const jobs = await t.run(ctx => ctx.db.query("agentJobs").collect());
    expect(agents).toHaveLength(1);
    expect(agents[0]).toMatchObject({ roomId, name: "Saathi", status: "running" });
    expect(jobs).toHaveLength(2);
    expect(jobs).toEqual(expect.arrayContaining([
      expect.objectContaining({ prompt: expect.stringContaining("help us plan dinner"), trigger: "mention", status: "queued" }),
    ]));
  });

  test("keeps family chat available when ambient assistant checks are rate limited", async () => {
    const t = convexTest(schema, modules);
    rateLimiter.register(t);
    const { ownerId, roomId } = await seedFamily(t);
    const owner = t.withIdentity({ subject: String(ownerId) });

    for (let index = 0; index < 6; index++) {
      await owner.mutation(api.messages.post, {
        roomId, text: `Family update ${index}`, language: "en", clientOperationId: `ambient-message-${index}`,
      });
    }

    expect(await owner.query(api.rooms.messages, { roomId })).toHaveLength(6);
    expect(await t.run(ctx => ctx.db.query("agentJobs").collect())).toHaveLength(5);
  });

  test("runs FIFO and rejects a stale worker after exact-lease recovery", async () => {
    const t = convexTest(schema, modules);
    rateLimiter.register(t);
    const { ownerId, roomId } = await seedFamily(t);
    const owner = t.withIdentity({ subject: String(ownerId) });
    const agentId = await owner.mutation(api.agents.create, {
      roomId, name: "Saathi", clientOperationId: "create-owner-002",
    });
    const firstJobId = await owner.mutation(api.agents.send, {
      agentId, prompt: "first", clientOperationId: "first-operation",
    });
    const secondJobId = await owner.mutation(api.agents.send, {
      agentId, prompt: "second", clientOperationId: "second-operation",
    });

    const firstLease = await t.mutation(internal.agents.beginNext, { agentId });
    expect(firstLease?.job._id).toBe(firstJobId);
    expect(await t.mutation(internal.agents.beginNext, { agentId })).toBeNull();

    await t.mutation(internal.agents.recover, { agentId, jobId: firstJobId, leaseId: "wrong-lease" });
    expect((await owner.query(api.agents.get, { agentId }))?.jobs.find(job => job._id === firstJobId)?.status).toBe("running");

    await t.mutation(internal.agents.recover, {
      agentId, jobId: firstJobId, leaseId: firstLease!.leaseId,
    });
    const retryLease = await t.mutation(internal.agents.beginNext, { agentId });
    expect(retryLease).toMatchObject({ job: { _id: firstJobId, attempt: 2 } });
    expect(retryLease?.leaseId).not.toBe(firstLease?.leaseId);

    await t.mutation(internal.agents.updateProgress, {
      agentId, jobId: firstJobId, leaseId: retryLease!.leaseId, responseText: "Streaming response",
    });
    expect((await owner.query(api.agents.forRoom, { roomId }))?.jobs.find(job => job._id === firstJobId)?.responseText)
      .toBe("Streaming response");

    await t.mutation(internal.agents.finish, {
      agentId, jobId: firstJobId, leaseId: firstLease!.leaseId,
      nextSequence: 0, messages: [{ role: "assistant", content: "stale" }],
    });
    let snapshot = await owner.query(api.agents.get, { agentId });
    expect(snapshot?.messages).toEqual([]);
    expect(snapshot?.jobs.find(job => job._id === firstJobId)?.status).toBe("running");

    await t.mutation(internal.agents.finish, {
      agentId, jobId: firstJobId, leaseId: retryLease!.leaseId,
      nextSequence: retryLease!.nextSequence, messages: [{ role: "assistant", content: "fresh" }],
    });
    snapshot = await owner.query(api.agents.get, { agentId });
    expect(snapshot?.messages).toEqual([{ role: "assistant", content: "fresh" }]);
    expect(snapshot?.jobs.find(job => job._id === firstJobId)?.status).toBe("complete");
    expect(snapshot?.jobs.find(job => job._id === secondJobId)?.status).toBe("queued");
    const chatMessages = await owner.query(api.rooms.messages, { roomId });
    expect(chatMessages).toEqual([
      expect.objectContaining({ actorType: "assistant", origin: "assistant", originalText: "fresh" }),
    ]);

    const secondLease = await t.mutation(internal.agents.beginNext, { agentId });
    expect(secondLease?.job._id).toBe(secondJobId);
  });

  test("does not commit an agent result after requester access is revoked", async () => {
    const t = convexTest(schema, modules);
    rateLimiter.register(t);
    const { ownerId, participantId, roomId } = await seedFamily(t);
    const owner = t.withIdentity({ subject: String(ownerId) });
    const participant = t.withIdentity({ subject: String(participantId) });
    const agentId = await owner.mutation(api.agents.create, {
      roomId, name: "Saathi", clientOperationId: "create-owner-003",
    });
    const jobId = await participant.mutation(api.agents.send, {
      agentId, prompt: "private family context", clientOperationId: "revoked-operation",
    });
    const lease = await t.mutation(internal.agents.beginNext, { agentId });

    await t.run(async ctx => {
      const membership = await ctx.db.query("memberships").withIndex("by_space_user", q =>
        q.eq("spaceId", lease!.agent.spaceId).eq("userId", participantId),
      ).unique();
      await ctx.db.patch(membership!._id, { status: "revoked" });
    });
    await t.mutation(internal.agents.finish, {
      agentId, jobId, leaseId: lease!.leaseId, nextSequence: lease!.nextSequence,
      messages: [{ role: "assistant", content: "must not persist" }],
    });

    const snapshot = await owner.query(api.agents.get, { agentId });
    expect(snapshot?.messages).toEqual([]);
    expect(snapshot?.jobs.find(job => job._id === jobId)).toMatchObject({
      status: "failed", error: "Authorization expired before agent result commit",
    });
  });

  test("keeps an ambient no-reply decision out of the family conversation", async () => {
    const t = convexTest(schema, modules);
    rateLimiter.register(t);
    const { ownerId, roomId } = await seedFamily(t);
    const owner = t.withIdentity({ subject: String(ownerId) });
    const agentId = await owner.mutation(api.agents.create, {
      roomId, name: "Saathi", clientOperationId: "create-owner-004",
    });
    const jobId = await owner.mutation(api.agents.send, {
      agentId, prompt: "Ambient greeting", clientOperationId: "ambient-no-reply",
    });
    const lease = await t.mutation(internal.agents.beginNext, { agentId });

    await t.mutation(internal.agents.finish, {
      agentId, jobId, leaseId: lease!.leaseId, nextSequence: lease!.nextSequence,
      messages: [{ role: "assistant", content: "[NO_REPLY]." }],
    });

    expect(await owner.query(api.rooms.messages, { roomId })).toEqual([]);
    expect((await owner.query(api.agents.get, { agentId }))?.jobs.find(job => job._id === jobId))
      .toMatchObject({ status: "complete" });
  });

  test("grounds existing agents with bounded OpenRouter and Firecrawl web access", () => {
    expect(withWebAccessPrompt("Existing family prompt")).toContain("search_public_web");
    expect(withWebAccessPrompt("Already has search_public_web").match(/search_public_web/g)).toHaveLength(1);
    expect(enableOpenRouterWebSearch({ tools: [{ type: "function", function: { name: "remember" } }] })).toMatchObject({
      max_tool_calls: 2,
      tools: [
        { type: "function" },
        { type: "openrouter:web_search", parameters: { max_results: 4, max_uses: 2, max_total_results: 6 } },
      ],
    });
    expect(formatFirecrawlResults({
      news: [{ title: "Current report", url: "https://example.test/report", description: "Verified detail" }],
    })).toContain("URL: https://example.test/report");
  });

  test("persists generated images only for an active authorized agent lease", async () => {
    const t = convexTest(schema, modules);
    rateLimiter.register(t);
    const { ownerId, roomId } = await seedFamily(t);
    const owner = t.withIdentity({ subject: String(ownerId) });
    const agentId = await owner.mutation(api.agents.create, {
      roomId, name: "Saathi", clientOperationId: "create-image-agent",
    });
    const jobId = await owner.mutation(api.agents.send, {
      agentId, prompt: "Generate a family card", clientOperationId: "generate-image-job",
    });
    const lease = await t.mutation(internal.agents.beginNext, { agentId });
    const storageId = await t.run(ctx => ctx.storage.store(new Blob(["image"], { type: "image/png" })));

    expect(await t.mutation(internal.agents.saveGeneratedImage, {
      agentId, jobId, leaseId: "stale-lease", storageId,
      prompt: "A family card", model: "meta/muse-image", mediaType: "image/png",
    })).toBeNull();
    expect(await t.mutation(internal.agents.saveGeneratedImage, {
      agentId, jobId, leaseId: lease!.leaseId, storageId,
      prompt: "A family card", model: "meta/muse-image", mediaType: "image/png",
    })).not.toBeNull();
    expect(await owner.query(api.images.forRoom, { roomId })).toEqual([
      expect.objectContaining({ prompt: "A family card", model: "meta/muse-image", mediaType: "image/png" }),
    ]);
  });
});

async function seedFamily(t: TestConvex<typeof schema>) {
  return t.run(async ctx => {
    const now = Date.now();
    const ownerId = await ctx.db.insert("users", { email: "owner@example.test" });
    const participantId = await ctx.db.insert("users", { email: "member@example.test" });
    const outsiderId = await ctx.db.insert("users", { email: "outsider@example.test" });
    const spaceId = await ctx.db.insert("spaces", {
      name: "Test family", createdBy: ownerId, creationKey: "test-family", createdAt: now,
    });
    await ctx.db.insert("memberships", { spaceId, userId: ownerId, role: "owner", status: "active", joinedAt: now });
    await ctx.db.insert("memberships", { spaceId, userId: participantId, role: "member", status: "active", joinedAt: now });
    const roomId = await ctx.db.insert("rooms", {
      spaceId, type: "shared", title: "Family", assistantMode: "mention", createdBy: ownerId, createdAt: now,
    });
    await ctx.db.insert("roomMembers", { roomId, userId: ownerId, role: "manager", createdAt: now });
    await ctx.db.insert("roomMembers", { roomId, userId: participantId, role: "participant", createdAt: now });
    return { ownerId, participantId, outsiderId, roomId } satisfies {
      ownerId: Id<"users">; participantId: Id<"users">; outsiderId: Id<"users">; roomId: Id<"rooms">;
    };
  });
}
