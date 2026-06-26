import { fetchJson } from "./http";
import type { SourceItem } from "./types";

const API_URL = "https://www.gamerpower.com/api/giveaways";

interface GamerPowerGiveaway {
  id: number;
  title: string;
  worth?: string;
  thumbnail?: string;
  image?: string;
  description?: string;
  open_giveaway_url: string;
  published_date?: string;
  type?: string;
  platforms?: string;
  end_date?: string;
  status?: string;
}

/** Giveaway categories we care about (free games / playable content). */
const WANTED_TYPES = new Set(["Game", "Early Access", "Full Game"]);

function parseEndDate(value?: string): Date | null {
  if (!value || value === "N/A") return null;
  // GamerPower format: "2026-06-19 23:59:00" (UTC).
  const d = new Date(value.replace(" ", "T") + "Z");
  return isNaN(d.getTime()) ? null : d;
}

export async function fetchGamerPower(): Promise<SourceItem[]> {
  const giveaways = await fetchJson<GamerPowerGiveaway[]>(API_URL, 20000);
  return giveaways
    .filter((g) => g.status !== "Expired")
    .filter((g) => !g.type || WANTED_TYPES.has(g.type))
    .map((g) => ({
      source: "gamerpower",
      sourceItemId: String(g.id),
      title: g.title,
      url: g.open_giveaway_url,
      // open_giveaway_url is a GamerPower landing page (a redirect, not the
      // store). It's still the actionable claim link, so deliver it as-is.
      directUrl: g.open_giveaway_url,
      platformHint: g.platforms ?? null,
      imageUrl: g.image || g.thumbnail || null,
      description: g.description ?? null,
      endDate: parseEndDate(g.end_date),
      dealType: g.type ?? null,
      payload: g,
    }));
}
