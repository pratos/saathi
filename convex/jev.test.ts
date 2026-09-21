import rateLimiter from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api.js";
import type { Id } from "./_generated/dataModel.js";
import schema from "./schema.js";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

describe("Jev decision records", () => {
  test("keeps previews bounded and exposes decisions only to family owners", async () => {
    const t = convexTest(schema, modules);
    rateLimiter.register(t);
    const seeded = await t.run(async ctx => {
      const now = Date.now();
      const ownerId = await ctx.db.insert("users", { email: "owner@example.test" });
      const memberId = await ctx.db.insert("users", { email: "member@example.test" });
      const adminId = await ctx.db.insert("users", {
        email: "admin@example.test",
        platformRole: "superadmin",
        accessStatus: "approved",
      });
      const spaceId = await ctx.db.insert("spaces", { name: "Family", createdBy: ownerId, creationKey: "jev-family", createdAt: now });
      await ctx.db.insert("memberships", { spaceId, userId: ownerId, role: "owner", status: "active", joinedAt: now });
      await ctx.db.insert("memberships", { spaceId, userId: memberId, role: "member", status: "active", joinedAt: now });
      const roomId = await ctx.db.insert("rooms", { spaceId, type: "shared", title: "Family", assistantMode: "mention", createdBy: ownerId, createdAt: now });
      await ctx.db.insert("roomMembers", { roomId, userId: ownerId, role: "manager", createdAt: now });
      await ctx.db.insert("roomMembers", { roomId, userId: memberId, role: "participant", createdAt: now });
      return { ownerId, memberId, adminId, spaceId, roomId };
    });
    await t.mutation(internal.jev.record, {
      spaceId: seeded.spaceId,
      source: "lab",
      inputPreview: `  classify\n\n${"x".repeat(700)}  `,
      decision: "answer",
      confidence: 0.82,
      details: { route: "answer" },
      model: "jev-latest",
      latencyMs: 31,
      inputTokens: 42,
    });

    const owner = t.withIdentity({ subject: String(seeded.ownerId) });
    const member = t.withIdentity({ subject: String(seeded.memberId) });
    const admin = t.withIdentity({ subject: String(seeded.adminId) });
    const rows = await owner.query(api.jev.recent, { spaceId: seeded.spaceId });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ decision: "answer", source: "lab", confidence: 0.82 });
    expect(rows[0].inputPreview).toHaveLength(500);
    expect(rows[0].inputPreview).not.toContain("\n");
    await expect(member.query(api.jev.recent, { spaceId: seeded.spaceId })).rejects.toThrow(/permission/i);
    await expect(owner.mutation(internal.jev.prepareLab, { spaceId: seeded.spaceId })).resolves.toBe(seeded.ownerId);
    await expect(member.mutation(internal.jev.prepareLab, { spaceId: seeded.spaceId })).rejects.toThrow(/permission/i);
    await expect(owner.query(api.jev.canViewBenchmarks, {})).resolves.toBe(false);
    await expect(member.query(api.jev.canViewBenchmarks, {})).resolves.toBe(false);
    await expect(admin.query(api.jev.canViewBenchmarks, {})).resolves.toBe(true);
    await expect(owner.query(api.jev.benchmarkReport, {})).rejects.toThrow(/permission/i);
    await expect(member.query(api.jev.benchmarkReport, {})).rejects.toThrow(/permission/i);
    await expect(admin.query(api.jev.benchmarkReport, {})).resolves.toMatchObject({
      commit: "5af76abe20241ac7dfa6309083fb1a6ff363a482",
      repetitions: 3,
      memory: { passed: 33, total: 36 },
      conditions: [
        { id: "A", passed: 106, total: 117, wrongCalls: 0 },
        { id: "B", passed: 107, total: 117, wrongCalls: 0 },
        { id: "C", passed: 100, total: 117, wrongCalls: 2 },
        { id: "D", passed: 107, total: 117, wrongCalls: 0 },
      ],
      promotionGates: { accuracyPassed: false, safetyPassed: true, latencyPassed: false, costPassed: false },
      projectedFromPostPiGateRun: true,
    });
  });

  test("links routing advice to the downstream Pi outcome", async () => {
    const t = convexTest(schema, modules);
    rateLimiter.register(t);
    const seeded = await t.run(async ctx => {
      const now = Date.now();
      const ownerId = await ctx.db.insert("users", { email: "owner@example.test" });
      const spaceId = await ctx.db.insert("spaces", { name: "Family", createdBy: ownerId, creationKey: "jev-outcomes", createdAt: now });
      await ctx.db.insert("memberships", { spaceId, userId: ownerId, role: "owner", status: "active", joinedAt: now });
      const roomId = await ctx.db.insert("rooms", { spaceId, type: "shared", title: "Family", assistantMode: "mention", createdBy: ownerId, createdAt: now });
      const agentId = await ctx.db.insert("agents", {
        spaceId, roomId, createdBy: ownerId, creationKey: "jev-outcome-agent", name: "Saathi",
        systemPrompt: "Help the family.", provider: "openrouter", model: "test-model",
        status: "idle", createdAt: now, updatedAt: now,
      });
      const repliedJobId = await ctx.db.insert("agentJobs", {
        agentId, requestedBy: ownerId, prompt: "Help me", clientOperationId: "jev-replied",
        status: "complete", attempt: 1, responseText: "I can help with that.", trigger: "automatic", createdAt: now,
      });
      const silentJobId = await ctx.db.insert("agentJobs", {
        agentId, requestedBy: ownerId, prompt: "Family chat", clientOperationId: "jev-silent",
        status: "complete", attempt: 1, trigger: "ambient", createdAt: now + 1,
      });
      const failedJobId = await ctx.db.insert("agentJobs", {
        agentId, requestedBy: ownerId, prompt: "Search for me", clientOperationId: "jev-failed",
        status: "failed", attempt: 1, error: "Provider unavailable", trigger: "mention", createdAt: now + 2,
      });
      return { ownerId, spaceId, roomId, repliedJobId, silentJobId, failedJobId };
    });
    let repliedDecisionId: Id<"jevDecisions"> | null = null;
    for (const [jobId, input] of [
      [seeded.repliedJobId, "Help me"],
      [seeded.silentJobId, "Family chat"],
      [seeded.failedJobId, "Search for me"],
    ] as const) {
      const decisionId = await t.mutation(internal.jev.record, {
        spaceId: seeded.spaceId, roomId: seeded.roomId, jobId, source: "chat_turn",
        inputPreview: input, decision: "answer", confidence: 0.9, details: {},
        model: "jev-latest", latencyMs: 20, inputTokens: 10,
      });
      if (jobId === seeded.repliedJobId) repliedDecisionId = decisionId;
    }
    if (!repliedDecisionId) throw new Error("Expected a Jev decision");
    await t.mutation(internal.jev.completeTurnToolRouting, {
      decisionId: repliedDecisionId,
      jobId: seeded.repliedJobId,
      outcome: {
        selectedToolNames: ["search_public_web"],
        metrics: { bundleRecall: 1, exactToolCoverage: true },
      },
    });

    const owner = t.withIdentity({ subject: String(seeded.ownerId) });
    const rows = await owner.query(api.jev.recent, { spaceId: seeded.spaceId });
    const byJob = new Map(rows.map(row => [row.jobId, row]));
    expect(byJob.get(seeded.repliedJobId)?.execution).toMatchObject({
      status: "complete", trigger: "automatic", responsePreview: "I can help with that.",
    });
    expect(byJob.get(seeded.repliedJobId)?.details).toMatchObject({
      toolRoutingOutcome: {
        selectedToolNames: ["search_public_web"],
        metrics: { bundleRecall: 1, exactToolCoverage: true },
      },
    });
    expect(byJob.get(seeded.silentJobId)?.execution).toMatchObject({ status: "complete", trigger: "ambient" });
    expect(byJob.get(seeded.silentJobId)?.execution?.responsePreview).toBeUndefined();
    expect(byJob.get(seeded.failedJobId)?.execution).toMatchObject({
      status: "failed", trigger: "mention", error: "Provider unavailable",
    });
  });
});
