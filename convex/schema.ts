import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const language = v.union(v.literal("en"), v.literal("hi"), v.literal("mr"));
const visibility = v.union(v.literal("private"), v.literal("room"), v.literal("space"));
const { users: _authUsers, ...authTablesWithoutUsers } = authTables;
void _authUsers;

export default defineSchema({
  ...authTablesWithoutUsers,
  // Convex Auth's users table, extended with Saath-owned profile fields.
  users: defineTable({
    name: v.optional(v.string()), image: v.optional(v.string()), email: v.optional(v.string()),
    emailVerificationTime: v.optional(v.number()), phone: v.optional(v.string()),
    phoneVerificationTime: v.optional(v.number()), isAnonymous: v.optional(v.boolean()),
    displayName: v.optional(v.string()), preferredLanguage: v.optional(language),
  }).index("email", ["email"]).index("phone", ["phone"]),
  spaces: defineTable({
    name: v.string(),
    agentmailInboxId: v.optional(v.string()),
    createdBy: v.id("users"),
    creationKey: v.string(),
    createdAt: v.number(),
  }).index("by_agentmail_inbox", ["agentmailInboxId"]).index("by_creator_key", ["createdBy", "creationKey"]),
  memberships: defineTable({
    spaceId: v.id("spaces"), userId: v.id("users"),
    role: v.union(v.literal("owner"), v.literal("member")),
    status: v.union(v.literal("active"), v.literal("revoked")),
    joinedAt: v.number(),
  }).index("by_user_status", ["userId", "status"]).index("by_space_user", ["spaceId", "userId"]),
  rooms: defineTable({
    spaceId: v.id("spaces"),
    type: v.union(v.literal("private"), v.literal("shared"), v.literal("case")),
    title: v.string(), assistantMode: v.union(v.literal("automatic"), v.literal("mention"), v.literal("off")),
    createdBy: v.id("users"), createdAt: v.number(), archivedAt: v.optional(v.number()),
  }).index("by_space", ["spaceId"]),
  roomMembers: defineTable({
    roomId: v.id("rooms"), userId: v.id("users"),
    role: v.union(v.literal("manager"), v.literal("participant"), v.literal("viewer")),
    createdAt: v.number(),
  }).index("by_room_user", ["roomId", "userId"]).index("by_user", ["userId"]),
  inboxItems: defineTable({
    spaceId: v.id("spaces"), roomId: v.optional(v.id("rooms")),
    agentmailMessageId: v.string(), agentmailThreadId: v.string(), sender: v.string(),
    subject: v.string(), originalText: v.string(), originalHtml: v.optional(v.string()),
    detectedLanguage: v.optional(language), visibility, privateOwnerId: v.optional(v.id("users")),
    category: v.union(v.literal("bills"), v.literal("school"), v.literal("travel"), v.literal("subscriptions"), v.literal("home"), v.literal("receipts"), v.literal("needs_review")),
    status: v.union(v.literal("received"), v.literal("processing"), v.literal("ready"), v.literal("failed")),
    extractedAmount: v.optional(v.string()), extractedDueAt: v.optional(v.number()),
    receivedAt: v.number(),
  }).index("by_agentmail_message", ["agentmailMessageId"]).index("by_space_received", ["spaceId", "receivedAt"]).index("by_space_category_received", ["spaceId", "category", "receivedAt"]),
  emailThreads: defineTable({
    spaceId: v.id("spaces"), roomId: v.optional(v.id("rooms")), inboxId: v.string(), threadId: v.string(),
    allowedSenders: v.array(v.string()), status: v.union(v.literal("active"), v.literal("closed")), createdAt: v.number(),
  }).index("by_inbox_thread", ["inboxId", "threadId"]).index("by_space", ["spaceId"]),
  messages: defineTable({
    spaceId: v.id("spaces"), roomId: v.id("rooms"), authorUserId: v.optional(v.id("users")),
    actorType: v.union(v.literal("user"), v.literal("assistant"), v.literal("email_guest")),
    origin: v.union(v.literal("app"), v.literal("agentmail"), v.literal("assistant")),
    originalText: v.string(), language, idempotencyKey: v.string(), createdAt: v.number(),
  }).index("by_room_created", ["roomId", "createdAt"]).index("by_room_idempotency", ["roomId", "idempotencyKey"]),
  voiceNotes: defineTable({
    spaceId: v.id("spaces"), roomId: v.id("rooms"), messageId: v.id("messages"),
    authorUserId: v.id("users"), storageId: v.id("_storage"), mediaType: v.string(),
    sizeBytes: v.number(), durationMs: v.number(),
    status: v.union(v.literal("pending"), v.literal("transcribing"), v.literal("ready"), v.literal("failed")),
    transcript: v.optional(v.string()), detectedLanguage: v.optional(v.string()),
    failureCode: v.optional(v.string()), createdAt: v.number(), completedAt: v.optional(v.number()),
  }).index("by_message", ["messageId"]).index("by_room_created", ["roomId", "createdAt"]),
  generatedImages: defineTable({
    spaceId: v.id("spaces"), roomId: v.id("rooms"), requestedBy: v.id("users"),
    prompt: v.string(), model: v.string(), storageId: v.id("_storage"), mediaType: v.string(), createdAt: v.number(),
  }).index("by_room_created", ["roomId", "createdAt"]),
  translations: defineTable({
    messageId: v.optional(v.id("messages")), inboxItemId: v.optional(v.id("inboxItems")),
    targetLanguage: language, text: v.string(), model: v.string(), confidence: v.optional(v.number()), createdAt: v.number(),
  }).index("by_message_language", ["messageId", "targetLanguage"]).index("by_inbox_language", ["inboxItemId", "targetLanguage"]),
  tasks: defineTable({
    spaceId: v.id("spaces"), sourceInboxItemId: v.optional(v.id("inboxItems")), roomId: v.optional(v.id("rooms")),
    title: v.string(), assigneeUserId: v.optional(v.id("users")), dueAt: v.optional(v.number()),
    status: v.union(v.literal("open"), v.literal("done")), createdBy: v.id("users"), createdAt: v.number(),
  }).index("by_space_status", ["spaceId", "status"]).index("by_assignee_status", ["assigneeUserId", "status"]),
  invitations: defineTable({
    spaceId: v.id("spaces"), tokenHash: v.string(), targetEmail: v.string(),
    role: v.union(v.literal("owner"), v.literal("member")), createdBy: v.id("users"),
    expiresAt: v.number(), acceptedAt: v.optional(v.number()), revokedAt: v.optional(v.number()),
  }).index("by_token_hash", ["tokenHash"]).index("by_space", ["spaceId"]),
  agentRuns: defineTable({
    spaceId: v.id("spaces"), roomId: v.optional(v.id("rooms")), requestedBy: v.id("users"),
    capability: v.string(), status: v.union(v.literal("pending"), v.literal("running"), v.literal("succeeded"), v.literal("failed")),
    provider: v.optional(v.string()), model: v.optional(v.string()), idempotencyKey: v.string(), createdAt: v.number(), completedAt: v.optional(v.number()),
  }).index("by_space_idempotency", ["spaceId", "idempotencyKey"]).index("by_space_created", ["spaceId", "createdAt"]),
  agents: defineTable({
    spaceId: v.id("spaces"), roomId: v.id("rooms"), createdBy: v.id("users"), creationKey: v.string(),
    name: v.string(), systemPrompt: v.string(), provider: v.literal("openrouter"), model: v.string(),
    status: v.union(v.literal("idle"), v.literal("running")), lastError: v.optional(v.string()),
    createdAt: v.number(), updatedAt: v.number(),
  }).index("by_room", ["roomId"]).index("by_room_creation_key", ["roomId", "creationKey"]),
  agentMessages: defineTable({
    agentId: v.id("agents"), sequence: v.number(), message: v.any(), createdAt: v.number(),
  }).index("by_agent_sequence", ["agentId", "sequence"]),
  agentJobs: defineTable({
    agentId: v.id("agents"), requestedBy: v.id("users"), prompt: v.string(), clientOperationId: v.string(),
    status: v.union(v.literal("queued"), v.literal("running"), v.literal("complete"), v.literal("failed")),
    attempt: v.number(), leaseId: v.optional(v.string()), createdAt: v.number(),
    startedAt: v.optional(v.number()), completedAt: v.optional(v.number()), error: v.optional(v.string()),
    responseText: v.optional(v.string()), trigger: v.optional(v.union(v.literal("mention"), v.literal("ambient"))),
    activity: v.optional(v.union(v.literal("searching_web"), v.literal("generating_image"))),
  }).index("by_agent_status_created", ["agentId", "status", "createdAt"])
    .index("by_agent_created", ["agentId", "createdAt"])
    .index("by_agent_client_operation", ["agentId", "clientOperationId"]),
  agentMemory: defineTable({
    agentId: v.id("agents"), key: v.string(), value: v.string(), updatedAt: v.number(),
  }).index("by_agent_key", ["agentId", "key"]),
  webSources: defineTable({
    spaceId: v.id("spaces"), runId: v.id("agentRuns"), url: v.string(), title: v.optional(v.string()),
    retrievedAt: v.number(), excerptHash: v.string(),
  }).index("by_run", ["runId"]),
  auditEvents: defineTable({
    spaceId: v.optional(v.id("spaces")), actorUserId: v.optional(v.id("users")),
    action: v.string(), resourceType: v.string(), resourceId: v.optional(v.string()), metadata: v.optional(v.any()), createdAt: v.number(),
  }).index("by_space_created", ["spaceId", "createdAt"]).index("by_actor_created", ["actorUserId", "createdAt"]),
  usageLedger: defineTable({
    spaceId: v.id("spaces"), runId: v.optional(v.id("agentRuns")), userId: v.id("users"),
    provider: v.string(), model: v.optional(v.string()), unit: v.string(), quantity: v.number(), costClass: v.string(), createdAt: v.number(),
  }).index("by_space_created", ["spaceId", "createdAt"]).index("by_user_created", ["userId", "createdAt"]),
});
