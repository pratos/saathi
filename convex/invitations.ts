import { HOUR, RateLimiter } from "@convex-dev/rate-limiter";
import { ConvexError, v } from "convex/values";
import { components, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, env, internalMutation, mutation, query } from "./_generated/server";
import { requireSpacePermission, requireUser } from "./lib/authz";

const invitationLimits = new RateLimiter(components.rateLimiter, {
  createInvitation: { kind: "fixed window", rate: 10, period: HOUR },
});

const invitationSummary = v.object({
  _id: v.id("invitations"),
  targetEmail: v.string(),
  role: v.union(v.literal("owner"), v.literal("member")),
  createdAt: v.number(),
  expiresAt: v.number(),
  acceptedAt: v.optional(v.number()),
  revokedAt: v.optional(v.number()),
  expired: v.boolean(),
});

export const list = query({
  args: { spaceId: v.id("spaces") },
  returns: v.array(invitationSummary),
  handler: async (ctx, { spaceId }) => {
    await requireSpacePermission(ctx, spaceId, "manage_members");
    const rows = await ctx.db.query("invitations").withIndex("by_space_created", q => q.eq("spaceId", spaceId)).order("desc").take(30);
    const now = Date.now();
    return rows.map(({ _id, _creationTime, targetEmail, role, createdAt, expiresAt, acceptedAt, revokedAt }) => ({
      _id, targetEmail, role, createdAt: createdAt ?? _creationTime, expiresAt, acceptedAt, revokedAt, expired: expiresAt <= now,
    }));
  },
});

export const createAndSend = action({
  args: {
    spaceId: v.id("spaces"),
    targetEmail: v.string(),
    role: v.union(v.literal("owner"), v.literal("member")),
    clientOperationId: v.string(),
  },
  returns: v.object({ invitationId: v.id("invitations"), expiresAt: v.number() }),
  handler: async (ctx, args): Promise<{ invitationId: Id<"invitations">; expiresAt: number }> => {
    const token = randomToken();
    const tokenHash = await sha256(token);
    const created: { invitationId: Id<"invitations">; expiresAt: number; targetEmail: string; familyName: string; existing: boolean } =
      await ctx.runMutation(internal.invitations.createRecord, { ...args, tokenHash });
    if (created.existing) return { invitationId: created.invitationId, expiresAt: created.expiresAt };

    const siteUrl = env.SITE_URL.replace(/\/$/, "");
    const inviteUrl = `${siteUrl}/?mode=live&invite=${encodeURIComponent(token)}`;
    const response = await fetch(
      `https://api.agentmail.to/v0/inboxes/${encodeURIComponent(env.AGENTMAIL_AUTH_INBOX_ID.trim())}/messages/send`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${env.AGENTMAIL_API_KEY.trim()}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          to: created.targetEmail,
          subject: `Join ${created.familyName} on Saath`,
          text: `You have been invited to join ${created.familyName} on Saath. Sign in with this email address to accept:\n\n${inviteUrl}\n\nThis invitation expires in 7 days.`,
          labels: ["saath-family-invitation"],
        }),
      },
    );
    if (!response.ok) {
      console.error("INVITATION_DELIVERY_REJECTED", response.status);
      await ctx.runMutation(internal.invitations.revokeUndelivered, { invitationId: created.invitationId });
      throw new ConvexError({ code: "INVITATION_DELIVERY_FAILED", message: "The invitation email could not be sent" });
    }
    return { invitationId: created.invitationId, expiresAt: created.expiresAt };
  },
});

