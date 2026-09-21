import { v } from "convex/values";

export const conversationUiActionValidator = v.object({
  kind: v.union(
    v.literal("open_settings"),
    v.literal("open_inbox"),
    v.literal("open_files"),
    v.literal("open_image"),
    v.literal("start_voice"),
    v.literal("send_prompt"),
  ),
  label: v.string(),
  prompt: v.optional(v.string()),
});

export type ConversationUiAction = {
  kind: "open_settings" | "open_inbox" | "open_files" | "open_image" | "start_voice" | "send_prompt";
  label: string;
  prompt?: string;
};

/**
 * Convert Jev's semantic route into a tiny, trusted UI vocabulary.
 * These actions only navigate local UI or draft a follow-up; they never
 * perform an external or destructive operation on their own.
 */
export function conversationUiActionsForRoute(route: string): ConversationUiAction[] {
  if (route === "image") {
    return [{ kind: "open_image", label: "Create another image" }];
  }
  if (route === "search") {
    return [{ kind: "send_prompt", label: "Show the sources", prompt: "Show me the most useful sources for that answer." }];
  }
  if (route === "computer") {
    return [{ kind: "send_prompt", label: "Continue in the browser", prompt: "Continue this task in the live browser." }];
  }
  if (route === "settings") {
    return [{ kind: "open_settings", label: "Review settings" }];
  }
  if (route === "memory") {
    return [{ kind: "send_prompt", label: "Review saved memories", prompt: "List the relevant details you remember for me." }];
  }
  if (route === "family_data") {
    return [
      { kind: "open_inbox", label: "Open family inbox" },
      { kind: "open_files", label: "Open family files" },
    ];
  }
  return [];
}
