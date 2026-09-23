import { Email } from "@convex-dev/auth/providers/Email";
import { ConvexCredentials } from "@convex-dev/auth/providers/ConvexCredentials";
import { HOUR, RateLimiter } from "@convex-dev/rate-limiter";
import { convexAuth, createAccount } from "@convex-dev/auth/server";
import { components, internal } from "./_generated/api";
import { env, internalMutation } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import { adminAccessDigest, constantTimeHexEqual } from "./lib/adminAccess";
import { buildOtpEmail } from "./lib/otpEmail";

const otpLimits = new RateLimiter(components.rateLimiter, {
  emailOtpV2: { kind: "fixed window", rate: 10, period: HOUR },
  adminAccessV1: { kind: "fixed window", rate: 5, period: HOUR },
});
type EmailVerificationRequest = Parameters<NonNullable<Parameters<typeof Email>[0]["sendVerificationRequest"]>>[0];
type EmailVerificationSender = NonNullable<Parameters<typeof Email>[0]["sendVerificationRequest"]>;

// Convex Auth supplies its action context as a second runtime argument, although
// the upstream Auth.js callback type currently declares only the first argument.
const sendVerificationRequest = (async (
  { identifier, token, expires }: EmailVerificationRequest,
  ctx: ActionCtx,
) => {
  const normalizedEmail = identifier.trim().toLowerCase();
  await ctx.runMutation(internal.auth.checkOtpLimit, { email: normalizedEmail });

  const apiKey = env.AGENTMAIL_API_KEY.trim();
  const inboxId = env.AGENTMAIL_AUTH_INBOX_ID.trim();
  if (!apiKey || !inboxId) {
    throw new ConvexError({ kind: "OtpConfigurationMissing" });
  }
  const email = buildOtpEmail(token, expires);

  const response = await fetch(
    `https://api.agentmail.to/v0/inboxes/${encodeURIComponent(inboxId)}/messages/send`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        to: normalizedEmail,
        ...email,
        labels: ["saathi-auth-otp"],
      }),
    },
  );
  if (!response.ok) {
    console.error("OTP_DELIVERY_REJECTED", response.status);
    throw new ConvexError({ kind: "OtpDeliveryRejected", status: response.status });
  }
}) as unknown as EmailVerificationSender;

export const checkOtpLimit = internalMutation({
  args: { email: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const limit = await otpLimits.limit(ctx, "emailOtpV2", { key: args.email });
    if (!limit.ok) {
      throw new ConvexError({ kind: "OtpRateLimited", retryAfter: limit.retryAfter });
    }
    return null;
  },
});

export const checkAdminAccessLimit = internalMutation({
  args: { email: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const limit = await otpLimits.limit(ctx, "adminAccessV1", { key: args.email });
    if (!limit.ok) {
      throw new ConvexError({ kind: "AdminAccessRateLimited", retryAfter: limit.retryAfter });
    }
    return null;
  },
});

const adminAccess = ConvexCredentials({
  id: "saathi-admin",
  authorize: async (credentials, ctx) => {
    const email = typeof credentials.email === "string" ? credentials.email.trim().toLowerCase() : "";
    const code = typeof credentials.code === "string" ? credentials.code : "";
    await ctx.runMutation(internal.auth.checkAdminAccessLimit, { email: email || "missing" });

    const configuredEmail = env.ADMIN_REVIEW_EMAIL?.trim().toLowerCase() ?? "";
    const configuredDigest = env.ADMIN_REVIEW_CODE_SHA256?.trim().toLowerCase() ?? "";
    const suppliedDigest = await adminAccessDigest(email, code);
    if (!configuredEmail || !configuredDigest || !constantTimeHexEqual(suppliedDigest, configuredDigest)) {
      throw new Error("Invalid admin review credentials");
    }

    const { user } = await createAccount(ctx, {
      provider: "saathi-admin",
      account: { id: email },
      profile: {
        email,
        displayName: "Admin reviewer",
        adminReviewer: true,
        accessStatus: "pending",
      },
      shouldLinkViaEmail: false,
    });
    return { userId: user._id };
  },
});

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    adminAccess,
    Email({
      // Stable provider ID: changing it would break existing authentication sessions.
      id: "saath-email",
      name: "Email code",
      from: "Saathi",
      maxAge: 10 * 60,
      generateVerificationToken: () => {
        const bytes = new Uint32Array(1);
        crypto.getRandomValues(bytes);
        return String(bytes[0] % 1_000_000).padStart(6, "0");
      },
      sendVerificationRequest,
    }),
  ],
});
