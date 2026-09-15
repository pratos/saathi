import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api.js";
import type { Id } from "./_generated/dataModel.js";
import schema from "./schema.js";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

describe("family invitations", () => {
  test("only the invited identity can accept an unexpired token, and acceptance is idempotent", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seedInvitation(t, Date.now() + 60_000);
    const invited = t.withIdentity({ subject: String(seeded.invitedId) });
    const wrong = t.withIdentity({ subject: String(seeded.wrongId) });

    await expect(wrong.mutation(api.invitations.accept, { tokenHash: seeded.tokenHash })).rejects.toThrow(/invited email/i);
    await expect(invited.mutation(api.invitations.accept, { tokenHash: seeded.tokenHash })).resolves.toEqual(seeded.spaceId);
    await expect(invited.mutation(api.invitations.accept, { tokenHash: seeded.tokenHash })).resolves.toEqual(seeded.spaceId);

    const membership = await t.run(ctx => ctx.db.query("memberships").withIndex("by_space_user", q => q.eq("spaceId", seeded.spaceId).eq("userId", seeded.invitedId)).unique());
    const roomGrant = await t.run(ctx => ctx.db.query("roomMembers").withIndex("by_room_user", q => q.eq("roomId", seeded.roomId).eq("userId", seeded.invitedId)).unique());
    expect(membership).toMatchObject({ role: "member", status: "active" });
    expect(roomGrant).toMatchObject({ role: "participant" });
    expect(await t.run(ctx => ctx.db.query("memberships").collect())).toHaveLength(2);
  });

  test("rejects expired invitations without granting family or room access", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seedInvitation(t, Date.now() - 1);
    const invited = t.withIdentity({ subject: String(seeded.invitedId) });

    await expect(invited.mutation(api.invitations.accept, { tokenHash: seeded.tokenHash })).rejects.toThrow(/expired/i);
    expect(await t.run(ctx => ctx.db.query("memberships").withIndex("by_space_user", q => q.eq("spaceId", seeded.spaceId).eq("userId", seeded.invitedId)).unique())).toBeNull();
    expect(await t.run(ctx => ctx.db.query("roomMembers").withIndex("by_room_user", q => q.eq("roomId", seeded.roomId).eq("userId", seeded.invitedId)).unique())).toBeNull();
  });
});

async function seedInvitation(t: TestConvex<typeof schema>, expiresAt: number) {
  return t.run(async ctx => {
    const now = Date.now();
    const ownerId = await ctx.db.insert("users", { email: "owner@example.test" });
    const invitedId = await ctx.db.insert("users", { email: " INVITED@example.test " });
    const wrongId = await ctx.db.insert("users", { email: "wrong@example.test" });
    const spaceId = await ctx.db.insert("spaces", { name: "Family", createdBy: ownerId, creationKey: "family-create-001", createdAt: now });
    const roomId = await ctx.db.insert("rooms", { spaceId, type: "shared", title: "Family conversation", assistantMode: "mention", createdBy: ownerId, createdAt: now });
    await ctx.db.insert("memberships", { spaceId, userId: ownerId, role: "owner", status: "active", joinedAt: now });
    await ctx.db.insert("roomMembers", { roomId, userId: ownerId, role: "manager", createdAt: now });
    const tokenHash = "a".repeat(64);
    await ctx.db.insert("invitations", {
      spaceId, tokenHash, targetEmail: "invited@example.test", role: "member", createdBy: ownerId,
      idempotencyKey: "invite-operation-001", createdAt: now, expiresAt,
    });
    return { ownerId, invitedId, wrongId, spaceId, roomId, tokenHash } satisfies {
      ownerId: Id<"users">; invitedId: Id<"users">; wrongId: Id<"users">;
      spaceId: Id<"spaces">; roomId: Id<"rooms">; tokenHash: string;
    };
  });
}
