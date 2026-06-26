import { and, gte, eq, desc } from "drizzle-orm";
import { GoogleGenAI } from "@google/genai";
import { db } from "./db";
import { deals, digests, channels, users, type Deal } from "./db/schema";
import { config } from "./config";
import { sendTelegram, sendDiscord, sendEmail } from "./delivery/channels";
import { escapeHtml } from "./delivery/format";

const MAX_TELEGRAM_CHARS = 3900;

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Deals first discovered in the last 24h — the deterministic digest set. */
export async function getDealsForDigest(sinceHours = 24): Promise<Deal[]> {
  const since = new Date(Date.now() - sinceHours * 3600_000);
  return db
    .select()
    .from(deals)
    .where(and(gte(deals.firstSeenAt, since), eq(deals.isActive, true)))
    .orderBy(desc(deals.firstSeenAt));
}

/**
 * Resolve the newest free Flash model that supports generateContent, via the
 * ListModels API — so a Google rename/retirement never silently 404s us and we
 * never have to edit a hardcoded version string. SUMMARY_MODEL pins it if set.
 * Falls back to the "*-latest" alias if listing fails. Cached per-process.
 */
const FLASH_FALLBACK = "gemini-flash-latest";
let cachedModel: string | undefined;

async function resolveLatestFlashModel(ai: GoogleGenAI): Promise<string> {
  const override = config.gemini.modelOverride();
  if (override) return override;
  if (cachedModel) return cachedModel;

  try {
    // Numeric version embedded in a model id, e.g. "gemini-2.5-flash" -> 2.5.
    const versionOf = (id: string): number => {
      const m = id.match(/gemini-(\d+(?:\.\d+)?)-flash/);
      return m ? parseFloat(m[1]) : -1;
    };

    let best: string | undefined;
    let bestVersion = -Infinity;
    const pager = await ai.models.list({ config: { queryBase: true } });
    for await (const model of pager) {
      const id = (model.name ?? "").replace(/^models\//, "");
      if (!/gemini-.*flash/.test(id)) continue;
      if (/preview|exp|thinking|tts|image|audio|live/i.test(id)) continue; // skip non-GA / specialized
      if (!model.supportedActions?.includes("generateContent")) continue;
      const v = versionOf(id);
      if (v > bestVersion) {
        bestVersion = v;
        best = id;
      }
    }
    cachedModel = best ?? FLASH_FALLBACK;
  } catch {
    cachedModel = FLASH_FALLBACK;
  }
  return cachedModel;
}

/** Ask the model for ONE overview sentence. Fail-soft to a static line. */
async function generateOverview(dealList: Deal[]): Promise<string> {
  const fallback = `${dealList.length} new free game${dealList.length === 1 ? "" : "s"} surfaced in the last 24 hours.`;
  if (!config.gemini.enabled() || dealList.length === 0) return fallback;
  try {
    const ai = new GoogleGenAI({ apiKey: config.gemini.apiKey() });
    const model = await resolveLatestFlashModel(ai);
    const titles = dealList.slice(0, 50).map((d) => `- ${d.title} (${d.platform})`).join("\n");
    const res = await ai.models.generateContent({
      model,
      contents:
        "Write ONE upbeat sentence (max 25 words) summarizing today's free game haul. " +
        "Do not list games, do not use markdown.\n\n" +
        titles,
    });
    return (res.text ?? "").trim() || fallback;
  } catch {
    return fallback;
  }
}

/** Build Telegram-safe message chunks from DB records (URLs never AI-touched). */
export function buildTelegramDigest(dealList: Deal[], overview: string): string[] {
  const header = `🎮 <b>Daily Free Games Digest</b>\n<i>${escapeHtml(overview)}</i>\n`;
  const lines = dealList.map(
    (d) =>
      `• <a href="${escapeHtml(d.directUrl)}">${escapeHtml(d.title)}</a> — ${escapeHtml(d.platform)}`,
  );

  const chunks: string[] = [];
  let current = header;
  for (const line of lines) {
    if ((current + "\n" + line).length > MAX_TELEGRAM_CHARS) {
      chunks.push(current);
      current = "🎮 <b>Daily Free Games Digest</b> <i>(cont.)</i>\n";
    }
    current += "\n" + line;
  }
  chunks.push(current);
  return chunks;
}

function buildEmailDigest(dealList: Deal[], overview: string): { subject: string; html: string } {
  const items = dealList
    .map(
      (d) =>
        `<li><a href="${escapeHtml(d.directUrl)}">${escapeHtml(d.title)}</a> — ${escapeHtml(d.platform)}${
          d.endDate ? ` (ends ${d.endDate.toISOString().slice(0, 10)})` : ""
        }</li>`,
    )
    .join("");
  return {
    subject: `🎮 ${dealList.length} free games today`,
    html: `<h2>Daily Free Games Digest</h2><p><em>${escapeHtml(overview)}</em></p><ul>${items}</ul>
      <p style="color:#888;font-size:12px">Freebie Finder · <a href="${config.appUrl()}">manage preferences</a></p>`,
  };
}

export interface DigestSummary {
  date: string;
  status: string;
  dealCount: number;
  skipped?: boolean;
}

/** Build + send the daily digest to global channels and per-user email. Idempotent per day. */
export async function runDigest(): Promise<DigestSummary> {
  const date = todayUtc();

  const existing = (await db.select().from(digests).where(eq(digests.digestDate, date)).limit(1))[0];
  if (existing?.status === "sent") {
    return { date, status: "sent", dealCount: existing.dealCount, skipped: true };
  }

  const dealList = await getDealsForDigest();
  if (dealList.length === 0) {
    await db
      .insert(digests)
      .values({ digestDate: date, status: "empty", dealCount: 0 })
      .onConflictDoNothing({ target: digests.digestDate });
    return { date, status: "empty", dealCount: 0 };
  }

  const overview = await generateOverview(dealList);

  // Global broadcast channels.
  if (config.telegram.enabled()) {
    for (const chunk of buildTelegramDigest(dealList, overview)) {
      await sendTelegram(config.telegram.channelId(), chunk);
    }
  }
  if (config.discord.enabled()) {
    await sendDiscord(config.discord.webhookUrl(), {
      content: `🎮 **Daily Free Games Digest** — ${overview}`,
      embeds: dealList.slice(0, 10).map((d) => ({
        title: d.title,
        url: d.directUrl,
        color: 0x9b59b6,
        fields: [{ name: "Platform", value: d.platform, inline: true }],
      })),
    });
  }

  // Per-user email digests.
  if (config.email.enabled()) {
    const emailChannels = await db
      .select({ address: channels.address })
      .from(channels)
      .innerJoin(users, eq(channels.userId, users.id))
      .where(and(eq(users.paused, false), eq(channels.enabled, true), eq(channels.type, "email")));
    const { subject, html } = buildEmailDigest(dealList, overview);
    for (const c of emailChannels) {
      if (c.address) await sendEmail(c.address, subject, html);
    }
  }

  await db
    .insert(digests)
    .values({ digestDate: date, status: "sent", overview, dealCount: dealList.length, sentAt: new Date() })
    .onConflictDoUpdate({
      target: digests.digestDate,
      set: { status: "sent", overview, dealCount: dealList.length, sentAt: new Date() },
    });

  return { date, status: "sent", dealCount: dealList.length };
}
