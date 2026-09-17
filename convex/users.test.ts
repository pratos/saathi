import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api.js";
import schema from "./schema.js";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

describe("usernames", () => {
  test("normalizes case, rejects reserved or invalid names, and transfers a released claim safely", async () => {
    const t = convexTest(schema, modules);
    const { firstId, secondId } = await t.run(async ctx => ({
      firstId: await ctx.db.insert("users", { email: "first@example.test" }),
      secondId: await ctx.db.insert("users", { email: "second@example.test" }),
    }));
    const first = t.withIdentity({ subject: String(firstId) });
    const second = t.withIdentity({ subject: String(secondId) });

    await expect(first.mutation(api.users.setUsername, { username: "  @Priya_7 " })).resolves.toBe("priya_7");
    await expect(second.mutation(api.users.setUsername, { username: "PRIYA_7" })).rejects.toThrow(/USERNAME_TAKEN/);
    await expect(second.mutation(api.users.setUsername, { username: "SaAtHi" })).rejects.toThrow(/USERNAME_RESERVED/);
    await expect(second.mutation(api.users.setUsername, { username: "7wrong" })).rejects.toThrow(/USERNAME_INVALID/);

    await expect(first.mutation(api.users.setUsername, { username: "priya_new" })).resolves.toBe("priya_new");
    await expect(second.mutation(api.users.setUsername, { username: "PRIYA_7" })).resolves.toBe("priya_7");
    expect(await t.run(ctx => ctx.db.get(firstId))).toMatchObject({ username: "priya_new" });
    expect(await t.run(ctx => ctx.db.get(secondId))).toMatchObject({ username: "priya_7" });
  });

  test("keeps deployed users without usernames readable until onboarding completes", async () => {
    const t = convexTest(schema, modules);
    const userId = await t.run(ctx => ctx.db.insert("users", { email: "existing@example.test", displayName: "Existing member" }));
    const existing = t.withIdentity({ subject: String(userId) });
    await expect(existing.query(api.users.current, {})).resolves.toMatchObject({ displayName: "Existing member" });
    expect((await existing.query(api.users.current, {})).username).toBeUndefined();
  });
});
