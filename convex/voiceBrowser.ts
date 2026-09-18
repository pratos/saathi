import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, env, internalAction, internalMutation } from "./_generated/server";
import type { ActionCtx, MutationCtx } from "./_generated/server";
import {
  assertSafeComputerTask,
  assertSafeComputerUrl,
  observeFirecrawlCodeSession,
  runFirecrawlCode,
  runFirecrawlComputerTask,
  startFirecrawlCodeSession,
  stopFirecrawlCodeSession,
} from "./lib/firecrawlInteract";
import {
  applyBrowserPolicy,
  browserEstimatedJevCostUsd,
  buildBrowserActions,
  decideBrowserStep,
  fixedBrowserCommand,
  parseBrowserObservation,
  staysWithinNavigationBoundary,
} from "./lib/voiceBrowserController";

const SESSION_TTL_MS = 5 * 60 * 1_000;
const MAX_STEPS_PER_UTTERANCE = 5;

const phase = v.union(
  v.literal("starting"), v.literal("awaiting_instruction"), v.literal("routing_utterance"),
  v.literal("voice_handover"), v.literal("observing"), v.literal("deciding"),
  v.literal("awaiting_confirmation"), v.literal("executing"), v.literal("awaiting_human_login"),
  v.literal("complete"), v.literal("stopping"), v.literal("failed"),
);

const browserToolResult = v.object({ ok: v.boolean(), message: v.string() });

export const useComputer = action({
  args: { roomId: v.id("rooms"), sessionId: v.string(), callId: v.string(), url: v.string(), task: v.string() },
  returns: browserToolResult,
  handler: async (ctx, args): Promise<{ ok: boolean; message: string }> => {
    const url = assertSafeComputerUrl(args.url);
    const task = assertSafeComputerTask(args.task);
    const prepared = await ctx.runMutation(internal.liveVoice.prepareComputerTool, {
      roomId: args.roomId,
      sessionId: args.sessionId,
      callId: args.callId,
      task,
    });
    return await ctx.runAction(internal.voiceBrowser.runCommand, { ...args, url, task, profileName: prepared.profileName });
  },
});

