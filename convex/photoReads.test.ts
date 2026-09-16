import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api.js";
import type { Id } from "./_generated/dataModel.js";
import schema from "./schema.js";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

describe("photo reading", () => {
  test("stores a small-model caption and receipt fields on the attachment", async () => {
    const t = convexTest(schema, modules);
    const { roomId, ownerId } = await seedRoom(t);
    const owner = t.withIdentity({ subject: String(ownerId) });
    const storageId = await t.run(ctx => ctx.storage.store(new Blob(["bill"], { type: "image/jpeg" })));
    const created = await owner.mutation(api.attachments.submit, {
      roomId, storageId, fileName: "zomato.jpg", mediaType: "image/jpeg",
      clientOperationId: "receipt-read-001", capture: "receipt",
    });

    await t.mutation(internal.attachments.savePhotoRead, {
      attachmentId: created.attachmentId,
      transcript: "Zomato order for paneer wrap",
      extractedAmount: "₹240",
      extractedMerchant: "Zomato",
      kind: "receipt",
    });

    const files = await owner.query(api.attachments.forRoom, { roomId });
    expect(files[0]).toMatchObject({
      kind: "receipt",
      transcriptStatus: "ready",
      transcript: "Zomato order for paneer wrap",
      extractedAmount: "₹240",
      extractedMerchant: "Zomato",
    });
    expect((await owner.query(api.rooms.messages, { roomId }))[0].originalText).toContain("Zomato");
  });
});

async function seedRoom(t: TestConvex<typeof schema>) {
  return t.run(async ctx => {
    const now = Date.now();
    const ownerId = await ctx.db.insert("users", { email: "owner@example.test" });
    const spaceId = await ctx.db.insert("spaces", { name: "Family", createdBy: ownerId, creationKey: "photo-family", createdAt: now });
    const roomId = await ctx.db.insert("rooms", { spaceId, type: "shared", title: "Family", assistantMode: "mention", createdBy: ownerId, createdAt: now });
    await ctx.db.insert("memberships", { spaceId, userId: ownerId, role: "owner", status: "active", joinedAt: now });
    await ctx.db.insert("roomMembers", { roomId, userId: ownerId, role: "manager", createdAt: now });
    return { roomId, ownerId } satisfies { roomId: Id<"rooms">; ownerId: Id<"users"> };
  });
}
