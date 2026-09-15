import rateLimiter from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api.js";
import schema from "./schema.js";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

describe("personal Saathi rooms", () => {
  test("creates one private room per member and never grants another family member access", async () => {
    const t = convexTest(schema, modules);
    rateLimiter.register(t);
    const { spaceId, ownerId, memberId } = await t.run(async ctx => {
      const now = Date.now();
      const ownerId = await ctx.db.insert("users", { email: "owner@example.test" });
      const memberId = await ctx.db.insert("users", { email: "member@example.test" });
      const spaceId = await ctx.db.insert("spaces", { name: "Family", createdBy: ownerId, creationKey: "family-create-001", createdAt: now });
      await ctx.db.insert("memberships", { spaceId, userId: ownerId, role: "owner", status: "active", joinedAt: now });
      await ctx.db.insert("memberships", { spaceId, userId: memberId, role: "member", status: "active", joinedAt: now });
      return { spaceId, ownerId, memberId };
    });
    const owner = t.withIdentity({ subject: String(ownerId) });
    const member = t.withIdentity({ subject: String(memberId) });

    const memberRoomId = await member.mutation(api.rooms.ensurePersonal, { spaceId });
    await expect(member.mutation(api.rooms.ensurePersonal, { spaceId })).resolves.toBe(memberRoomId);
    const ownerRoomId = await owner.mutation(api.rooms.ensurePersonal, { spaceId });

    expect(ownerRoomId).not.toBe(memberRoomId);
    expect(await t.run(ctx => ctx.db.get(memberRoomId))).toMatchObject({
      type: "private", title: "My Saathi", assistantMode: "automatic", personalOwnerId: memberId,
    });
    expect((await member.query(api.rooms.list, { spaceId })).map(row => row.room?._id)).toEqual([memberRoomId]);
    expect((await owner.query(api.rooms.list, { spaceId })).map(row => row.room?._id)).toEqual([ownerRoomId]);
    await expect(owner.query(api.rooms.messages, { roomId: memberRoomId })).rejects.toThrow(/permission/i);

    await member.mutation(api.messages.post, {
      roomId: memberRoomId, text: "Help me plan dinner", language: "en", clientOperationId: "personal-message-001",
    });
    expect(await t.run(ctx => ctx.db.query("agentJobs").first())).toMatchObject({
      trigger: "automatic", prompt: expect.stringContaining("Respond helpfully"),
    });
  });
});