export const runCommand = internalAction({
  args: {
    roomId: v.id("rooms"), sessionId: v.string(), callId: v.string(), url: v.string(), task: v.string(), profileName: v.string(),
  },
  returns: browserToolResult,
  handler: async (ctx, args): Promise<{ ok: boolean; message: string }> => {
    const url = assertSafeComputerUrl(args.url);
    const task = assertSafeComputerTask(args.task);
    const typesafeKey = env.TYPESAFE_API_KEY?.trim();
    if (env.JEV_VOICE_BROWSER_ENABLED?.trim().toLowerCase() !== "true" || !typesafeKey) {
      try {
        const result = await runFirecrawlComputerTask({
          apiKey: env.FIRECRAWL_API_KEY,
          url,
          task,
          profileName: args.profileName,
          onLiveView: async view => {
            await ctx.runMutation(internal.liveVoice.updateComputerView, {
              roomId: args.roomId,
              sessionId: args.sessionId,
              callId: args.callId,
              liveViewUrl: view.liveViewUrl,
              interactiveLiveViewUrl: view.interactiveLiveViewUrl,
            });
          },
        });
        return { ok: true, message: result.output.slice(0, 8_000) };
      } finally {
        await ctx.runMutation(internal.liveVoice.finishComputerTool, {
          roomId: args.roomId, sessionId: args.sessionId, callId: args.callId,
        });
      }
    }

    let prepared: Awaited<ReturnType<typeof prepareForRuntime>> | null = null;
    let activeScrapeId = "";
    try {
      prepared = await prepareForRuntime(ctx, args, url, task);
      let scrapeId = prepared.scrapeId;
      if (!scrapeId) {
        const started = await startFirecrawlCodeSession({ apiKey: env.FIRECRAWL_API_KEY, url, profileName: args.profileName });
        scrapeId = started.scrapeId;
        const attached = await ctx.runMutation(internal.voiceBrowser.attachRemoteSession, {
          browserSessionId: prepared.browserSessionId, leaseId: prepared.leaseId, scrapeId,
        });
        if (!attached) {
          await stopFirecrawlCodeSession(env.FIRECRAWL_API_KEY, scrapeId);
          return { ok: false, message: "The voice browser session ended before it could start." };
        }
      }
      activeScrapeId = scrapeId;
      const recentActions = [...prepared.recentActions];
      for (let step = 0; step < MAX_STEPS_PER_UTTERANCE; step++) {
        if (!await updateState(ctx, prepared.browserSessionId, prepared.leaseId, "observing")) {
          return { ok: false, message: "The voice browser session is no longer active." };
        }
        const observationStartedAt = Date.now();
        const rawObservation = await observeFirecrawlCodeSession({ apiKey: env.FIRECRAWL_API_KEY, scrapeId });
        const observation = parseBrowserObservation(rawObservation.stdout, prepared.currentUrl);
        if (!staysWithinNavigationBoundary(prepared.initialUrl, observation.url)) {
          await stopAndFinish(ctx, prepared.browserSessionId, prepared.leaseId, scrapeId, "failed", "cross_domain_navigation");
          return { ok: false, message: "I stopped because the browser moved to a different website." };
        }
        await ctx.runMutation(internal.voiceBrowser.updateRemoteView, {
          browserSessionId: prepared.browserSessionId,
          leaseId: prepared.leaseId,
          currentUrl: observation.url,
          fingerprint: observation.fingerprint,
          liveViewUrl: rawObservation.liveViewUrl,
          interactiveLiveViewUrl: rawObservation.interactiveLiveViewUrl,
        });
        const actions = buildBrowserActions(observation.snapshot, task);
        if (!await updateState(ctx, prepared.browserSessionId, prepared.leaseId, "deciding")) {
          return { ok: false, message: "The page changed before I could choose an action." };
        }
        const decision = await decideBrowserStep(typesafeKey, {
          goal: prepared.goal,
          latestVoiceInstruction: task,
          page: { url: observation.url, fingerprint: observation.fingerprint },
          accessibilityTree: observation.snapshot,
          actions,
          recentActions,
        });
        const policy = applyBrowserPolicy(actions, observation.fingerprint, decision);
        const selected = actions.find(action => action.id === decision.selectedActionId);
        const policyOutcome = policy.outcome === "block" ? `block:${policy.reason}` : policy.outcome;
        await ctx.runMutation(internal.jev.record, {
          spaceId: prepared.spaceId,
          roomId: args.roomId,
          source: "voice_browser",
          inputPreview: task,
          decision: decision.selectedActionId,
          confidence: decision.selectedConfidence,
          details: {
            browserSessionId: String(prepared.browserSessionId),
            attempt: prepared.attempt,
            step,
            urlOrigin: new URL(observation.url).origin,
            pageFingerprint: observation.fingerprint,
            candidateCount: actions.length,
            actionKinds: [...new Set(actions.map(action => action.kind))],
            selectedActionId: decision.selectedActionId,
            selectedProbability: decision.selectedProbabilities[decision.selectedActionId] ?? 0,
            needsUser: decision.needsUser,
            madeProgress: decision.madeProgress,
            risk: decision.risk,
            policyOutcome,
            observationLatencyMs: Date.now() - observationStartedAt,
            jevLatencyMs: decision.latencyMs,
            jevCostUsd: browserEstimatedJevCostUsd(decision.inputTokens),
            firecrawlMode: "code_only",
          },
          model: decision.model,
          latencyMs: decision.latencyMs,
          inputTokens: decision.inputTokens,
        });
        await ctx.runMutation(internal.voiceBrowser.recordDecision, {
          browserSessionId: prepared.browserSessionId,
          leaseId: prepared.leaseId,
          selectedActionId: decision.selectedActionId,
          selectedActionLabel: selected?.label,
          confidence: decision.selectedConfidence,
          outcome: policyOutcome,
        });

        if (policy.outcome === "done") {
          await stopAndFinish(ctx, prepared.browserSessionId, prepared.leaseId, scrapeId, "complete", "goal_complete");
          return { ok: true, message: "The requested browser task is complete." };
        }
        if (policy.outcome === "handover_to_voice") {
          await updateState(ctx, prepared.browserSessionId, prepared.leaseId, "voice_handover");
          return { ok: true, message: "This is better handled in the voice conversation than as a browser click." };
        }
        if (policy.outcome === "ask_user" || policy.outcome === "block") {
          const login = selected?.risk === "forbidden" || policy.outcome === "block" && policy.reason === "needs_user";
          await updateState(ctx, prepared.browserSessionId, prepared.leaseId, login ? "awaiting_human_login" : "awaiting_confirmation");
          return {
            ok: false,
            message: login
              ? "Please use the live browser to sign in or provide the required value, then tell me to continue."
              : "I need your clarification or confirmation before taking that browser action.",
          };
        }
        if (recentActions.some(item => item.actionId === policy.action.id && item.outcome === observation.fingerprint)) {
          await updateState(ctx, prepared.browserSessionId, prepared.leaseId, "awaiting_confirmation");
          return { ok: false, message: "The page did not change after that action. Tell me what you want to try next." };
        }
        if (!await updateState(ctx, prepared.browserSessionId, prepared.leaseId, "executing")) {
          return { ok: false, message: "The page changed before I could safely apply that action." };
        }
        await runFirecrawlCode({ apiKey: env.FIRECRAWL_API_KEY, scrapeId, code: fixedBrowserCommand(policy.action) });
        recentActions.push({ actionId: policy.action.id, outcome: observation.fingerprint });
      }
      await updateState(ctx, prepared.browserSessionId, prepared.leaseId, "awaiting_instruction");
      return { ok: true, message: "I made progress in the browser. Tell me the next step when you are ready." };
    } catch (error) {
      if (prepared) {
        if (activeScrapeId) await stopFirecrawlCodeSession(env.FIRECRAWL_API_KEY, activeScrapeId);
        await ctx.runMutation(internal.voiceBrowser.failSession, {
          browserSessionId: prepared.browserSessionId,
          leaseId: prepared.leaseId,
          reason: error instanceof Error ? error.name : "browser_error",
        });
      }
      return { ok: false, message: "The browser could not complete that step safely." };
    } finally {
      await ctx.runMutation(internal.liveVoice.finishComputerTool, {
        roomId: args.roomId, sessionId: args.sessionId, callId: args.callId,
      });
    }
  },
});

