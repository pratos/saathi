import { describe, expect, test } from "vitest";
import { composioDownloadUrl, gmailAttachmentDescriptors, isPdfAttachment, parseGmailSourceKey } from "./gmailAttachments";

describe("Gmail attachment metadata", () => {
  test("extracts hydrated Gmail attachments and the safe Composio file URL", () => {
    const payload = {
      data: JSON.stringify({
        attachmentList: [
          { attachmentId: "ANGjd_invoice", filename: "Venice receipt.pdf", mimeType: "application/pdf" },
          { attachment_id: "ANGjd_logo", file_name: "logo.png", mime_type: "image/png" },
        ],
      }),
    };
    const attachments = gmailAttachmentDescriptors(payload);
    expect(attachments).toHaveLength(2);
    expect(attachments[0]).toMatchObject({ attachmentId: "ANGjd_invoice", fileName: "Venice receipt.pdf" });
    expect(isPdfAttachment(attachments[0])).toBe(true);
    expect(isPdfAttachment(attachments[1])).toBe(false);
    expect(composioDownloadUrl({ data: { file: { s3url: "https://files.example.test/receipt.pdf?token=short-lived" } } }))
      .toBe("https://files.example.test/receipt.pdf?token=short-lived");
    expect(composioDownloadUrl({ file: { s3url: "http://files.example.test/unsafe.pdf" } })).toBe("");
  });

  test("parses only canonical Gmail source keys", () => {
    expect(parseGmailSourceKey("gmail:ca_primary-1:19b11732c1b578fd")).toEqual({
      connectedAccountId: "ca_primary-1",
      messageId: "19b11732c1b578fd",
    });
    expect(parseGmailSourceKey("agentmail:message-1")).toBeNull();
  });
});
