import rateLimiter from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api.js";
import schema from "./schema.js";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

describe("room mentions", () => {
  test("suggests only authorized room members plus canonical Saathi", async () => {
    const { t, roomId, ownerId, outsiderId } = await seedMentionRooms();
    const owner = t.withIdentity({ subject: String(ownerId) });
    const outsider = t.withIdentity({ subject: String(outsiderId) });

    await expect(owner.query(api.mentions.candidates, { roomId })).resolves.toEqual([
      { kind: "assistant", username: "saathi", label: "Saathi" },
      expect.objectContaining({ kind: "person", username: "owner_one", userId: ownerId }),
      expect.objectContaining({ kind: "person", username: "member_two" }),
    ]);
    await expect(outsider.query(api.mentions.candidates, { roomId })).rejects.toThrow(/permission/i);
    expect((await owner.query(api.mentions.candidates, { roomId })).map(candidate => candidate.username)).not.toContain("outsider_three");
  });

  test("stores only authorized person mentions and treats canonical Saathi separately", async () => {
    const { t, roomId, ownerId, memberId } = await seedMentionRooms();
    rateLimiter.register(t);
    const owner = t.withIdentity({ subject: String(ownerId) });
    const member = t.withIdentity({ subject: String(memberId) });

    const personMessageId = await owner.mutation(api.messages.post, {
      roomId,
      text: "@MEMBER_TWO can you check this? @outsider_three",
      language: "en",
      clientOperationId: "person-mention-001",
    });
    expect(await t.run(ctx => ctx.db.get(personMessageId))).toMatchObject({
      mentions: [{ kind: "person", username: "member_two", userId: memberId }],
    });
    const personMessage = await t.run(ctx => ctx.db.get(personMessageId));
    const unread = await member.query(api.mentions.unreadForSpace, { spaceId: personMessage!.spaceId });
    expect(unread).toEqual([
      expect.objectContaining({ roomId, messageId: personMessageId, actorLabel: "Owner", roomTitle: "Family" }),
    ]);
    expect(await owner.query(api.mentions.unreadForSpace, { spaceId: personMessage!.spaceId })).toEqual([]);
    expect(await owner.mutation(api.messages.post, {
      roomId,
      text: "@MEMBER_TWO can you check this? @outsider_three",
      language: "en",
      clientOperationId: "person-mention-001",
    })).toBe(personMessageId);
    expect(await t.run(ctx => ctx.db.query("mentionNotifications").collect())).toHaveLength(1);
    expect(await member.mutation(api.mentions.markRoomRead, { roomId })).toBe(1);
    expect(await member.query(api.mentions.unreadForSpace, { spaceId: personMessage!.spaceId })).toEqual([]);
    expect((await t.run(ctx => ctx.db.query("agentJobs").order("desc").first()))?.trigger).toBe("ambient");

    const assistantMessageId = await owner.mutation(api.messages.post, {
      roomId,
      text: "@Saathi, remind @member_two tomorrow",
      language: "en",
      clientOperationId: "assistant-mention-001",
    });
    expect(await t.run(ctx => ctx.db.get(assistantMessageId))).toMatchObject({
      mentions: [
        { kind: "assistant", username: "saathi" },
        { kind: "person", username: "member_two", userId: memberId },
      ],
    });
    expect(await t.run(ctx => ctx.db.query("agentJobs").order("desc").first())).toMatchObject({
      trigger: "mention",
      prompt: expect.stringContaining("Tagged family members: @member_two"),
    });
  });
});

async function seedMentionRooms() {
  const t = convexTest(schema, modules);
  const seeded = await t.run(async ctx => {
    const now = Date.now();
    const ownerId = await ctx.db.insert("users", { email: "owner@example.test", username: "owner_one", displayName: "Owner", accessStatus: "approved" });
    const memberId = await ctx.db.insert("users", { email: "member@example.test", username: "member_two", displayName: "Member", accessStatus: "approved" });
    const outsiderId = await ctx.db.insert("users", { email: "outsider@example.test", username: "outsider_three", displayName: "Outsider", accessStatus: "approved" });
    const spaceId = await ctx.db.insert("spaces", { name: "First family", createdBy: ownerId, creationKey: "first", createdAt: now });
    const otherSpaceId = await ctx.db.insert("spaces", { name: "Other family", createdBy: outsiderId, creationKey: "other", createdAt: now });
    await ctx.db.insert("memberships", { spaceId, userId: ownerId, role: "owner", status: "active", joinedAt: now });
    await ctx.db.insert("memberships", { spaceId, userId: memberId, role: "member", status: "active", joinedAt: now });
    await ctx.db.insert("memberships", { spaceId: otherSpaceId, userId: outsiderId, role: "owner", status: "active", joinedAt: now });
    const roomId = await ctx.db.insert("rooms", { spaceId, type: "shared", title: "Family", assistantMode: "mention", createdBy: ownerId, createdAt: now });
    const otherRoomId = await ctx.db.insert("rooms", { spaceId: otherSpaceId, type: "shared", title: "Other", assistantMode: "mention", createdBy: outsiderId, createdAt: now });
    await ctx.db.insert("roomMembers", { roomId, userId: ownerId, role: "manager", createdAt: now });
    await ctx.db.insert("roomMembers", { roomId, userId: memberId, role: "participant", createdAt: now });
    // A stale cross-family grant must never make this user mentionable.
    await ctx.db.insert("roomMembers", { roomId, userId: outsiderId, role: "participant", createdAt: now });
    await ctx.db.insert("roomMembers", { roomId: otherRoomId, userId: outsiderId, role: "manager", createdAt: now });
    return { roomId, ownerId, memberId, outsiderId };
  });
  return { t, ...seeded };
}
