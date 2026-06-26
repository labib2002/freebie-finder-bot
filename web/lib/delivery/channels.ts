import webpush from "web-push";
import { Resend } from "resend";
import { config } from "../config";
import { fetchWithTimeout } from "../sources/http";

export interface SendResult {
  ok: boolean;
  messageId?: string;
  error?: string;
}

/** Send an HTML message to a Telegram chat/channel via the Bot API. */
export async function sendTelegram(chatId: string, html: string): Promise<SendResult> {
  const token = config.telegram.botToken();
  if (!token) return { ok: false, error: "telegram not configured" };
  try {
    const res = await fetchWithTimeout(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: html,
          parse_mode: "HTML",
          disable_web_page_preview: false,
        }),
      },
    );
    const data = (await res.json()) as { ok: boolean; result?: { message_id: number }; description?: string };
    if (!data.ok) return { ok: false, error: data.description || `HTTP ${res.status}` };
    return { ok: true, messageId: String(data.result?.message_id ?? "") };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

/** Post to a Discord channel via webhook. */
export async function sendDiscord(webhookUrl: string, payload: Record<string, unknown>): Promise<SendResult> {
  try {
    const res = await fetchWithTimeout(`${webhookUrl}?wait=true`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}: ${await res.text()}` };
    const data = (await res.json().catch(() => ({}))) as { id?: string };
    return { ok: true, messageId: data.id };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

let vapidConfigured = false;
function ensureVapid() {
  if (vapidConfigured) return;
  webpush.setVapidDetails(
    config.webPush.subject(),
    config.webPush.publicKey(),
    config.webPush.privateKey(),
  );
  vapidConfigured = true;
}

/** Send a web push notification to a stored PushSubscription. */
export async function sendWebPush(
  subscription: webpush.PushSubscription,
  payload: Record<string, unknown>,
): Promise<SendResult> {
  if (!config.webPush.enabled()) return { ok: false, error: "web push not configured" };
  try {
    ensureVapid();
    await webpush.sendNotification(subscription, JSON.stringify(payload));
    return { ok: true };
  } catch (e) {
    const statusCode = (e as { statusCode?: number }).statusCode;
    // 404/410 => subscription is dead and should be pruned by the caller.
    return { ok: false, error: `${statusCode ?? ""} ${String(e)}`.trim() };
  }
}

/** Send a transactional email via Resend. */
export async function sendEmail(to: string, subject: string, html: string): Promise<SendResult> {
  if (!config.email.enabled()) return { ok: false, error: "email not configured" };
  try {
    const resend = new Resend(config.email.apiKey());
    const { data, error } = await resend.emails.send({
      from: config.email.from(),
      to,
      subject,
      html,
    });
    if (error) return { ok: false, error: String(error) };
    return { ok: true, messageId: data?.id };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}