export const prepareSession = internalMutation({
  args: {
    roomId: v.id("rooms"), voiceSessionId: v.string(), callId: v.string(), url: v.string(), task: v.string(), profileName: v.string(),
  },
  returns: v.object({
    browserSessionId: v.id("voiceBrowserSessions"), spaceId: v.id("spaces"), scrapeId: v.optional(v.string()),
    leaseId: v.string(), initialUrl: v.string(), currentUrl: v.string(), goal: v.string(), attempt: v.number(),
    recentActions: v.array(v.object({ actionId: v.string(), outcome: v.string() })),
  }),
  handler: async (ctx, args) => {
    const session = await ctx.db.query("liveVoiceSessions").withIndex("by_session_id", q => q.eq("sessionId", args.voiceSessionId)).unique();
    if (!session || session.roomId !== args.roomId || session.finishedAt || session.activeToolCallId !== args.callId) {
      throw new ConvexError({ code: "FORBIDDEN", message: "This voice browser session is no longer active" });
    }
    const now = Date.now();
    const existing = await ctx.db.query("voiceBrowserSessions").withIndex("by_voice_session", q => q.eq("voiceSessionId", args.voiceSessionId)).unique();
    const canResume = existing && !existing.completedAt && existing.phase !== "failed" && existing.phase !== "complete";
    const attempt = (existing?.attempt ?? 0) + 1;
    const leaseId = `${args.voiceSessionId}:${attempt}:${args.callId}`;
    let browserSessionId: Id<"voiceBrowserSessions">;
    if (existing) {
      if (existing.roomId !== args.roomId || existing.startedBy !== session.startedBy) {
        throw new ConvexError({ code: "FORBIDDEN", message: "This browser session does not belong to you" });
      }
      if (canResume && new URL(existing.initialUrl).hostname !== new URL(args.url).hostname) {
        throw new ConvexError({ code: "INVALID_ARGUMENT", message: "Start a new voice call to operate a different website" });
      }
      browserSessionId = existing._id;
      await ctx.db.patch(existing._id, {
        scrapeId: canResume ? existing.scrapeId : undefined,
        initialUrl: canResume ? existing.initialUrl : args.url,
        currentUrl: canResume ? existing.currentUrl : args.url,
        goal: canResume ? existing.goal : args.task,
        latestInstruction: args.task,
        latestCallId: args.callId,
        profileName: args.profileName,
        phase: "routing_utterance",
        attempt,
        leaseId,
        recentActions: canResume ? existing.recentActions.slice(-5) : [],
        remoteStartedAt: canResume ? existing.remoteStartedAt : undefined,
        firecrawlSeconds: canResume ? existing.firecrawlSeconds : undefined,
        firecrawlCredits: canResume ? existing.firecrawlCredits : undefined,
        completedAt: undefined,
        terminalReason: undefined,
        lastActiveAt: now,
        expiresAt: now + SESSION_TTL_MS,
      });
    } else {
      browserSessionId = await ctx.db.insert("voiceBrowserSessions", {
        voiceSessionId: args.voiceSessionId,
        spaceId: session.spaceId,
        roomId: args.roomId,
        startedBy: session.startedBy,
        profileName: args.profileName,
        initialUrl: args.url,
        currentUrl: args.url,
        goal: args.task,
        latestInstruction: args.task,
        latestCallId: args.callId,
        phase: "starting",
        attempt,
        leaseId,
        recentActions: [],
        lastActiveAt: now,
        expiresAt: now + SESSION_TTL_MS,
        createdAt: now,
      });
    }
    await ctx.scheduler.runAfter(SESSION_TTL_MS + 1_000, internal.voiceBrowser.expireSession, {
      browserSessionId, leaseId,
    });
    const row = existing && canResume ? existing : null;
    return {
      browserSessionId,
      spaceId: session.spaceId,
      scrapeId: row?.scrapeId,
      leaseId,
      initialUrl: row?.initialUrl ?? args.url,
      currentUrl: row?.currentUrl ?? args.url,
      goal: row?.goal ?? args.task,
      attempt,
      recentActions: row?.recentActions.slice(-5) ?? [],
    };
  },
});

