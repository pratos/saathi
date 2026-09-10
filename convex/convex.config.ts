import agentmail from "@agentmail/convex/convex.config";
import rateLimiter from "@convex-dev/rate-limiter/convex.config";
import staticHosting from "@convex-dev/static-hosting/convex.config";
import workflow from "@convex-dev/workflow/convex.config";
import firecrawl from "@firecrawl/firecrawl-convex/convex.config";
import { defineApp } from "convex/server";
import { v } from "convex/values";

// App-owned routing keeps Auth discovery and AgentMail at stable root URLs.
const app = defineApp({
  env: {
    FIRECRAWL_API_KEY: v.string(),
    FIRECRAWL_WEBHOOK_SECRET: v.optional(v.string()),
    OPENROUTER_API_KEY: v.string(),
    SARVAM_API_KEY: v.string(),
  },
});

app.use(agentmail);
app.use(workflow);
app.use(rateLimiter);
app.use(firecrawl, {
  httpPrefix: "/firecrawl/",
  env: {
    FIRECRAWL_API_KEY: app.env.FIRECRAWL_API_KEY,
    FIRECRAWL_WEBHOOK_SECRET: app.env.FIRECRAWL_WEBHOOK_SECRET,
  },
});
app.use(staticHosting);

export default app;
