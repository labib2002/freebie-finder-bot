import { and, eq, ne, lt, inArray } from "drizzle-orm";
import { db } from "../db";
import { deals, channels, users, deliveries, type Deal, type Channel } from "../db/schema";
import { config } from "../config";
import { sendTelegram, sendDiscord, sendWebPush, sendEmail, type SendResult } from "./channels";
import { telegramHtml, discordPayload, webPushPayload, emailHtml } from "./format";

const MAX_ATTEMPTS = 5;

/* ------------------------------------------------------------------ *
 * Target resolution
 * ------------------------------------------------------------------ */

/** Global broadcast targets everyone receives (no account needed). */
function globalTargets(): string[] {
  const t: string[] = [];
  if (config.telegram.enabled()) t.push("telegram:channel");
  if (config.discord.enabled()) t.push("discord:webhook");
  return t;
}

/** Per-user realtime channels (web push + personal telegram DM). */
async function perUserTargets(): Promise<string[]> {
  const rows = await db
    .select({ id: channels.id })
    .from(channels)
    .innerJoin(users, eq(channels.userId, users.id))
    .where(
      and(
        eq(users.paused, false),
        eq(channels.enabled, true),
        inArray(channels.type, ["web_push", "telegram_dm"]),
      ),
    );
  return rows.map((r) => `channel:${r.id}`);
}

async function loadChannel(id: number): Promise<Channel | undefined> {
  return (await db.select().from(channels).where(eq(channels.id, id)).limit(1))[0];
}

/** Execute a single target for a deal. Side effect: prune dead push subs. */
async function executeTarget(deal: Deal, target: string): Promise<SendResult> {
  if (target === "telegram:channel") {
    return sendTelegram(config.telegram.channelId(), telegramHtml(deal));
  }
  if (target === "discord:webhook") {
    return sendDiscord(config.discord.webhookUrl(), discordPayload(deal));
  }
  if (target.startsWith("channel:")) {
    const channel = await loadChannel(Number(target.slice("channel:".length)));
    if (!channel || !channel.enabled) return { ok: false, error: "channel missing/disabled" };

    if (channel.type === "telegram_dm" && channel.address) {
      return sendTelegram(channel.address, telegramHtml(deal));
    }
    if (channel.type === "web_push" && channel.config) {
      const res = await sendWebPush(channel.config as never, webPushPayload(deal));
      if (!res.ok && /\b(404|410)\b/.test(res.error ?? "")) {
        await db.update(channels).set({ enabled: false }).where(eq(channels.id, channel.id));
      }
      return res;
    }
    if (channel.type === "email" && channel.address) {
      const { subject, html } = emailHtml(deal);
      return sendEmail(channel.address, subject, html);
    }
    return { ok: false, error: `unsupported channel type ${channel.type}` };
  }
  return { ok: false, error: `unknown target ${target}` };
}

/* ------------------------------------------------------------------ *
 * Delivery lifecycle (idempotent, retry-safe)
 * ------------------------------------------------------------------ */

/** Ensure a deliveries row exists, attempt send if not already sent. */
async function attemptDelivery(deal: Deal, target: string): Promise<"sent" | "failed" | "skipped"> {
  await db
    .insert(deliveries)
    .values({ dealId: deal.id, target, status: "pending" })
    .onConflictDoNothing({ target: [deliveries.dealId, deliveries.target] });

  const row = (
    await db
      .select()
      .from(deliveries)
      .where(and(eq(deliveries.dealId, deal.id), eq(deliveries.target, target)))
      .limit(1)
  )[0];

  if (row.status === "sent") return "skipped";
  if (row.attempts >= MAX_ATTEMPTS) return "failed";

  const result = await executeTarget(deal, target);
  await db
    .update(deliveries)
    .set({
      status: result.ok ? "sent" : "failed",
      providerMessageId: result.messageId ?? null,
      error: result.ok ? null : result.error ?? "unknown",
      attempts: row.attempts + 1,
      lastAttemptAt: new Date(),
    })
    .where(eq(deliveries.id, row.id));

  return result.ok ? "sent" : "failed";
}

export interface DeliverySummary {
  attempted: number;
  sent: number;
  failed: number;
  skipped: number;
}

/** Fan a single new deal out to all global + per-user realtime targets. */
export async function deliverDeal(deal: Deal): Promise<DeliverySummary> {
  const targets = [...globalTargets(), ...(await perUserTargets())];
  const summary: DeliverySummary = { attempted: 0, sent: 0, failed: 0, skipped: 0 };
  for (const target of targets) {
    summary.attempted++;
    const outcome = await attemptDelivery(deal, target);
    summary[outcome]++;
  }
  return summary;
}

/** Deliver a batch of new deals (called by /api/poll after ingest). */
export async function deliverDeals(newDeals: Deal[]): Promise<DeliverySummary> {
  const total: DeliverySummary = { attempted: 0, sent: 0, failed: 0, skipped: 0 };
  for (const deal of newDeals) {
    const s = await deliverDeal(deal);
    total.attempted += s.attempted;
    total.sent += s.sent;
    total.failed += s.failed;
    total.skipped += s.skipped;
  }
  return total;
}

/** Re-attempt previously failed deliveries that haven't hit the attempt cap. */
export async function retryFailedDeliveries(): Promise<DeliverySummary> {
  const stuck = await db
    .select()
    .from(deliveries)
    .where(and(ne(deliveries.status, "sent"), lt(deliveries.attempts, MAX_ATTEMPTS)))
    .limit(200);

  const summary: DeliverySummary = { attempted: 0, sent: 0, failed: 0, skipped: 0 };
  for (const row of stuck) {
    const deal = (await db.select().from(deals).where(eq(deals.id, row.dealId)).limit(1))[0];
    if (!deal) continue;
    summary.attempted++;
    const outcome = await attemptDelivery(deal, row.target);
    summary[outcome]++;
  }
  return summary;
}
