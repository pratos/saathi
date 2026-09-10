import { AgentMail } from "@agentmail/convex";
import { Email } from "@convex-dev/auth/providers/Email";
import { HOUR, RateLimiter } from "@convex-dev/rate-limiter";
import { convexAuth } from "@convex-dev/auth/server";
import { components, internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import { v } from "convex/values";

const agentmail = new AgentMail(components.agentmail);
const otpLimits = new RateLimiter(components.rateLimiter, {
  emailOtp: { kind: "fixed window", rate: 5, period: HOUR },
});
type EmailVerificationRequest = Parameters<NonNullable<Parameters<typeof Email>[0]["sendVerificationRequest"]>>[0];
type EmailVerificationSender = NonNullable<Parameters<typeof Email>[0]["sendVerificationRequest"]>;

// Convex Auth supplies its action context as a second runtime argument, although
// the upstream Auth.js callback type currently declares only the first argument.
const sendVerificationRequest = (async (
  { identifier, token, expires }: EmailVerificationRequest,
  ctx: ActionCtx,
) => {
  await ctx.runMutation(internal.auth.queueOtp, {
    to: identifier,
    token,
    expiresAt: expires.getTime(),
  });
}) as unknown as EmailVerificationSender;

export const queueOtp = internalMutation({
  args: { to: v.string(), token: v.string(), expiresAt: v.number() },
  handler: async (ctx, args) => {
    const normalizedEmail = args.to.trim().toLowerCase();
    const limit = await otpLimits.limit(ctx, "emailOtp", { key: normalizedEmail });
    if (!limit.ok) throw new Error("Too many sign-in code requests; try again later");
    const inboxId = process.env.AGENTMAIL_AUTH_INBOX_ID;
    if (!inboxId) throw new Error("AGENTMAIL_AUTH_INBOX_ID is not configured");
    await agentmail.sendMessage(ctx, inboxId, {
      to: normalizedEmail,
      subject: "Your Saath sign-in code",
      text: `Your Saath sign-in code is ${args.token}. It expires at ${new Date(args.expiresAt).toISOString()}. If you did not request it, ignore this email.`,
      labels: ["saath-auth-otp"],
    });
  },
});

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Email({
      id: "saath-email",
      name: "Email code",
      from: "Saath",
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
