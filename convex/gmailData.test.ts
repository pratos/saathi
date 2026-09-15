import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api.js";
import schema from "./schema.js";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

describe("private Gmail ingestion", () => {
  test("stores irrelevant mail as marker-only and useful mail once in the member's personal room", async () => {
    const t = convexTest(schema, modules);
    const { connectionId, memberId, ownerId, spaceId } = await t.run(async ctx => {
      const createdAt = Date.now();
      const ownerId = await ctx.db.insert("users", { email: "owner@example.test" });
      const memberId = await ctx.db.insert("users", { email: "member@example.test" });
      const spaceId = await ctx.db.insert("spaces", { name: "Family", createdBy: ownerId, creationKey: "family-create-001", createdAt });
      await ctx.db.insert("memberships", { spaceId, userId: ownerId, role: "owner", status: "active", joinedAt: createdAt });
      await ctx.db.insert("memberships", { spaceId, userId: memberId, role: "member", status: "active", joinedAt: createdAt });
      const connectionId = await ctx.db.insert("gmailConnections", {
        spaceId, userId: memberId, connectedAccountId: "ca_member_primary", alias: "Personal Gmail",
        triggerId: "ti_member_primary", status: "active", createdAt,
      });
      return { connectionId, memberId, ownerId, spaceId };
    });
    const member = t.withIdentity({ subject: String(memberId) });
    const owner = t.withIdentity({ subject: String(ownerId) });
    const common = { connectionId, threadId: "thread-family-1", receivedAt: 1_700_000_000_000, category: "needs_review" as const };

    await member.mutation(internal.gmailData.saveClassification, {
      ...common,
      externalMessageId: "irrelevant-1",
      sender: "newsletter@example.test",
      subject: "Sale ends tonight",
      text: "Private promotional copy that must not be retained",
      useful: false,
      summary: "Promotion",
    });

    const afterIrrelevant = await t.run(async ctx => ({
      markers: await ctx.db.query("gmailProcessedMessages").collect(),
      inbox: await ctx.db.query("inboxItems").collect(),
      messages: await ctx.db.query("messages").collect(),
    }));
    expect(afterIrrelevant.markers).toHaveLength(1);
    expect(afterIrrelevant.markers[0]).toMatchObject({ connectionId, externalMessageId: "irrelevant-1", useful: false });
    expect(JSON.stringify(afterIrrelevant.markers)).not.toContain("Sale ends tonight");
    expect(JSON.stringify(afterIrrelevant.markers)).not.toContain("newsletter@example.test");
    expect(afterIrrelevant.inbox).toEqual([]);
    expect(afterIrrelevant.messages).toEqual([]);

    const useful = {
      ...common,
      externalMessageId: "useful-1",
      sender: "school@example.test",
      subject: "Field trip permission due Friday",
      text: "Return the signed permission form by Friday.",
      useful: true,
      summary: "The field trip permission form is due Friday.",
      category: "school" as const,
    };
    await expect(member.mutation(internal.gmailData.saveClassification, useful)).resolves.not.toBeNull();
    await expect(member.mutation(internal.gmailData.saveClassification, useful)).resolves.toBeNull();

    const memberRooms = await member.query(api.rooms.list, { spaceId });
    const personalRoom = memberRooms.find(row => row.room?.type === "private")?.room;
    expect(personalRoom).toMatchObject({ title: "My Saathi", assistantMode: "automatic", personalOwnerId: memberId });
    expect(await member.query(api.inbox.list, { spaceId })).toHaveLength(1);
    expect(await member.query(api.rooms.messages, { roomId: personalRoom!._id })).toHaveLength(1);
    expect(await owner.query(api.inbox.list, { spaceId })).toEqual([]);
    await expect(owner.query(api.rooms.messages, { roomId: personalRoom!._id })).rejects.toThrow(/permission/i);

    const persisted = await t.run(async ctx => ({
      markers: await ctx.db.query("gmailProcessedMessages").collect(),
      inbox: await ctx.db.query("inboxItems").collect(),
      messages: await ctx.db.query("messages").collect(),
      jobs: await ctx.db.query("agentJobs").collect(),
    }));
    expect(persisted.markers).toHaveLength(2);
    expect(persisted.inbox).toHaveLength(1);
    expect(persisted.messages).toHaveLength(1);
    expect(persisted.jobs).toEqual([]);
  });
});
