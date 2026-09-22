import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { conversationUiActionValidator } from "./lib/conversationUi";
import { imageStyleValidator } from "./lib/imageSafety";

const language = v.union(v.literal("en"), v.literal("hi"), v.literal("mr"));
const visibility = v.union(v.literal("private"), v.literal("room"), v.literal("space"));
const { users: _authUsers, ...authTablesWithoutUsers } = authTables;
void _authUsers;

export default defineSchema({
  ...authTablesWithoutUsers,
  // Convex Auth's users table, extended with Saathi-owned profile fields.
  users: defineTable({
    name: v.optional(v.string()), image: v.optional(v.string()), email: v.optional(v.string()),
    emailVerificationTime: v.optional(v.number()), phone: v.optional(v.string()),
    phoneVerificationTime: v.optional(v.number()), isAnonymous: v.optional(v.boolean()),
    displayName: v.optional(v.string()), username: v.optional(v.string()), preferredLanguage: v.optional(language),
    preferredImageStyle: v.optional(imageStyleValidator),
    platformRole: v.optional(v.literal("superadmin")),
    accessStatus: v.optional(v.union(v.literal("pending"), v.literal("approved"), v.literal("blocked"))),
    accessRequestedAt: v.optional(v.number()),
    accessReviewedAt: v.optional(v.number()),
    accessReviewedBy: v.optional(v.id("users")),
    accessNote: v.optional(v.string()),
  }).index("email", ["email"]).index("phone", ["phone"]),
  usernameClaims: defineTable({
    normalized: v.string(), userId: v.id("users"), claimedAt: v.number(),
  }).index("by_normalized", ["normalized"]).index("by_user_id", ["userId"]),
  spaces: defineTable({
    name: v.string(),
    agentmailInboxId: v.optional(v.string()),
    agentmailEmail: v.optional(v.string()),
    createdBy: v.id("users"),
    creationKey: v.string(),
    createdAt: v.number(),
    modelTier: v.optional(v.union(v.literal("low"), v.literal("med"), v.literal("high"), v.literal("ultra"))),
  }).index("by_agentmail_inbox", ["agentmailInboxId"]).index("by_creator_key", ["createdBy", "creationKey"]),
  providerKeys: defineTable({
    spaceId: v.id("spaces"),
    provider: v.union(v.literal("openai"), v.literal("openrouter"), v.literal("codex")),
    sealedSecret: v.string(),
    lastFour: v.string(),
    updatedBy: v.id("users"),
    updatedAt: v.number(),
  }).index("by_space_provider", ["spaceId", "provider"]),
  memberships: defineTable({
    spaceId: v.id("spaces"), userId: v.id("users"),
    role: v.union(v.literal("owner"), v.literal("member")),
    status: v.union(v.literal("active"), v.literal("revoked")),
    joinedAt: v.number(),
  }).index("by_user_status", ["userId", "status"]).index("by_space_user", ["spaceId", "userId"])
    .index("by_space_status", ["spaceId", "status"]),
  rooms: defineTable({
    spaceId: v.id("spaces"),
    type: v.union(v.literal("private"), v.literal("shared"), v.literal("case")),
    title: v.string(), assistantMode: v.union(v.literal("automatic"), v.literal("mention"), v.literal("off")),
    personalOwnerId: v.optional(v.id("users")),
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
    category: v.union(v.literal("bills"), v.literal("school"), v.literal("travel"), v.literal("appointments"), v.literal("subscriptions"), v.literal("home"), v.literal("receipts"), v.literal("bank"), v.literal("security"), v.literal("needs_review")),
    subcategory: v.optional(v.union(
      v.literal("utility_bill"), v.literal("credit_card_bill"), v.literal("loan_payment"),
      v.literal("insurance_premium"), v.literal("tax_payment"), v.literal("rent"),
      v.literal("medical_bill"), v.literal("school_fee"), v.literal("purchase_receipt"),
      v.literal("food_delivery"), v.literal("refund"), v.literal("warranty"),
      v.literal("bank_transaction"), v.literal("bank_statement"), v.literal("credit_card_statement"),
      v.literal("investment"), v.literal("demat"), v.literal("otp"), v.literal("login_code"),
      v.literal("sign_in_alert"), v.literal("password_reset"), v.literal("field_trip"),
      v.literal("school_event"), v.literal("permission_form"), v.literal("report_card"),
      v.literal("timetable"), v.literal("school_transport"), v.literal("flight"),
      v.literal("train"), v.literal("bus"), v.literal("hotel"), v.literal("visa"),
      v.literal("itinerary"), v.literal("booking_change"), v.literal("medical_appointment"),
      v.literal("service_appointment"), v.literal("government_appointment"), v.literal("reservation"),
      v.literal("subscription_renewal"), v.literal("subscription_price_change"), v.literal("trial_ending"),
      v.literal("subscription_cancellation"), v.literal("home_maintenance"), v.literal("delivery"),
      v.literal("community_notice"), v.literal("household_service"), v.literal("other"),
    )),
    status: v.union(v.literal("received"), v.literal("processing"), v.literal("ready"), v.literal("failed")),
    extractedAmount: v.optional(v.string()), extractedDueAt: v.optional(v.number()),
    extractedMerchant: v.optional(v.string()), extractedPeriod: v.optional(v.string()),
    extractedAmountInr: v.optional(v.string()), extractedAmountUsd: v.optional(v.string()),
    direction: v.optional(v.union(v.literal("incoming"), v.literal("outgoing"))),
    processingNotes: v.optional(v.string()),
    documentParseStatus: v.optional(v.union(v.literal("none"), v.literal("parsed"), v.literal("password"), v.literal("failed"))),
    documentParseRetryable: v.optional(v.boolean()),
    suggestedActions: v.optional(v.array(v.object({
      kind: v.string(), label: v.string(), detail: v.optional(v.string()), url: v.optional(v.string()),
    }))),
    actionStatus: v.optional(v.union(v.literal("suggested"), v.literal("confirmed"), v.literal("dismissed"))),
    heartbeatMessageId: v.optional(v.id("messages")),
    jevDecisionId: v.optional(v.id("jevDecisions")),
    sharedAt: v.optional(v.number()), sharedByUserId: v.optional(v.id("users")),
    forwardedSpaceIds: v.optional(v.array(v.id("spaces"))),
    receivedAt: v.number(),
  }).index("by_agentmail_message", ["agentmailMessageId"])
    .index("by_space_agentmail_message", ["spaceId", "agentmailMessageId"])
    .index("by_space_received", ["spaceId", "receivedAt"])
    .index("by_space_visibility_received", ["spaceId", "visibility", "receivedAt"]),
  inboxReadStates: defineTable({
    spaceId: v.id("spaces"), userId: v.id("users"),
    lastSeenReceivedAt: v.number(), lastSeenCreationTime: v.number(), updatedAt: v.number(),
  }).index("by_space_user", ["spaceId", "userId"]),
  messages: defineTable({
    spaceId: v.id("spaces"), roomId: v.id("rooms"), authorUserId: v.optional(v.id("users")),
    actorType: v.union(v.literal("user"), v.literal("assistant"), v.literal("email_guest"), v.literal("voice_transcript")),
    origin: v.union(v.literal("app"), v.literal("agentmail"), v.literal("assistant")),
    originalText: v.string(), language, idempotencyKey: v.string(),
    mentions: v.optional(v.array(v.union(
      v.object({ kind: v.literal("assistant"), username: v.literal("saathi") }),
      v.object({ kind: v.literal("person"), username: v.string(), userId: v.id("users") }),
    ))),
    voiceSpeaker: v.optional(v.union(v.literal("user"), v.literal("assistant"))),
    voiceSeconds: v.optional(v.number()), voiceCostUsd: v.optional(v.number()),
    voiceUsageFinalized: v.optional(v.boolean()),
    uiActions: v.optional(v.array(conversationUiActionValidator)),
    createdAt: v.number(),
  }).index("by_room_created", ["roomId", "createdAt"]).index("by_room_idempotency", ["roomId", "idempotencyKey"]),
  liveVoiceSessions: defineTable({
    sessionId: v.string(), spaceId: v.id("spaces"), roomId: v.id("rooms"), startedBy: v.id("users"),
    billingSource: v.optional(v.union(v.literal("platform"), v.literal("family"))),
    createdAt: v.number(), finishedAt: v.optional(v.number()),
    activeToolCallId: v.optional(v.string()),
    activity: v.optional(v.literal("using_computer")),
    computerTask: v.optional(v.string()),
    computerLiveViewUrl: v.optional(v.string()),
    computerInteractiveLiveViewUrl: v.optional(v.string()),
  }).index("by_session_id", ["sessionId"]),
  voiceBrowserSessions: defineTable({
    voiceSessionId: v.string(), spaceId: v.id("spaces"), roomId: v.id("rooms"), startedBy: v.id("users"),
    scrapeId: v.optional(v.string()), profileName: v.string(), initialUrl: v.string(), currentUrl: v.string(),
    goal: v.string(), latestInstruction: v.string(), latestCallId: v.string(),
    phase: v.union(
      v.literal("starting"), v.literal("awaiting_instruction"), v.literal("routing_utterance"),
      v.literal("voice_handover"), v.literal("observing"), v.literal("deciding"),
      v.literal("awaiting_confirmation"), v.literal("executing"), v.literal("awaiting_human_login"),
      v.literal("complete"), v.literal("stopping"), v.literal("failed"),
    ),
    attempt: v.number(), leaseId: v.optional(v.string()), pageFingerprint: v.optional(v.string()),
    selectedActionId: v.optional(v.string()), selectedActionLabel: v.optional(v.string()),
    decisionConfidence: v.optional(v.number()),
    liveViewUrl: v.optional(v.string()), interactiveLiveViewUrl: v.optional(v.string()),
    recentActions: v.array(v.object({ actionId: v.string(), outcome: v.string() })),
    remoteStartedAt: v.optional(v.number()), firecrawlSeconds: v.optional(v.number()), firecrawlCredits: v.optional(v.number()),
    lastActiveAt: v.number(), expiresAt: v.number(), createdAt: v.number(),
    completedAt: v.optional(v.number()), terminalReason: v.optional(v.string()),
  }).index("by_voice_session", ["voiceSessionId"]),
  gmailConnections: defineTable({
    spaceId: v.id("spaces"), userId: v.id("users"), connectedAccountId: v.string(),
    alias: v.string(), email: v.optional(v.string()), triggerId: v.string(),
    status: v.union(v.literal("active"), v.literal("error")),
    // Kept for compatibility with connections synced before operational state was split out.
    createdAt: v.number(), lastSyncedAt: v.optional(v.number()),
  }).index("by_space_user", ["spaceId", "userId"])
    .index("by_connected_account", ["connectedAccountId"])
    .index("by_connected_account_space", ["connectedAccountId", "spaceId"]),
  gmailConnectionSyncStates: defineTable({
    connectionId: v.id("gmailConnections"), lastSyncedAt: v.number(),
  }).index("by_connection_id", ["connectionId"]),
  gmailProcessedMessages: defineTable({
    connectionId: v.id("gmailConnections"), externalMessageId: v.string(), useful: v.boolean(), processedAt: v.number(),
  }).index("by_connection_message", ["connectionId", "externalMessageId"]),
  // Legacy budget rows remain declared for a non-destructive rollout. No product API reads or writes these tables.
  familyBudgets: defineTable({
    spaceId: v.id("spaces"),
    category: v.literal("food"),
    monthlyLimit: v.number(),
    currency: v.union(v.literal("INR"), v.literal("USD")),
    updatedBy: v.id("users"),
    updatedAt: v.number(),
  }).index("by_space_category", ["spaceId", "category"]),
  familySpend: defineTable({
    spaceId: v.id("spaces"),
    category: v.literal("food"),
    amount: v.number(),
    currency: v.union(v.literal("INR"), v.literal("USD")),
    merchant: v.optional(v.string()),
    sourceInboxItemId: v.optional(v.id("inboxItems")),
    createdBy: v.id("users"),
    spentAt: v.number(),
  }).index("by_space_category_spent", ["spaceId", "category", "spentAt"]).index("by_source_inbox", ["sourceInboxItemId"]),
  attachments: defineTable({
    spaceId: v.id("spaces"), roomId: v.id("rooms"), messageId: v.id("messages"),
    authorUserId: v.id("users"), storageId: v.id("_storage"), fileName: v.string(),
    mediaType: v.string(), sizeBytes: v.number(), createdAt: v.number(),
    kind: v.optional(v.union(v.literal("photo"), v.literal("receipt"), v.literal("document"))),
    transcriptStatus: v.optional(v.union(v.literal("pending"), v.literal("ready"), v.literal("failed"))),
    transcript: v.optional(v.string()),
    extractedAmount: v.optional(v.string()),
    extractedMerchant: v.optional(v.string()),
  }).index("by_message", ["messageId"]).index("by_room_created", ["roomId", "createdAt"]),
  generatedImages: defineTable({
    spaceId: v.id("spaces"), roomId: v.id("rooms"), requestedBy: v.id("users"),
    prompt: v.string(), model: v.string(), storageId: v.id("_storage"), mediaType: v.string(), createdAt: v.number(),
    kind: v.optional(v.union(v.literal("scene"), v.literal("infographic"), v.literal("devotional"))),
    style: v.optional(imageStyleValidator),
    language: v.optional(language),
  }).index("by_room_created", ["roomId", "createdAt"]),
  invitations: defineTable({
    spaceId: v.id("spaces"), tokenHash: v.string(), targetEmail: v.string(),
    role: v.union(v.literal("owner"), v.literal("member")), createdBy: v.id("users"),
    // Optional on the schema boundary so pre-feature invitation rows do not
    // require a privileged production data scan during deployment.
    idempotencyKey: v.optional(v.string()), createdAt: v.optional(v.number()), expiresAt: v.number(),
    acceptedByUserId: v.optional(v.id("users")), acceptedAt: v.optional(v.number()), revokedAt: v.optional(v.number()),
  }).index("by_token_hash", ["tokenHash"])
    .index("by_space_created", ["spaceId", "createdAt"])
    .index("by_creator_idempotency", ["createdBy", "idempotencyKey"]),
  agents: defineTable({
    spaceId: v.id("spaces"), roomId: v.id("rooms"), createdBy: v.id("users"),
    // Retained so existing agent rows continue to validate after the old public creation API was removed.
    creationKey: v.string(),
    name: v.string(), systemPrompt: v.string(), provider: v.literal("openrouter"), model: v.string(),
    status: v.union(v.literal("idle"), v.literal("running")), lastError: v.optional(v.string()),
    createdAt: v.number(), updatedAt: v.number(),
  }).index("by_room", ["roomId"]),
  agentMessages: defineTable({
    agentId: v.id("agents"), sequence: v.number(), message: v.any(), createdAt: v.number(),
  }).index("by_agent_sequence", ["agentId", "sequence"]),
  agentJobs: defineTable({
    agentId: v.id("agents"), requestedBy: v.id("users"), prompt: v.string(), clientOperationId: v.string(),
    status: v.union(v.literal("queued"), v.literal("running"), v.literal("complete"), v.literal("failed")),
    attempt: v.number(), leaseId: v.optional(v.string()), createdAt: v.number(),
    startedAt: v.optional(v.number()), completedAt: v.optional(v.number()), error: v.optional(v.string()),
    responseText: v.optional(v.string()), trigger: v.optional(v.union(v.literal("mention"), v.literal("ambient"), v.literal("automatic"))),
    activity: v.optional(v.union(v.literal("searching_web"), v.literal("generating_image"), v.literal("using_computer"))),
    computerLiveViewUrl: v.optional(v.string()),
    computerInteractiveLiveViewUrl: v.optional(v.string()),
  }).index("by_agent_status_created", ["agentId", "status", "createdAt"])
    .index("by_agent_created", ["agentId", "createdAt"])
    .index("by_agent_client_operation", ["agentId", "clientOperationId"]),
  agentMemory: defineTable({
    agentId: v.id("agents"), key: v.string(), value: v.string(), updatedAt: v.number(),
  }).index("by_agent_key", ["agentId", "key"])
    .index("by_agent_updated", ["agentId", "updatedAt"]),
  agentEpisodes: defineTable({
    agentId: v.id("agents"), spaceId: v.id("spaces"), roomId: v.id("rooms"), requestedBy: v.id("users"),
    source: v.union(v.literal("chat"), v.literal("voice")), sourceKey: v.string(),
    summary: v.string(), createdAt: v.number(),
  }).index("by_agent_created", ["agentId", "createdAt"])
    .index("by_agent_source", ["agentId", "sourceKey"])
    .searchIndex("search_summary", { searchField: "summary", filterFields: ["agentId"] }),
  jevDecisions: defineTable({
    spaceId: v.id("spaces"), roomId: v.optional(v.id("rooms")), jobId: v.optional(v.id("agentJobs")),
    inboxItemId: v.optional(v.id("inboxItems")),
    source: v.union(v.literal("chat_turn"), v.literal("chat_tool"), v.literal("voice_tool"), v.literal("voice_browser"), v.literal("gmail"), v.literal("lab")),
    artifactSource: v.optional(v.literal("agentmail")),
    inputPreview: v.string(), decision: v.string(), confidence: v.optional(v.number()),
    details: v.any(), model: v.string(), latencyMs: v.number(), inputTokens: v.number(),
    disposition: v.optional(v.string()), classificationState: v.optional(v.union(v.literal("pending"), v.literal("complete"))),
    createdAt: v.number(),
  }).index("by_space_created", ["spaceId", "createdAt"]),
  auditEvents: defineTable({
    spaceId: v.optional(v.id("spaces")), actorUserId: v.optional(v.id("users")),
    action: v.string(), resourceType: v.string(), resourceId: v.optional(v.string()), metadata: v.optional(v.any()), createdAt: v.number(),
  }),
  usageLedger: defineTable({
    spaceId: v.id("spaces"),
    // Historical ledger rows may still carry the ID from the removed agentRuns table.
    runId: v.optional(v.string()), userId: v.id("users"),
    provider: v.string(), model: v.optional(v.string()), unit: v.string(), quantity: v.number(),
    costUsd: v.optional(v.number()), costClass: v.string(),
    inputTokens: v.optional(v.number()), outputTokens: v.optional(v.number()),
    cachedInputTokens: v.optional(v.number()), cacheWriteTokens: v.optional(v.number()),
    billingSource: v.optional(v.union(v.literal("platform"), v.literal("family"))),
    createdAt: v.number(),
  }).index("by_space_created", ["spaceId", "createdAt"]),
});
