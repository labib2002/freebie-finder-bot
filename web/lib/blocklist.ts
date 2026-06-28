/**
 * Recurring non-deal posts (megathreads, discussion threads, roundups) that
 * should never become a freebie alert. Carried over + expanded from the legacy bot.
 */
const TITLE_BLOCKLIST = [
  "exiled giveaways",
  "mega thread",
  "megathread",
  "fgf discussion thread",
  "discussion thread",
  "big offers",
  "weekly thread",
  "monthly thread",
  "free games of",
  "free game of the",
  "psa:",
  "meta:",
  // Prime Gaming recurring roundup/promo articles (not individual free games).
  "content update",
  "prime day",
  "claim monthly",
  "bonus games",
  "content roundup",
];

export function isBlockedTitle(title: string): boolean {
  const t = title.toLowerCase();
  return TITLE_BLOCKLIST.some((p) => t.includes(p));
}
