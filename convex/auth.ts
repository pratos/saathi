import { Email } from "@convex-dev/auth/providers/Email";
import { HOUR, RateLimiter } from "@convex-dev/rate-limiter";
import { convexAuth } from "@convex-dev/auth/server";
import { components, internal } from "./_generated/api";
import { env, internalMutation } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import { buildOtpEmail } from "./lib/otpEmail";

const otpLimits = new RateLimiter(components.rateLimiter, {
  emailOtpV2: { kind: "fixed window", rate: 10, period: HOUR },
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

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
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
