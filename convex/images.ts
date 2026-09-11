import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireRoomPermission } from "./lib/authz";

export const forRoom = query({
  args: { roomId: v.id("rooms"), limit: v.optional(v.number()) },
  returns: v.array(v.object({
    _id: v.id("generatedImages"), createdAt: v.number(), prompt: v.string(), model: v.string(),
    mediaType: v.string(), url: v.union(v.string(), v.null()),
  })),
  handler: async (ctx, { roomId, limit }) => {
    await requireRoomPermission(ctx, roomId, "read");
    const images = await ctx.db.query("generatedImages").withIndex("by_room_created", q =>
      q.eq("roomId", roomId),
    ).order("desc").take(Math.min(Math.max(limit ?? 20, 1), 50));
    return Promise.all(images.map(async image => ({
      _id: image._id, createdAt: image.createdAt, prompt: image.prompt,
      model: image.model, mediaType: image.mediaType, url: await ctx.storage.getUrl(image.storageId),
    })));
  },
});
