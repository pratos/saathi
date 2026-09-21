import { describe, expect, test } from "vitest";
import { conversationUiActionsForRoute } from "./conversationUi.js";

describe("conversationUiActionsForRoute", () => {
  test("maps Jev routes to trusted local actions", () => {
    expect(conversationUiActionsForRoute("settings")).toEqual([
      { kind: "open_settings", label: "Review settings" },
    ]);
    expect(conversationUiActionsForRoute("family_data")).toEqual([
      { kind: "open_inbox", label: "Open family inbox" },
      { kind: "open_files", label: "Open family files" },
    ]);
  });

  test("does not invent actions for conversational or unclear routes", () => {
    expect(conversationUiActionsForRoute("answer")).toEqual([]);
    expect(conversationUiActionsForRoute("clarify")).toEqual([]);
    expect(conversationUiActionsForRoute("unknown")).toEqual([]);
  });
});
