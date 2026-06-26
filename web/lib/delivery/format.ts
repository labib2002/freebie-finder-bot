import type { Deal } from "../db/schema";

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function endsText(deal: Deal): string | null {
  if (!deal.endDate) return null;
  return deal.endDate.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Telegram message body using parse_mode=HTML (simple, only 3 chars to escape). */
export function telegramHtml(deal: Deal): string {
  const lines = [
    "🎁 <b>Free Game</b>",
    `<b>${escapeHtml(deal.title)}</b> — ${escapeHtml(deal.platform)}`,
  ];
  const ends = endsText(deal);
  if (ends) lines.push(`⏳ Ends ${escapeHtml(ends)}`);
  lines.push(`<a href="${escapeHtml(deal.directUrl)}">Claim it →</a>`);
  return lines.join("\n");
}

/** Discord webhook payload (rich embed). */
export function discordPayload(deal: Deal): Record<string, unknown> {
  const ends = endsText(deal);
  return {
    embeds: [
      {
        title: deal.title,
        url: deal.directUrl,
        description: deal.description?.slice(0, 300) || undefined,
        color: 0x2ecc71,
        fields: [
          { name: "Platform", value: deal.platform, inline: true },
          ...(ends ? [{ name: "Ends", value: ends, inline: true }] : []),
        ],
        thumbnail: deal.imageUrl ? { url: deal.imageUrl } : undefined,
        footer: { text: "Freebie Finder" },
      },
    ],
  };
}

/** Web push notification payload. */
export function webPushPayload(deal: Deal): Record<string, unknown> {
  return {
    title: `🎁 Free: ${deal.title}`,
    body: `${deal.platform}${endsText(deal) ? ` · ends ${endsText(deal)}` : ""}`,
    url: deal.directUrl,
    image: deal.imageUrl ?? undefined,
  };
}

/** Single-deal email (rarely used; digests are the main email path). */
export function emailHtml(deal: Deal): { subject: string; html: string } {
  const ends = endsText(deal);
  return {
    subject: `🎁 Free game: ${deal.title}`,
    html: `
      <h2>${escapeHtml(deal.title)}</h2>
      <p><strong>Platform:</strong> ${escapeHtml(deal.platform)}${ends ? ` · <strong>Ends:</strong> ${escapeHtml(ends)}` : ""}</p>
      <p><a href="${escapeHtml(deal.directUrl)}">Claim it →</a></p>
    `,
  };
}