export const attachRemoteSession = internalMutation({
  args: { browserSessionId: v.id("voiceBrowserSessions"), leaseId: v.string(), scrapeId: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const row = await currentLease(ctx, args.browserSessionId, args.leaseId);
    if (!row) return false;
    await ctx.db.patch(row._id, {
      scrapeId: args.scrapeId, phase: "observing", remoteStartedAt: Date.now(), lastActiveAt: Date.now(),
    });
    return true;
  },
});

export const updateRemoteView = internalMutation({
  args: {
    browserSessionId: v.id("voiceBrowserSessions"), leaseId: v.string(), currentUrl: v.string(), fingerprint: v.string(),
    liveViewUrl: v.optional(v.string()), interactiveLiveViewUrl: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await currentLease(ctx, args.browserSessionId, args.leaseId);
    if (!row) return null;
    await ctx.db.patch(row._id, {
      currentUrl: args.currentUrl,
      pageFingerprint: args.fingerprint,
      liveViewUrl: args.liveViewUrl,
      interactiveLiveViewUrl: args.interactiveLiveViewUrl,
      lastActiveAt: Date.now(),
    });
    return null;
  },
});

export const setPhase = internalMutation({
  args: { browserSessionId: v.id("voiceBrowserSessions"), leaseId: v.string(), phase },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const row = await currentLease(ctx, args.browserSessionId, args.leaseId);
    if (!row) return false;
    const expiresAt = Date.now() + SESSION_TTL_MS;
    await ctx.db.patch(row._id, { phase: args.phase, lastActiveAt: Date.now(), expiresAt });
    await ctx.scheduler.runAfter(SESSION_TTL_MS + 1_000, internal.voiceBrowser.expireSession, {
      browserSessionId: row._id, leaseId: args.leaseId,
    });
    return true;
  },
});

export const recordDecision = internalMutation({
  args: {
    browserSessionId: v.id("voiceBrowserSessions"), leaseId: v.string(), selectedActionId: v.string(),
    selectedActionLabel: v.optional(v.string()), confidence: v.number(), outcome: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await currentLease(ctx, args.browserSessionId, args.leaseId);
    if (!row) return null;
    await ctx.db.patch(row._id, {
      selectedActionId: args.selectedActionId,
      selectedActionLabel: args.selectedActionLabel,
      decisionConfidence: args.confidence,
      recentActions: [...row.recentActions, { actionId: args.selectedActionId, outcome: args.outcome }].slice(-5),
      lastActiveAt: Date.now(),
    });
    return null;
  },
});

export const failSession = internalMutation({
  args: { browserSessionId: v.id("voiceBrowserSessions"), leaseId: v.string(), reason: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await currentLease(ctx, args.browserSessionId, args.leaseId);
    if (!row) return null;
    await ctx.db.patch(row._id, {
      phase: "failed", terminalReason: args.reason.slice(0, 100), completedAt: Date.now(), leaseId: undefined,
      ...firecrawlUsage(row.remoteStartedAt),
    });
    return null;
  },
});

export const finishRemoteSession = internalMutation({
  args: {
    browserSessionId: v.id("voiceBrowserSessions"), leaseId: v.string(),
    phase: v.union(v.literal("complete"), v.literal("failed")), reason: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await currentLease(ctx, args.browserSessionId, args.leaseId);
    if (!row) return null;
    await ctx.db.patch(row._id, {
      phase: args.phase, terminalReason: args.reason.slice(0, 100), completedAt: Date.now(), leaseId: undefined,
      liveViewUrl: undefined, interactiveLiveViewUrl: undefined,
      ...firecrawlUsage(row.remoteStartedAt),
    });
    return null;
  },
});

