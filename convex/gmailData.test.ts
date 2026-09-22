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
      sender: "trips@greenwood-school.test",
      subject: "Field trip payment due 21 Sep",
      text: "The class field trip fee of Rs 4,320 is due on 21 Sep.",
      useful: true,
      summary: "Greenwood field trip fee of Rs 4,320 is due 21 Sep.",
      category: "school" as const,
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
    expect(await member.query(api.gmailData.pendingForRoom, { roomId: personalRoom!._id })).toEqual([
      expect.objectContaining({ _id: pending[0]._id, sharedAt: expect.any(Number) }),
    ]);

    const persisted = await t.run(async ctx => ({
      markers: await ctx.db.query("gmailProcessedMessages").collect(),
      inbox: await ctx.db.query("inboxItems").collect(),
      messages: await ctx.db.query("messages").collect(),
      jobs: await ctx.db.query("agentJobs").collect(),
    }));
    expect(persisted.markers).toHaveLength(2);
    expect(persisted.inbox).toHaveLength(1);
    expect(persisted.inbox[0]).toMatchObject({ visibility: "space", category: "school" });
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

  test("shares an OTP explicitly and permanently removes every code-bearing row after five minutes", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run(async ctx => {
      const createdAt = Date.now();
      const ownerId = await ctx.db.insert("users", { email: "owner@example.test" });
      const memberId = await ctx.db.insert("users", { email: "member@example.test" });
      const spaceId = await ctx.db.insert("spaces", { name: "Family", createdBy: ownerId, creationKey: "gmail-otp-share", createdAt });
      await ctx.db.insert("memberships", { spaceId, userId: ownerId, role: "owner", status: "active", joinedAt: createdAt });
      await ctx.db.insert("memberships", { spaceId, userId: memberId, role: "member", status: "active", joinedAt: createdAt });
      const familyRoomId = await ctx.db.insert("rooms", { spaceId, type: "shared", title: "Family", assistantMode: "mention", createdBy: ownerId, createdAt });
      await ctx.db.insert("roomMembers", { roomId: familyRoomId, userId: ownerId, role: "manager", createdAt });
      await ctx.db.insert("roomMembers", { roomId: familyRoomId, userId: memberId, role: "participant", createdAt });
      const connectionId = await ctx.db.insert("gmailConnections", {
        spaceId, userId: memberId, connectedAccountId: "ca_member_otp", alias: "Personal Gmail",
        triggerId: "ti_member_otp", status: "active", createdAt,
      });
      return { connectionId, memberId, ownerId, spaceId };
    });
    const member = t.withIdentity({ subject: String(seeded.memberId) });
    const owner = t.withIdentity({ subject: String(seeded.ownerId) });
    const inboxItemId = await member.mutation(internal.gmailData.saveClassification, {
      connectionId: seeded.connectionId,
      externalMessageId: "otp-message-1",
      threadId: "otp-thread-1",
      sender: "signin@example.test",
      subject: "Your sign-in code",
      text: "Your OTP is 481921. Private account detail: ending 9001.",
      html: "<p>Your OTP is 481921. Private account detail: ending 9001.</p>",
      receivedAt: Date.now(),
      useful: true,
      summary: "One-time code available to share for five minutes.",
      category: "security",
      otpCode: "481921",
    });
    expect(inboxItemId).not.toBeNull();
    await member.mutation(api.gmailData.shareWithFamily, { inboxItemId: inboxItemId! });
    const shared = await owner.query(api.inbox.list, { spaceId: seeded.spaceId });
    expect(shared).toEqual([expect.objectContaining({
      _id: inboxItemId,
      category: "security",
      subcategory: "otp",
      extractedOtpCode: "481921",
      ephemeralExpiresAt: expect.any(Number),
    })]);
    expect(shared[0]?.originalHtml).toBeUndefined();
    expect(shared[0]?.originalText).not.toContain("9001");
    expect(shared[0]?.subject).toBe("Shared one-time code");
    await expect(owner.mutation(api.inbox.reprocess, { inboxItemId: inboxItemId! })).rejects.toThrow(/cannot be reprocessed/i);

    const expiredAt = Date.now() - 1;
    await t.run(async ctx => ctx.db.patch(inboxItemId!, { category: "needs_review", ephemeralExpiresAt: expiredAt }));
    await t.mutation(internal.gmailData.expireOtp, { inboxItemId: inboxItemId!, expiresAt: expiredAt });
    const afterExpiry = await t.run(async ctx => ({
      inbox: await ctx.db.query("inboxItems").collect(),
      messages: await ctx.db.query("messages").collect(),
      markers: await ctx.db.query("gmailProcessedMessages").collect(),
      audit: await ctx.db.query("auditEvents").collect(),
    }));
    expect(afterExpiry.inbox).toEqual([]);
    expect(afterExpiry.messages).toEqual([]);
    expect(JSON.stringify(afterExpiry.markers)).not.toContain("481921");
    expect(JSON.stringify(afterExpiry.audit)).not.toContain("481921");

    await owner.mutation(api.spaces.setOtpSharing, { spaceId: seeded.spaceId, enabled: false });
    await expect(member.query(internal.gmailData.otpSharingPolicy, { connectionId: seeded.connectionId })).resolves.toBe(false);
  });

  test("applies each family's OTP policy independently for one connected Gmail account", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run(async ctx => {
      const now = Date.now();
      const userId = await ctx.db.insert("users", { email: "owner@example.test" });
      const disabledSpaceId = await ctx.db.insert("spaces", { name: "Disabled", createdBy: userId, creationKey: "otp-disabled", createdAt: now, otpSharingEnabled: false });
      const enabledSpaceId = await ctx.db.insert("spaces", { name: "Enabled", createdBy: userId, creationKey: "otp-enabled", createdAt: now, otpSharingEnabled: true });
      for (const spaceId of [disabledSpaceId, enabledSpaceId]) {
        await ctx.db.insert("memberships", { spaceId, userId, role: "owner", status: "active", joinedAt: now });
      }
      const disabledConnectionId = await ctx.db.insert("gmailConnections", {
        spaceId: disabledSpaceId, userId, connectedAccountId: "ca_shared_otp", alias: "Gmail", triggerId: "disabled-trigger", status: "active", createdAt: now,
      });
      const enabledConnectionId = await ctx.db.insert("gmailConnections", {
        spaceId: enabledSpaceId, userId, connectedAccountId: "ca_shared_otp", alias: "Gmail", triggerId: "enabled-trigger", status: "active", createdAt: now,
      });
      return { userId, disabledConnectionId, enabledConnectionId };
    });
    const owner = t.withIdentity({ subject: String(seeded.userId) });
    const email = {
      externalMessageId: "same-otp",
      threadId: "same-otp-thread",
      sender: "signin@example.test",
      subject: "Your code",
      text: "OTP is 604912",
      receivedAt: Date.now(),
      useful: true,
      summary: "One-time code available to share for five minutes.",
      category: "security" as const,
      otpCode: "604912",
    };
    await expect(owner.mutation(internal.gmailData.saveClassification, { ...email, connectionId: seeded.disabledConnectionId })).resolves.toBeNull();
    await expect(owner.mutation(internal.gmailData.saveClassification, { ...email, connectionId: seeded.enabledConnectionId })).resolves.not.toBeNull();
    const persisted = await t.run(async ctx => ({
      items: await ctx.db.query("inboxItems").collect(),
      markers: await ctx.db.query("gmailProcessedMessages").collect(),
    }));
    expect(persisted.items).toHaveLength(1);
    expect(persisted.items[0]?.extractedOtpCode).toBe("604912");
    expect(persisted.markers.map(marker => marker.useful).sort()).toEqual([false, true]);
  });

  test("the same Gmail can be enabled in another family and shared there independently", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run(async ctx => {
      const createdAt = Date.now();
      const ownerId = await ctx.db.insert("users", { email: "owner@example.test" });
      const firstSpaceId = await ctx.db.insert("spaces", { name: "Home", createdBy: ownerId, creationKey: "gmail-home", createdAt });
      const secondSpaceId = await ctx.db.insert("spaces", { name: "Parents", createdBy: ownerId, creationKey: "gmail-parents", createdAt });
      await ctx.db.insert("memberships", { spaceId: firstSpaceId, userId: ownerId, role: "owner", status: "active", joinedAt: createdAt });
      await ctx.db.insert("memberships", { spaceId: secondSpaceId, userId: ownerId, role: "owner", status: "active", joinedAt: createdAt });
      const firstRoomId = await ctx.db.insert("rooms", { spaceId: firstSpaceId, type: "shared", title: "Family conversation", assistantMode: "mention", createdBy: ownerId, createdAt });
      const secondRoomId = await ctx.db.insert("rooms", { spaceId: secondSpaceId, type: "shared", title: "Family conversation", assistantMode: "mention", createdBy: ownerId, createdAt });
      await ctx.db.insert("roomMembers", { roomId: firstRoomId, userId: ownerId, role: "manager", createdAt });
      await ctx.db.insert("roomMembers", { roomId: secondRoomId, userId: ownerId, role: "manager", createdAt });
      const connectionId = await ctx.db.insert("gmailConnections", {
        spaceId: firstSpaceId, userId: ownerId, connectedAccountId: "ca_owner_multi", alias: "Personal Gmail",
        triggerId: "ti_owner_multi", status: "active", createdAt,
      });
      return { connectionId, ownerId, firstSpaceId, secondSpaceId, secondRoomId };
    });
    const owner = t.withIdentity({ subject: String(seeded.ownerId) });
    await expect(owner.query(api.gmailData.reusable, { spaceId: seeded.secondSpaceId })).resolves.toEqual([
      expect.objectContaining({ connectedAccountId: "ca_owner_multi" }),
    ]);
    await expect(owner.mutation(api.gmailData.enableForSpace, {
      spaceId: seeded.secondSpaceId, connectedAccountId: "ca_owner_multi",
    })).resolves.toEqual(expect.any(String));
    const inboxItemId = await owner.mutation(internal.gmailData.saveClassification, {
      connectionId: seeded.connectionId,
      threadId: "thread-multi",
      receivedAt: 1_700_000_000_000,
      category: "bills",
      externalMessageId: "useful-multi",
      sender: "billing@example.test",
      subject: "Invoice",
      text: "Pay 900",
      useful: true,
      summary: "Invoice",
      amount: "900",
    });
    await owner.mutation(api.gmailData.shareWithFamily, { inboxItemId: inboxItemId! });
    const copyId = await owner.mutation(api.gmailData.shareWithSpace, { inboxItemId: inboxItemId!, spaceId: seeded.secondSpaceId });
    await expect(owner.mutation(api.gmailData.shareWithSpace, { inboxItemId: inboxItemId!, spaceId: seeded.secondSpaceId })).resolves.toEqual(copyId);
    const copy = await t.run(ctx => ctx.db.get(copyId));
    expect(copy).toMatchObject({ spaceId: seeded.secondSpaceId, visibility: "space", agentmailMessageId: "gmail:ca_owner_multi:useful-multi" });
    const source = await t.run(ctx => ctx.db.get(inboxItemId!));
    expect(source?.forwardedSpaceIds).toContain(seeded.secondSpaceId);
    const parentMessages = await t.run(async ctx => ctx.db.query("messages").collect());
    expect(parentMessages.filter(message => message.roomId === seeded.secondRoomId)).toHaveLength(1);
  });
});
