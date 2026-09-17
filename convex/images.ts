import { v } from "convex/values";
import { action, internalMutation, internalQuery, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { requireRoomPermission } from "./lib/authz";
import { generateFamilyImageBytes } from "./lib/imageGeneration";
import { resolveOpenRouterKey } from "./lib/providerKeys";
import { composeFamilyImagePrompt, familySafeImageFailure, imageKindValidator, imageLanguageValidator, imageStyleValidator, isImageKind, isImageLanguage, isImageStyle, type ImageKind, type ImageLanguage, type ImageStyle } from "./lib/imageSafety";
import { SAATHI_IMAGE_MODEL } from "./lib/saathi";

export const forRoom = query({
  args: { roomId: v.id("rooms"), limit: v.optional(v.number()) },
  returns: v.array(v.object({
    _id: v.id("generatedImages"), createdAt: v.number(), prompt: v.string(), model: v.string(),
    mediaType: v.string(), url: v.union(v.string(), v.null()),
    kind: v.optional(imageKindValidator),
    style: v.optional(imageStyleValidator),
    language: v.optional(v.union(v.literal("en"), v.literal("hi"), v.literal("mr"))),
  })),
  handler: async (ctx, { roomId, limit }) => {
    await requireRoomPermission(ctx, roomId, "read");
    const images = await ctx.db.query("generatedImages").withIndex("by_room_created", q =>
      q.eq("roomId", roomId),
    ).order("desc").take(Math.min(Math.max(limit ?? 20, 1), 50));
    return Promise.all(images.map(async image => ({
      _id: image._id, createdAt: image.createdAt, prompt: image.prompt,
      model: image.model, mediaType: image.mediaType, url: await ctx.storage.getUrl(image.storageId),
      kind: image.kind, style: image.style, language: image.language,
    })));
  },
});

export const createFromVoice = action({
  args: {
    roomId: v.id("rooms"),
    prompt: v.string(),
    kind: v.optional(v.string()),
    style: v.optional(v.string()),
    language: v.optional(v.string()),
  },
  returns: v.object({ ok: v.boolean(), message: v.string(), imageUrl: v.optional(v.string()) }),
  handler: async (ctx, args): Promise<{ ok: boolean; message: string; imageUrl?: string }> => {
    const prepared: { userId: Id<"users">; spaceId: Id<"spaces">; style: ImageStyle; language: ImageLanguage } | null =
      await ctx.runQuery(internal.images.prepareCreate, { roomId: args.roomId });
    if (!prepared) return { ok: false, message: "You do not have permission to add an image here." };
    const blocked = familySafeImageFailure(args.prompt);
    if (blocked) return { ok: false, message: blocked };
    const kind: ImageKind = isImageKind(args.kind) ? args.kind : "scene";
    const style: ImageStyle = isImageStyle(args.style) ? args.style : prepared.style;
    const language: ImageLanguage = isImageLanguage(args.language) ? args.language : prepared.language;
    try {
      const prompt = composeFamilyImagePrompt({ prompt: args.prompt, kind, style, language });
      const generated = await generateFamilyImageBytes(prompt, await resolveOpenRouterKey(ctx, prepared.spaceId));
      const storageId = await ctx.storage.store(new Blob([generated.bytes], { type: generated.mediaType }));
      const saved = await ctx.runMutation(internal.images.save, {
        roomId: args.roomId, storageId, prompt: args.prompt.trim(), mediaType: generated.mediaType, kind, style, language,
      });
      if (!saved) {
        await ctx.storage.delete(storageId);
        return { ok: false, message: "The image was discarded because room access changed." };
      }
      const imageUrl = await ctx.storage.getUrl(storageId);
      return {
        ok: true,
        message: "The family-safe image is now in this conversation.",
        imageUrl: imageUrl ?? undefined,
      };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : "Saathi could not create that image." };
    }
  },
});

export const prepareCreate = internalQuery({
  args: { roomId: v.id("rooms") },
  returns: v.union(v.object({
    userId: v.id("users"),
    spaceId: v.id("spaces"),
    style: imageStyleValidator,
    language: imageLanguageValidator,
  }), v.null()),
  handler: async (ctx, { roomId }) => {
    try {
      const { userId, user, room } = await requireRoomPermission(ctx, roomId, "post_message");
      return {
        userId,
        spaceId: room.spaceId,
        style: user.preferredImageStyle ?? "warm_family",
        language: user.preferredLanguage ?? "en",
      };
    } catch {
      return null;
    }
  },
});

export const save = internalMutation({
  args: {
    roomId: v.id("rooms"), storageId: v.id("_storage"), prompt: v.string(), mediaType: v.string(),
    kind: imageKindValidator,
    style: imageStyleValidator,
    language: imageLanguageValidator,
  },
  returns: v.union(v.id("generatedImages"), v.null()),
  handler: async (ctx, args) => {
    const { userId, room } = await requireRoomPermission(ctx, args.roomId, "post_message");
    return ctx.db.insert("generatedImages", {
      spaceId: room.spaceId, roomId: room._id, requestedBy: userId,
      storageId: args.storageId, prompt: args.prompt, model: SAATHI_IMAGE_MODEL, mediaType: args.mediaType,
      createdAt: Date.now(), kind: args.kind, style: args.style, language: args.language,
    });
  },
});
