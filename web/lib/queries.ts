import { and, eq, desc, gte } from "drizzle-orm";
import { db } from "./db";
import { deals, dealSources, type Deal } from "./db/schema";

/** Currently-claimable freebies for the public home page. */
export async function getActiveDeals(limit = 100): Promise<Deal[]> {
  return db
    .select()
    .from(deals)
    .where(eq(deals.isActive, true))
    .orderBy(desc(deals.firstSeenAt))
    .limit(limit);
}

/** Count of distinct sources backing a deal (shows the dedup working). */
export async function getDealSourceCounts(dealIds: number[]): Promise<Map<number, string[]>> {
  if (dealIds.length === 0) return new Map();
  const rows = await db
    .select({ dealId: dealSources.dealId, source: dealSources.source })
    .from(dealSources);
  const map = new Map<number, string[]>();
  for (const r of rows) {
    if (!dealIds.includes(r.dealId)) continue;
    const arr = map.get(r.dealId) ?? [];
    arr.push(r.source);
    map.set(r.dealId, arr);
  }
  return map;
}

export async function getRecentDealCount(hours = 24): Promise<number> {
  const since = new Date(Date.now() - hours * 3600_000);
  const rows = await db
    .select({ id: deals.id })
    .from(deals)
    .where(and(eq(deals.isActive, true), gte(deals.firstSeenAt, since)));
  return rows.length;
}
