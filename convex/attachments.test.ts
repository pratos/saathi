import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api.js";
import type { Id } from "./_generated/dataModel.js";
import schema from "./schema.js";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

describe("chat attachments", () => {
  test("stores an authorized upload once and exposes it only to room members", async () => {
    const t = convexTest(schema, modules);
    const { roomId, ownerId, memberId, outsiderId } = await seedRoom(t);
    const owner = t.withIdentity({ subject: String(ownerId) });
    const member = t.withIdentity({ subject: String(memberId) });
    const outsider = t.withIdentity({ subject: String(outsiderId) });
    const storageId = await t.run(ctx => ctx.storage.store(new Blob(["family document"], { type: "application/pdf" })));

    await expect(outsider.mutation(api.attachments.submit, {
      roomId, storageId, fileName: "private.pdf", mediaType: "application/pdf", clientOperationId: "outsider-upload-001",
    })).rejects.toThrow(/permission/i);

    const created = await owner.mutation(api.attachments.submit, {
      roomId, storageId, fileName: "folder/private.pdf", mediaType: "application/pdf", clientOperationId: "owner-upload-001",
    });
    await expect(owner.mutation(api.attachments.submit, {
      roomId, storageId, fileName: "ignored.pdf", mediaType: "application/pdf", clientOperationId: "owner-upload-001",
    })).resolves.toEqual(created);

    const visible = await member.query(api.attachments.forRoom, { roomId });
    expect(visible).toEqual([
      expect.objectContaining({
        _id: created.attachmentId,
        messageId: created.messageId,
        fileName: "folder_private.pdf",
        mediaType: "application/pdf",
        sizeBytes: 15,
      }),
    ]);
    await expect(outsider.query(api.attachments.forRoom, { roomId })).rejects.toThrow(/permission/i);

    const messages = await owner.query(api.rooms.messages, { roomId });
    expect(messages).toHaveLength(1);
    expect(messages[0].originalText).toBe("[Attachment: folder_private.pdf]");
    expect(visible[0].kind).toBe("document");
    expect(visible[0].transcriptStatus).toBe("pending");
  });

  test("marks camera photos for small-model reading and receipts as receipts", async () => {
    const t = convexTest(schema, modules);
    const { roomId, ownerId } = await seedRoom(t);
    const owner = t.withIdentity({ subject: String(ownerId) });
    const photoId = await t.run(ctx => ctx.storage.store(new Blob(["photo"], { type: "image/jpeg" })));
    const receiptId = await t.run(ctx => ctx.storage.store(new Blob(["bill"], { type: "image/jpeg" })));

    await owner.mutation(api.attachments.submit, {
      roomId, storageId: photoId, fileName: "kitchen.jpg", mediaType: "image/jpeg",
      clientOperationId: "photo-upload-001", capture: "camera",
    });
    await owner.mutation(api.attachments.submit, {
      roomId, storageId: receiptId, fileName: "swiggy.jpg", mediaType: "image/jpeg",
      clientOperationId: "receipt-upload-001", capture: "receipt",
    });

    const files = await owner.query(api.attachments.forRoom, { roomId });
    expect(files).toEqual(expect.arrayContaining([
      expect.objectContaining({ fileName: "kitchen.jpg", kind: "photo", transcriptStatus: "pending" }),
      expect.objectContaining({ fileName: "swiggy.jpg", kind: "receipt", transcriptStatus: "pending" }),
    ]));
  });

  test("rejects unsupported content without creating a message", async () => {
    const t = convexTest(schema, modules);
    const { roomId, ownerId } = await seedRoom(t);
    const owner = t.withIdentity({ subject: String(ownerId) });
    const storageId = await t.run(ctx => ctx.storage.store(new Blob(["binary"], { type: "application/octet-stream" })));

    await expect(owner.mutation(api.attachments.submit, {
      roomId, storageId, fileName: "unsafe.bin", mediaType: "application/octet-stream", clientOperationId: "unsupported-upload-001",
    })).rejects.toThrow(/supported/i);
    expect(await owner.query(api.rooms.messages, { roomId })).toEqual([]);
  });
});

async function seedRoom(t: TestConvex<typeof schema>) {
  return t.run(async (ctx) => {
    const now = Date.now();
    const ownerId = await ctx.db.insert("users", { email: "owner@example.test" });
    const memberId = await ctx.db.insert("users", { email: "member@example.test" });
    const outsiderId = await ctx.db.insert("users", { email: "outsider@example.test" });
    const spaceId = await ctx.db.insert("spaces", { name: "Family", createdBy: ownerId, creationKey: "family-create-001", createdAt: now });
    const roomId = await ctx.db.insert("rooms", { spaceId, type: "shared", title: "Family conversation", assistantMode: "automatic", createdBy: ownerId, createdAt: now });
    await ctx.db.insert("memberships", { spaceId, userId: ownerId, role: "owner", status: "active", joinedAt: now });
    await ctx.db.insert("memberships", { spaceId, userId: memberId, role: "member", status: "active", joinedAt: now });
    await ctx.db.insert("roomMembers", { roomId, userId: ownerId, role: "manager", createdAt: now });
    await ctx.db.insert("roomMembers", { roomId, userId: memberId, role: "participant", createdAt: now });
    return { roomId, ownerId, memberId, outsiderId } satisfies {
      roomId: Id<"rooms">;
      ownerId: Id<"users">;
      memberId: Id<"users">;
      outsiderId: Id<"users">;
    };
  });
}
