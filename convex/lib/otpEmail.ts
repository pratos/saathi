const escapeHtml = (value: string) => value
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#39;");

const formatExpiry = (expires: Date) => new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "long",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
  timeZone: "UTC",
}).format(expires) + " UTC";

export function buildOtpEmail(token: string, expires: Date) {
  const safeToken = escapeHtml(token);
  const expiry = formatExpiry(expires);
  const subject = "Your Saathi sign-in code";
  const text = [
    "Saathi sign-in",
    "",
    `Your one-time sign-in code is: ${token}`,
    "",
    `This code expires on ${expiry}.`,
    "If you didn't request this code, you can safely ignore this email.",
    "",
    "Saathi · A shared place for family conversations and important details",
  ].join("\n");

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="light only">
    <title>${subject}</title>
  </head>
  <body style="margin:0;padding:0;background-color:#f7f5fb;color:#26222d;font-family:Arial,'Helvetica Neue',sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">Use this one-time code to sign in to Saathi. It expires soon.</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background-color:#f7f5fb;">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table role="presentation" width="560" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:560px;background-color:#fffdfb;border:1px solid #e8e2f1;border-radius:20px;">
            <tr>
              <td style="padding:32px 32px 12px;">
                <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                  <tr>
                    <td width="48" height="48" align="center" valign="middle" style="width:48px;height:48px;border-radius:14px;background-color:#e8e1ff;color:#514183;font-family:Arial,'Noto Sans Devanagari',sans-serif;font-size:24px;font-weight:700;">स</td>
                    <td style="padding-left:14px;color:#26222d;font-size:22px;font-weight:700;line-height:1.2;">Saathi</td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 32px 0;font-size:26px;font-weight:700;line-height:1.25;letter-spacing:-0.5px;">Sign in to Saathi</td>
            </tr>
            <tr>
              <td style="padding:10px 32px 0;color:#64606b;font-size:16px;line-height:1.55;">Enter this one-time code on the Saathi sign-in screen:</td>
            </tr>
            <tr>
              <td style="padding:24px 32px 0;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background-color:#f0ecff;border-radius:16px;">
                  <tr>
                    <td align="center" style="padding:22px 12px;color:#3f326b;font-family:'Courier New',Courier,monospace;font-size:38px;font-weight:700;line-height:1;letter-spacing:8px;white-space:nowrap;">${safeToken}</td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px 0;color:#49444f;font-size:15px;line-height:1.55;"><strong>This code expires on ${expiry}.</strong><br>If you didn’t request it, you can safely ignore this email.</td>
            </tr>
            <tr>
              <td style="padding:28px 32px 32px;color:#77717e;font-size:12px;line-height:1.5;border-top:1px solid #eee9f3;">Saathi · A shared place for family conversations and important details<br>This is an automated security email. Please don’t reply.</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { subject, text, html };
}
