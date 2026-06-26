import type { SourceItem } from "./types";
import { fetchReddit } from "./reddit";
import { fetchGamerPower } from "./gamerpower";
import { fetchSteamDb } from "./steamdb";
import { fetchPrimeGaming } from "./primegaming";
import { fetchItad } from "./itad";

const FETCHERS: Record<string, () => Promise<SourceItem[]>> = {
  reddit: fetchReddit,
  gamerpower: fetchGamerPower,
  steamdb: fetchSteamDb,
  primegaming: fetchPrimeGaming,
  itad: fetchItad,
};

export interface SourceResult {
  source: string;
  ok: boolean;
  count: number;
  error?: string;
}

/**
 * Run every source fetcher in parallel, fail-soft. One blocked/broken source
 * never aborts the run — cross-source dedup tolerates partial coverage.
 */
export async function collectAll(): Promise<{
  items: SourceItem[];
  results: SourceResult[];
}> {
  const entries = Object.entries(FETCHERS);
  const settled = await Promise.allSettled(entries.map(([, fn]) => fn()));

  const items: SourceItem[] = [];
  const results: SourceResult[] = settled.map((res, i) => {
    const source = entries[i][0];
    if (res.status === "fulfilled") {
      items.push(...res.value);
      return { source, ok: true, count: res.value.length };
    }
    return { source, ok: false, count: 0, error: String(res.reason) };
  });

  return { items, results };
}
