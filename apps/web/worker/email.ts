/**
 * Auth emails via the Cloudflare Email Service `send_email` binding (EMAIL).
 * Under `alchemy dev` this is a local simulator writing .eml files under
 * .alchemy/local/email; in prod it sends from PRODUCT.emailFrom.
 *
 * When EMAIL_SINK is bound (tests only), the message is POSTed there as JSON
 * instead — a real fetch seam, not a mock.
 */
import { PRODUCT } from "../src/config";

export interface AuthEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export async function sendAuthEmail(env: Env, email: AuthEmail) {
  if (env.EMAIL_SINK) {
    await env.EMAIL_SINK.fetch("https://email-sink.internal/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(email),
    });
    return;
  }
  if (env.EMAIL) {
    await env.EMAIL.send({
      from: `${PRODUCT.name} <${PRODUCT.emailFrom}>`,
      to: email.to,
      subject: email.subject,
      text: email.text,
      html: email.html,
    });
    return;
  }
  // No mail transport at all — a silently dropped verification email means a
  // user who can never sign in. Fail loudly instead.
  throw new Error("[email] no mail transport configured (EMAIL binding missing)");
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function template(url: string, heading: string, action: string) {
  const text = `${heading}\n\n${action}:\n${url}\n\nIf you didn't request this, you can ignore this email.\nThe ${PRODUCT.name} team`;

  const html = `<p>${escapeHtml(heading)}</p>
<p><a href="${escapeHtml(url)}">${escapeHtml(action)}</a></p>
<p style="word-break:break-all"><small>${escapeHtml(url)}</small></p>
<p><small>If you didn't request this, you can ignore this email.<br/>The ${escapeHtml(PRODUCT.name)} team</small></p>`;

  return { text, html };
}

export function verifyEmailTemplate(url: string) {
  const t = template(url, "Confirm your email address", "Verify your email");
  return { subject: `Verify your ${PRODUCT.name} email`, ...t };
}

export function resetPasswordTemplate(url: string) {
  const t = template(url, `Reset your ${PRODUCT.name} password`, "Reset your password");
  return { subject: `Reset your ${PRODUCT.name} password`, ...t };
}
