export type GmailAttachmentDescriptor = {
  attachmentId: string;
  fileName: string;
  mediaType: string;
};

export function parseGmailSourceKey(value: string) {
  const match = value.match(/^gmail:(ca_[A-Za-z0-9_-]{3,200}):([A-Za-z0-9_-]{3,200})$/);
  return match ? { connectedAccountId: match[1], messageId: match[2] } : null;
}

export function gmailAttachmentDescriptors(value: unknown) {
  const found = new Map<string, GmailAttachmentDescriptor>();
  visitRecords(value, record => {
    const attachmentId = firstString(record, ["attachmentId", "attachment_id"]);
    const fileName = firstString(record, ["filename", "fileName", "file_name", "name"]);
    if (!attachmentId || !fileName) return;
    found.set(attachmentId, {
      attachmentId,
      fileName: fileName.slice(0, 240),
      mediaType: firstString(record, ["mimeType", "mime_type", "mimetype", "mediaType"]) || "application/octet-stream",
    });
  });
  return [...found.values()];
}

export function composioDownloadUrl(value: unknown) {
  let result = "";
  visitRecords(value, record => {
    if (result) return;
    const candidate = firstString(record, ["s3url", "s3Url", "downloadUrl", "download_url"]);
    if (candidate && safeHttpsUrl(candidate)) result = candidate;
  });
  return result;
}

export function isPdfAttachment(attachment: GmailAttachmentDescriptor) {
  return attachment.mediaType.toLowerCase() === "application/pdf" || attachment.fileName.toLowerCase().endsWith(".pdf");
}

function visitRecords(value: unknown, visit: (record: Record<string, unknown>) => void, depth = 0) {
  if (depth > 8 || value === null || value === undefined) return;
  if (typeof value === "string") {
    try { visitRecords(JSON.parse(value) as unknown, visit, depth + 1); } catch { /* Not JSON. */ }
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) visitRecords(entry, visit, depth + 1);
    return;
  }
  if (typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  visit(record);
  for (const nested of Object.values(record)) visitRecords(nested, visit, depth + 1);
}

function firstString(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function safeHttpsUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}
