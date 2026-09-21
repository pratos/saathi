export function emailBodyHtml(originalHtml: string | undefined, originalText: string) {
  const html = originalHtml?.trim();
  if (html) return html;

  const text = originalText.trim();
  if (/^(?:<!doctype\s+html\b|<html\b|<head\b|<body\b)/i.test(text)) return text;

  return `<p>${escapeHtml(originalText)}</p>`;
}

function escapeHtml(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;').replaceAll('\n', '<br>');
}
