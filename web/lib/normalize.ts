/**
 * Normalization + cross-source de-duplication.
 *
 * This is the core fix for the "I get the same game from every source" problem.
 * Validated against the real 1,387-row legacy DB: ~65% of GamerPower games also
 * appear on Reddit under a different URL. Both sources encode the title + platform
 * in their slug/title, so a normalized title signature merges them into one deal.
 *
 * These functions are PURE (no I/O) so they can be unit-tested in isolation.
 */

/** Words that carry no identity and only add noise to a deal title. */
const STOPWORDS = new Set([
  // article / glue words
  "the", "a", "an", "of", "and", "for", "on", "to", "in", "with", "your", "my",
  // freebie boilerplate
  "free", "freebie", "giveaway", "giveaways", "key", "keys", "code", "codes",
  "deal", "deals", "claim", "get", "grab", "download", "redeem", "drop", "drops",
  "offer", "offers", "100", "off", "now", "currently", "limited", "time",
  // generic descriptors that appear inconsistently across sources
  "game", "games", "dlc", "addon", "bundle", "pack", "content", "update",
  "playtest", "beta", "demo", "alpha", "early", "access",
  // platform / storefront words (also handled by PLATFORMS, listed here so they
  // never leak into the dedup signature)
  "steam", "epic", "epicgames", "gog", "indiegala", "itch", "itchio", "io",
  "ubisoft", "uplay", "origin", "ea", "gamesplanet", "fanatical", "humble",
  "alienware", "stove", "microsoft", "xbox", "playstation", "ps4", "ps5",
  "switch", "nintendo", "amazon", "prime", "primegaming", "mobile", "android",
  "ios", "pc", "drm", "other",
]);

/**
 * Maps many spellings/aliases to a single canonical platform label.
 * Used for display + filtering, NOT for the dedup key (so the same game labelled
 * "IndieGala" on Reddit and "PC" on GamerPower still merges).
 */
const PLATFORM_ALIASES: Array<[RegExp, string]> = [
  [/\bepic\b|\bepic\s*games?\b/i, "Epic Games"],
  [/\bsteam\b/i, "Steam"],
  [/\bgog\b/i, "GOG"],
  [/\bindiegala\b/i, "IndieGala"],
  [/\bitch\.?io\b|\bitch\b/i, "itch.io"],
  [/\bubisoft\b|\buplay\b/i, "Ubisoft"],
  [/\borigin\b|\bea\s*(app|play|origin)\b/i, "EA"],
  [/\bprime\s*gaming\b|\bamazon\b|\bprime\b/i, "Prime Gaming"],
  [/\bxbox\b|\bmicrosoft\b/i, "Xbox"],
  [/\bplaystation\b|\bps[45]\b/i, "PlayStation"],
  [/\b(nintendo|switch)\b/i, "Nintendo"],
  [/\bfanatical\b/i, "Fanatical"],
  [/\bhumble\b/i, "Humble"],
  [/\bgamesplanet\b/i, "GamesPlanet"],
  [/\bstove\b/i, "STOVE"],
  [/\balienware\b/i, "Alienware"],
];

/** Strip `[...]` and `(...)` groups (where sources stash platform/type tags). */
function stripBracketGroups(text: string): string {
  return text.replace(/\[[^\]]*\]/g, " ").replace(/\([^)]*\)/g, " ");
}

/**
 * A clean, human-readable title for display. Removes bracket/paren tag groups
 * and trailing "Giveaway"/"Key Giveaway" noise but keeps the real words + order.
 */
export function normalizeTitle(raw: string): string {
  let t = stripBracketGroups(raw);
  t = t.replace(/\b100%?\s*off\b/gi, " ");
  // strip trailing freebie boilerplate like "... Key Giveaway", "... Giveaway"
  t = t.replace(/\b(free\s+)?(steam\s+|epic\s+|gog\s+)?(key\s+)?giveaway\b/gi, " ");
  t = t.replace(/\s+/g, " ").trim();
  return t || raw.trim();
}

/**
 * The de-dup signature: lowercase, drop bracket groups + stopwords + platform
 * words, then sort the unique remaining tokens. Order-independent so
 * "The Battle of Polytopia" and "Battle of Polytopia (Epic Games)" collide.
 */
export function titleSignature(raw: string): string {
  const cleaned = stripBracketGroups(raw)
    .replace(/\b100%?\s*off\b/gi, " ")
    .toLowerCase();
  const tokens = cleaned
    .split(/[^a-z0-9]+/)
    .filter((w) => w && !STOPWORDS.has(w));
  const significant = Array.from(new Set(tokens)).sort();
  // Fallback: if stopword removal nuked everything (e.g. a title made entirely
  // of platform words), keep all alphanumeric tokens so we still get a key.
  if (significant.length === 0) {
    return Array.from(new Set(cleaned.split(/[^a-z0-9]+/).filter(Boolean)))
      .sort()
      .join(" ");
  }
  return significant.join(" ");
}

/** Best-effort platform label for display; `hint` is an explicit source field. */
export function extractPlatform(raw: string, hint?: string | null): string {
  const haystack = `${raw} ${hint ?? ""}`;
  for (const [re, label] of PLATFORM_ALIASES) {
    if (re.test(haystack)) return label;
  }
  return "PC";
}

/**
 * Reduce a known storefront URL to a stable identity (`steam:12345`).
 * Returns null for aggregator/landing pages (reddit, gamerpower/open, ...).
 */
export function normalizeStoreUrl(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^www\./, "").toLowerCase();
  const path = u.pathname.replace(/\/+$/, "");

  if (host.includes("steampowered.com") || host === "store.steampowered.com") {
    const m = path.match(/\/(?:app|sub|bundle)\/(\d+)/);
    if (m) return `steam:${m[1]}`;
  }
  if (host.includes("epicgames.com")) {
    const m = path.match(/\/(?:p|product)\/([^/]+)/) || path.match(/\/([^/]+)$/);
    if (m) return `epic:${m[1].toLowerCase()}`;
  }
  if (host.includes("gog.com")) {
    const m = path.match(/\/game\/([^/]+)/);
    if (m) return `gog:${m[1].toLowerCase()}`;
  }
  if (host.includes("ubisoft.com") || host.includes("ubi.com")) {
    const m = path.match(/\/([^/]+)$/);
    if (m) return `ubisoft:${m[1].toLowerCase()}`;
  }
  if (host.includes("microsoft.com") && path.includes("/store")) {
    const m = path.match(/\/([^/]+)$/);
    if (m) return `xbox:${m[1].toLowerCase()}`;
  }
  return null;
}

export interface CanonicalInput {
  /** The resolved outbound/store URL if we managed to extract one. */
  directUrl?: string | null;
  /** Raw title from the source (Reddit/GamerPower/etc.). */
  title: string;
}

/**
 * The canonical key that collapses the same deal from multiple sources into one.
 * Priority:
 *   1. resolved direct store identity (strongest — same Steam app id == same deal)
 *   2. normalized title signature (catches cross-source dups even with no store link)
 */
export function canonicalKey({ directUrl, title }: CanonicalInput): string {
  if (directUrl) {
    const storeId = normalizeStoreUrl(directUrl);
    if (storeId) return `url:${storeId}`;
  }
  return `title:${titleSignature(title)}`;
}
