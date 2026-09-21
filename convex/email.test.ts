import { describe, expect, test } from "vitest";
import { inboundMessageBodies } from "./email.js";

const baseMessage = {
  inbox_id: "inbox_123",
  thread_id: "thread_123",
  message_id: "message_123",
  from: "sender@example.test",
  timestamp: "2026-09-21T10:00:00.000Z",
};

describe("AgentMail message bodies", () => {
  test("preserves extracted HTML and plain text as separate representations", () => {
    expect(inboundMessageBodies({
      ...baseMessage,
      text: "Full plain text",
      html: "<p>Full HTML</p>",
      extracted_text: "New plain text",
      extracted_html: "<p>New HTML</p>",
    })).toEqual({
      text: "New plain text",
      html: "<p>New HTML</p>",
    });
  });

  test("keeps an HTML-only email renderable", () => {
    expect(inboundMessageBodies({
      ...baseMessage,
      preview: "Apple subscription changes",
      html: "<!doctype html><html><body><h1>Changes</h1></body></html>",
    })).toEqual({
      text: "Apple subscription changes",
      html: "<!doctype html><html><body><h1>Changes</h1></body></html>",
    });
  });
});
