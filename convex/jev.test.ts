import rateLimiter from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api.js";
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
      const spaceId = await ctx.db.insert("spaces", { name: "Family", createdBy: ownerId, creationKey: "jev-family", createdAt: now });
      await ctx.db.insert("memberships", { spaceId, userId: ownerId, role: "owner", status: "active", joinedAt: now });
      await ctx.db.insert("memberships", { spaceId, userId: memberId, role: "member", status: "active", joinedAt: now });
      const roomId = await ctx.db.insert("rooms", { spaceId, type: "shared", title: "Family", assistantMode: "mention", createdBy: ownerId, createdAt: now });
      await ctx.db.insert("roomMembers", { roomId, userId: ownerId, role: "manager", createdAt: now });
      await ctx.db.insert("roomMembers", { roomId, userId: memberId, role: "participant", createdAt: now });
      return { ownerId, memberId, spaceId, roomId };
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
    const rows = await owner.query(api.jev.recent, { spaceId: seeded.spaceId });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ decision: "answer", source: "lab", confidence: 0.82 });
    expect(rows[0].inputPreview).toHaveLength(500);
    expect(rows[0].inputPreview).not.toContain("\n");
    await expect(member.query(api.jev.recent, { spaceId: seeded.spaceId })).rejects.toThrow(/permission/i);
    await expect(owner.mutation(internal.jev.prepareLab, { spaceId: seeded.spaceId })).resolves.toBeNull();
    await expect(member.mutation(internal.jev.prepareLab, { spaceId: seeded.spaceId })).rejects.toThrow(/permission/i);
    await expect(member.mutation(internal.jev.prepareVoiceTool, { roomId: seeded.roomId }))
      .resolves.toEqual({ spaceId: seeded.spaceId });
  });
});
