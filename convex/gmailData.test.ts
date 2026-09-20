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
      const familyRoomId = await ctx.db.insert("rooms", { spaceId, type: "shared", title: "Family conversation", assistantMode: "mention", createdBy: ownerId, createdAt });
      await ctx.db.insert("roomMembers", { roomId: familyRoomId, userId: ownerId, role: "manager", createdAt });
      await ctx.db.insert("roomMembers", { roomId: familyRoomId, userId: memberId, role: "participant", createdAt });
      const connectionId = await ctx.db.insert("gmailConnections", {
        spaceId, userId: memberId, connectedAccountId: "ca_member_primary", alias: "Personal Gmail",
        triggerId: "ti_member_primary", status: "active", createdAt,
      });
      return { connectionId, memberId, ownerId, spaceId };
    });
    const member = t.withIdentity({ subject: String(memberId) });
    const owner = t.withIdentity({ subject: String(ownerId) });
    const common = { connectionId, threadId: "thread-family-1", receivedAt: 1_700_000_000_000, category: "receipts" as const };

    await member.mutation(internal.gmailData.touchSynced, { connectionId });
    const syncState = await t.run(async ctx => ({
      connection: await ctx.db.get(connectionId),
      state: await ctx.db.query("gmailConnectionSyncStates")
        .withIndex("by_connection_id", q => q.eq("connectionId", connectionId))
        .unique(),
    }));
    expect(syncState.connection?.lastSyncedAt).toBeUndefined();
    expect(syncState.state?.lastSyncedAt).toEqual(expect.any(Number));
    await expect(member.query(api.gmailData.mine, { spaceId })).resolves.toEqual([
      expect.objectContaining({ _id: connectionId, lastSyncedAt: syncState.state?.lastSyncedAt }),
    ]);

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
      sender: "statements@hdfcbank.test",
      subject: "Credit card statement due 21 Sep",
      text: "Your credit card bill of Rs 4,320 is due on 21 Sep.",
      useful: true,
      summary: "HDFC credit card bill of Rs 4,320 is due 21 Sep.",
      category: "bills" as const,
      amount: "4320",
    };
    await expect(member.mutation(internal.gmailData.saveClassification, useful)).resolves.not.toBeNull();
    await expect(member.mutation(internal.gmailData.saveClassification, useful)).resolves.toBeNull();

    const memberRooms = await member.query(api.rooms.list, { spaceId });
    const personalRoom = memberRooms.find(row => row.room?.type === "private")?.room;
    expect(personalRoom).toMatchObject({ title: "My Saathi", assistantMode: "automatic", personalOwnerId: memberId });
    expect(await member.query(api.inbox.list, { spaceId })).toEqual([]);
    expect(await member.query(api.gmailData.pendingForRoom, { roomId: personalRoom!._id })).toHaveLength(1);
    expect(await member.query(api.rooms.messages, { roomId: personalRoom!._id })).toHaveLength(1);
    expect(await owner.query(api.inbox.list, { spaceId })).toEqual([]);
    await expect(owner.query(api.rooms.messages, { roomId: personalRoom!._id })).rejects.toThrow(/permission/i);

    const pending = await member.query(api.gmailData.pendingForRoom, { roomId: personalRoom!._id });
    await expect(member.query(internal.gmailData.attachmentSource, { inboxItemId: pending[0]._id })).resolves.toMatchObject({
      connectedAccountId: "ca_member_primary",
      messageId: "useful-1",
      userId: memberId,
    });
    await expect(owner.mutation(api.gmailData.shareWithFamily, { inboxItemId: pending[0]._id })).rejects.toThrow(/permission/i);
    await member.mutation(api.gmailData.shareWithFamily, { inboxItemId: pending[0]._id });
    expect(await owner.query(api.inbox.list, { spaceId })).toHaveLength(1);
    expect(await member.query(api.gmailData.pendingForRoom, { roomId: personalRoom!._id })).toEqual([]);

    const persisted = await t.run(async ctx => ({
      markers: await ctx.db.query("gmailProcessedMessages").collect(),
      inbox: await ctx.db.query("inboxItems").collect(),
      messages: await ctx.db.query("messages").collect(),
      jobs: await ctx.db.query("agentJobs").collect(),
    }));
    expect(persisted.markers).toHaveLength(2);
    expect(persisted.inbox).toHaveLength(1);
    expect(persisted.inbox[0]).toMatchObject({ visibility: "space", category: "bills" });
    expect(persisted.messages).toHaveLength(2);
    expect(persisted.jobs).toEqual([]);
  });

  test("a member without a family-room grant cannot share private Gmail into that room", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run(async ctx => {
      const createdAt = Date.now();
      const ownerId = await ctx.db.insert("users", { email: "owner@example.test" });
      const memberId = await ctx.db.insert("users", { email: "member@example.test" });
      const spaceId = await ctx.db.insert("spaces", { name: "Family", createdBy: ownerId, creationKey: "gmail-share-grant", createdAt });
      await ctx.db.insert("memberships", { spaceId, userId: ownerId, role: "owner", status: "active", joinedAt: createdAt });
      await ctx.db.insert("memberships", { spaceId, userId: memberId, role: "member", status: "active", joinedAt: createdAt });
      const familyRoomId = await ctx.db.insert("rooms", { spaceId, type: "shared", title: "Family conversation", assistantMode: "mention", createdBy: ownerId, createdAt });
      await ctx.db.insert("roomMembers", { roomId: familyRoomId, userId: ownerId, role: "manager", createdAt });
      const connectionId = await ctx.db.insert("gmailConnections", {
        spaceId, userId: memberId, connectedAccountId: "ca_member_nogrant", alias: "Personal Gmail",
        triggerId: "ti_member_nogrant", status: "active", createdAt,
      });
      return { connectionId, memberId, familyRoomId };
    });
    const member = t.withIdentity({ subject: String(seeded.memberId) });
    const inboxItemId = await member.mutation(internal.gmailData.saveClassification, {
      connectionId: seeded.connectionId,
      threadId: "thread-nogrant",
      receivedAt: 1_700_000_000_000,
      category: "receipts",
      externalMessageId: "useful-nogrant",
      sender: "shop@example.test",
      subject: "Receipt",
      text: "Paid 200",
      useful: true,
      summary: "Receipt",
      amount: "200",
    });
    await expect(member.mutation(api.gmailData.shareWithFamily, { inboxItemId: inboxItemId! })).rejects.toThrow(/permission/i);
    const item = await t.run(ctx => ctx.db.get(inboxItemId!));
    expect(item).toMatchObject({ visibility: "private" });
    expect(item?.sharedAt).toBeUndefined();
    const familyMessages = await t.run(async ctx => ctx.db.query("messages").collect());
    expect(familyMessages.filter(message => message.roomId === seeded.familyRoomId)).toEqual([]);
  });
});
