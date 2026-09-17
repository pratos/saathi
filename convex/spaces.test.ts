import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api.js";
import type { Id } from "./_generated/dataModel.js";
import schema from "./schema.js";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

describe("family inbox configuration", () => {
  test("the server-owned inbox path enforces ownership and tenant isolation", async () => {
    const t = convexTest(schema, modules);
    const { firstSpaceId, secondSpaceId, ownerId, memberId } = await seedFamilies(t);
    const owner = t.withIdentity({ subject: String(ownerId) });
    const member = t.withIdentity({ subject: String(memberId) });

    await expect(member.mutation(internal.spaces.attachCreatedInbox, {
      spaceId: firstSpaceId,
      inboxId: "member-attempt",
    })).rejects.toThrow(/permission/i);

    await expect(owner.mutation(internal.spaces.attachCreatedInbox, {
      spaceId: firstSpaceId,
      inboxId: "family-inbox-1",
    })).resolves.toBeNull();

    expect(await t.run((ctx) => ctx.db.get(firstSpaceId))).toMatchObject({
      agentmailInboxId: "family-inbox-1",
    });

    await expect(owner.mutation(internal.spaces.attachCreatedInbox, {
      spaceId: secondSpaceId,
      inboxId: "family-inbox-1",
    })).rejects.toThrow(/INBOX_ALREADY_CONNECTED/);

    await owner.mutation(api.spaces.create, { name: "Third family", creationKey: "third-family-key" });
    await expect(owner.mutation(api.spaces.create, { name: "Fourth family", creationKey: "fourth-family-key" }))
      .rejects.toThrow(/FAMILY_LIMIT/);

    const auditEvents = await t.run((ctx) => ctx.db.query("auditEvents").collect());
    expect(auditEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        action: "space.inbox_created",
        actorUserId: ownerId,
        resourceId: String(firstSpaceId),
        spaceId: firstSpaceId,
      }),
    ]));
  });
});

async function seedFamilies(t: TestConvex<typeof schema>) {
  return t.run(async (ctx) => {
    const now = Date.now();
    const ownerId = await ctx.db.insert("users", { email: "owner@example.test" });
    const memberId = await ctx.db.insert("users", { email: "member@example.test" });
    const firstSpaceId = await ctx.db.insert("spaces", {
      name: "First family",
      createdBy: ownerId,
      creationKey: "first-family",
      createdAt: now,
    });
    const secondSpaceId = await ctx.db.insert("spaces", {
      name: "Second family",
      createdBy: ownerId,
      creationKey: "second-family",
      createdAt: now,
    });
    await ctx.db.insert("memberships", { spaceId: firstSpaceId, userId: ownerId, role: "owner", status: "active", joinedAt: now });
    await ctx.db.insert("memberships", { spaceId: firstSpaceId, userId: memberId, role: "member", status: "active", joinedAt: now });
    await ctx.db.insert("memberships", { spaceId: secondSpaceId, userId: ownerId, role: "owner", status: "active", joinedAt: now });
    return { firstSpaceId, secondSpaceId, ownerId, memberId } satisfies {
      firstSpaceId: Id<"spaces">;
      secondSpaceId: Id<"spaces">;
      ownerId: Id<"users">;
      memberId: Id<"users">;
    };
  });
}