export const claimExpired = internalMutation({
  args: { browserSessionId: v.id("voiceBrowserSessions"), leaseId: v.string() },
  returns: v.union(v.object({ scrapeId: v.string() }), v.null()),
  handler: async (ctx, args) => {
    const row = await currentLease(ctx, args.browserSessionId, args.leaseId);
    if (!row || row.expiresAt > Date.now() || !row.scrapeId) return null;
    await ctx.db.patch(row._id, {
      phase: "stopping", terminalReason: "inactivity", leaseId: undefined, completedAt: Date.now(),
      liveViewUrl: undefined, interactiveLiveViewUrl: undefined,
      ...firecrawlUsage(row.remoteStartedAt),
    });
    return { scrapeId: row.scrapeId };
  },
});

export const expireSession = internalAction({
  args: { browserSessionId: v.id("voiceBrowserSessions"), leaseId: v.string() },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const claimed = await ctx.runMutation(internal.voiceBrowser.claimExpired, args);
    if (claimed) await stopFirecrawlCodeSession(env.FIRECRAWL_API_KEY, claimed.scrapeId);
    return null;
  },
});

export const claimForVoiceEnd = internalMutation({
  args: { roomId: v.id("rooms"), voiceSessionId: v.string() },
  returns: v.union(v.object({ browserSessionId: v.id("voiceBrowserSessions"), scrapeId: v.string() }), v.null()),
  handler: async (ctx, args) => {
    const row = await ctx.db.query("voiceBrowserSessions").withIndex("by_voice_session", q =>
      q.eq("voiceSessionId", args.voiceSessionId),
    ).unique();
    if (!row || row.roomId !== args.roomId || row.completedAt || !row.scrapeId) return null;
    await ctx.db.patch(row._id, {
      phase: "stopping", leaseId: undefined, terminalReason: "voice_call_ended", completedAt: Date.now(),
      liveViewUrl: undefined, interactiveLiveViewUrl: undefined,
      ...firecrawlUsage(row.remoteStartedAt),
    });
    return { browserSessionId: row._id, scrapeId: row.scrapeId };
  },
});

export const stopForVoiceSession = internalAction({
  args: { roomId: v.id("rooms"), voiceSessionId: v.string() },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const claimed = await ctx.runMutation(internal.voiceBrowser.claimForVoiceEnd, args);
    if (claimed) await stopFirecrawlCodeSession(env.FIRECRAWL_API_KEY, claimed.scrapeId);
    return null;
  },
});

async function prepareForRuntime(
  ctx: ActionCtx,
  args: { roomId: Id<"rooms">; sessionId: string; callId: string; profileName: string },
  url: string,
  task: string,
) {
  return await ctx.runMutation(internal.voiceBrowser.prepareSession, {
    roomId: args.roomId,
    voiceSessionId: args.sessionId,
    callId: args.callId,
    url,
    task,
    profileName: args.profileName,
  });
}

async function updateState(
  ctx: ActionCtx,
  browserSessionId: Id<"voiceBrowserSessions">,
  leaseId: string,
  nextPhase: "observing" | "deciding" | "voice_handover" | "awaiting_confirmation" | "executing" | "awaiting_human_login" | "awaiting_instruction",
) {
  return await ctx.runMutation(internal.voiceBrowser.setPhase, { browserSessionId, leaseId, phase: nextPhase });
}

async function stopAndFinish(
  ctx: ActionCtx,
  browserSessionId: Id<"voiceBrowserSessions">,
  leaseId: string,
  scrapeId: string,
  finalPhase: "complete" | "failed",
  reason: string,
) {
  await stopFirecrawlCodeSession(env.FIRECRAWL_API_KEY, scrapeId);
  await ctx.runMutation(internal.voiceBrowser.finishRemoteSession, {
    browserSessionId, leaseId, phase: finalPhase, reason,
  });
}

async function currentLease(ctx: MutationCtx, id: Id<"voiceBrowserSessions">, leaseId: string) {
  const row = await ctx.db.get(id);
  return row?.leaseId === leaseId && !row.completedAt ? row : null;
}

function firecrawlUsage(remoteStartedAt: number | undefined) {
  if (remoteStartedAt === undefined) return {};
  const firecrawlSeconds = Math.max(0, (Date.now() - remoteStartedAt) / 1_000);
  return {
    firecrawlSeconds,
    // Firecrawl code-only Interact is 2 credits/minute with a 1-minute minimum.
    firecrawlCredits: Math.max(2, firecrawlSeconds / 60 * 2),
  };
}