export const createRecord = internalMutation({
  args: {
    spaceId: v.id("spaces"), targetEmail: v.string(), role: v.union(v.literal("owner"), v.literal("member")),
    clientOperationId: v.string(), tokenHash: v.string(),
  },
  returns: v.object({
    invitationId: v.id("invitations"), expiresAt: v.number(), targetEmail: v.string(),
    familyName: v.string(), existing: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const { userId, user } = await requireSpacePermission(ctx, args.spaceId, "manage_members");
    if (!/^[A-Za-z0-9_-]{8,128}$/.test(args.clientOperationId)) throw new ConvexError({ code: "INVALID_ARGUMENT", message: "Invalid operation ID" });
    const targetEmail = normalizeEmail(args.targetEmail);
    if (user.email && normalizeEmail(user.email) === targetEmail) {
      throw new ConvexError({ code: "INVALID_ARGUMENT", message: "You already belong to this family" });
    }
    const existing = await ctx.db.query("invitations").withIndex("by_creator_idempotency", q => q.eq("createdBy", userId).eq("idempotencyKey", args.clientOperationId)).unique();
    if (existing) {
      if (existing.spaceId !== args.spaceId || existing.targetEmail !== targetEmail || existing.role !== args.role) {
        throw new ConvexError({ code: "IDEMPOTENCY_CONFLICT", message: "Operation ID already used" });
      }
      const space = await ctx.db.get(args.spaceId);
      if (!space) throw new ConvexError({ code: "NOT_FOUND", message: "Family space not found" });
      if (existing.revokedAt && !existing.acceptedAt) {
        const now = Date.now();
        const expiresAt = now + 7 * 24 * HOUR;
        await ctx.db.patch(existing._id, { tokenHash: args.tokenHash, revokedAt: undefined, createdAt: now, expiresAt });
        return { invitationId: existing._id, expiresAt, targetEmail, familyName: space.name, existing: false };
      }
      return { invitationId: existing._id, expiresAt: existing.expiresAt, targetEmail, familyName: space.name, existing: true };
    }
    const limit = await invitationLimits.limit(ctx, "createInvitation", { key: String(userId) });
    if (!limit.ok) throw new ConvexError({ code: "RATE_LIMITED", retryAfter: limit.retryAfter });
    const space = await ctx.db.get(args.spaceId);
    if (!space) throw new ConvexError({ code: "NOT_FOUND", message: "Family space not found" });
    const now = Date.now();
    const expiresAt = now + 7 * 24 * HOUR;
    const invitationId = await ctx.db.insert("invitations", {
      spaceId: args.spaceId, tokenHash: args.tokenHash, targetEmail, role: args.role, createdBy: userId,
      idempotencyKey: args.clientOperationId, createdAt: now, expiresAt,
    });
    await ctx.db.insert("auditEvents", {
      spaceId: args.spaceId, actorUserId: userId, action: "invitation.created", resourceType: "invitation",
      resourceId: String(invitationId), metadata: { role: args.role }, createdAt: now,
    });
    return { invitationId, expiresAt, targetEmail, familyName: space.name, existing: false };
  },
});

export const revokeUndelivered = internalMutation({
  args: { invitationId: v.id("invitations") },
  returns: v.null(),
  handler: async (ctx, { invitationId }) => {
    const invitation = await ctx.db.get(invitationId);
    if (!invitation || invitation.acceptedAt || invitation.revokedAt) return null;
    await requireSpacePermission(ctx, invitation.spaceId, "manage_members");
    await ctx.db.patch(invitationId, { revokedAt: Date.now() });
    return null;
  },
});

export const revoke = mutation({
  args: { invitationId: v.id("invitations") },
  returns: v.null(),
  handler: async (ctx, { invitationId }) => {
    const invitation = await ctx.db.get(invitationId);
    if (!invitation) throw new ConvexError({ code: "NOT_FOUND", message: "Invitation not found" });
    const { userId } = await requireSpacePermission(ctx, invitation.spaceId, "manage_members");
    if (!invitation.revokedAt && !invitation.acceptedAt) {
      const now = Date.now();
      await ctx.db.patch(invitationId, { revokedAt: now });
      await ctx.db.insert("auditEvents", {
        spaceId: invitation.spaceId, actorUserId: userId, action: "invitation.revoked", resourceType: "invitation",
        resourceId: String(invitationId), createdAt: now,
      });
    }
    return null;
  },
});

export const accept = mutation({
  args: { tokenHash: v.string() },
  returns: v.id("spaces"),
  handler: async (ctx, { tokenHash }) => {
    const { userId, user } = await requireUser(ctx);
    if (!/^[a-f0-9]{64}$/.test(tokenHash)) throw new ConvexError({ code: "INVITATION_INVALID", message: "Invitation is invalid" });
    const invitation = await ctx.db.query("invitations").withIndex("by_token_hash", q => q.eq("tokenHash", tokenHash)).unique();
    if (!invitation || invitation.revokedAt) throw new ConvexError({ code: "INVITATION_INVALID", message: "Invitation is invalid" });
    const email = user.email ? normalizeEmail(user.email) : "";
    if (email !== invitation.targetEmail) throw new ConvexError({ code: "INVITATION_WRONG_USER", message: "Sign in with the invited email address" });
    if (invitation.acceptedAt) {
      if (invitation.acceptedByUserId === userId) return invitation.spaceId;
      throw new ConvexError({ code: "INVITATION_USED", message: "Invitation has already been used" });
    }
    if (invitation.expiresAt <= Date.now()) throw new ConvexError({ code: "INVITATION_EXPIRED", message: "Invitation has expired" });

    const now = Date.now();
    const membership = await ctx.db.query("memberships").withIndex("by_space_user", q => q.eq("spaceId", invitation.spaceId).eq("userId", userId)).unique();
    // Only an already-active owner keeps owner; a revoked former owner must not regain it from a member invite.
    const membershipRole = membership?.status === "active" && membership.role === "owner" ? "owner" as const : invitation.role;
    if (membership) await ctx.db.patch(membership._id, { role: membershipRole, status: "active", joinedAt: now });
    else await ctx.db.insert("memberships", { spaceId: invitation.spaceId, userId, role: invitation.role, status: "active", joinedAt: now });
    const rooms = await ctx.db.query("rooms").withIndex("by_space", q => q.eq("spaceId", invitation.spaceId)).collect();
    for (const room of rooms.filter(room => room.type === "shared" && !room.archivedAt)) {
      const grant = await ctx.db.query("roomMembers").withIndex("by_room_user", q => q.eq("roomId", room._id).eq("userId", userId)).unique();
      const roomRole = membershipRole === "owner" ? "manager" as const : "participant" as const;
      if (grant) await ctx.db.patch(grant._id, { role: roomRole });
      else await ctx.db.insert("roomMembers", { roomId: room._id, userId, role: roomRole, createdAt: now });
    }
    await ctx.db.patch(invitation._id, { acceptedAt: now, acceptedByUserId: userId });
    await ctx.db.insert("auditEvents", {
      spaceId: invitation.spaceId, actorUserId: userId, action: "invitation.accepted", resourceType: "invitation",
      resourceId: String(invitation._id), metadata: { role: invitation.role }, createdAt: now,
    });
    return invitation.spaceId;
  },
});

function normalizeEmail(value: string) {
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ConvexError({ code: "INVALID_ARGUMENT", message: "Enter a valid email address" });
  }
  return email;
}

function randomToken() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}
