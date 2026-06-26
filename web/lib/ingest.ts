import { and, eq, lt, or, isNull, sql } from "drizzle-orm";
import { db } from "./db";
import { rawItems, deals, dealSources, type Deal } from "./db/schema";
import { collectAll, type SourceResult } from "./sources";
import type { SourceItem } from "./sources/types";
import {
  canonicalKey,
  normalizeTitle,
  extractPlatform,
  normalizeStoreUrl,
} from "./normalize";
import { isBlockedTitle } from "./blocklist";

/** Deals with no explicit end date are aged out after this many days unseen. */
const ACTIVE_TTL_DAYS = 14;

export interface IngestSummary {
  sources: SourceResult[];
  itemsSeen: number;
  blocked: number;
  newDeals: Deal[];
  updatedDeals: number;
  deactivated: number;
}

/** Insert the raw item (idempotent on source+sourceItemId); return its id. */
async function upsertRawItem(item: SourceItem): Promise<number> {
  const inserted = await db
    .insert(rawItems)
    .values({
      source: item.source,
      sourceItemId: item.sourceItemId,
      rawTitle: item.title,
      rawUrl: item.url,
      payload: item.payload ?? null,
    })
    .onConflictDoNothing({ target: [rawItems.source, rawItems.sourceItemId] })
    .returning({ id: rawItems.id });

  if (inserted[0]) return inserted[0].id;

  const existing = await db
    .select({ id: rawItems.id })
    .from(rawItems)
    .where(and(eq(rawItems.source, item.source), eq(rawItems.sourceItemId, item.sourceItemId)))
    .limit(1);
  return existing[0].id;
}

/** A direct store URL (steam:123 etc.) is strictly better than an aggregator link. */
function isStoreUrl(url: string | null | undefined): boolean {
  return !!url && normalizeStoreUrl(url) !== null;
}

/**
 * Merge a source item into the canonical `deals` table.
 * Returns the deal and whether it was newly created this run.
 */
async function upsertDeal(
  item: SourceItem,
  rawItemId: number,
): Promise<{ deal: Deal; isNew: boolean }> {
  const key = canonicalKey({ directUrl: item.directUrl, title: item.title });
  const directUrl = item.directUrl || item.url;
  const platform = extractPlatform(item.title, item.platformHint);

  const existingRows = await db.select().from(deals).where(eq(deals.canonicalKey, key)).limit(1);
  const existing = existingRows[0];

  let deal: Deal;
  let isNew: boolean;

  if (!existing) {
    const inserted = await db
      .insert(deals)
      .values({
        canonicalKey: key,
        title: normalizeTitle(item.title),
        normalizedTitle: normalizeTitle(item.title),
        platform,
        dealType: item.dealType ?? null,
        directUrl,
        sourceUrl: item.url,
        imageUrl: item.imageUrl ?? null,
        description: item.description ?? null,
        endDate: item.endDate ?? null,
        isActive: true,
      })
      // Guard against a race where two items in the same batch share a key.
      .onConflictDoNothing({ target: deals.canonicalKey })
      .returning();

    if (inserted[0]) {
      deal = inserted[0];
      isNew = true;
    } else {
      deal = (await db.select().from(deals).where(eq(deals.canonicalKey, key)).limit(1))[0];
      isNew = false;
    }
  } else {
    // Upgrade the stored deal with better data from this source if available.
    const better = {
      lastSeenAt: new Date(),
      directUrl:
        isStoreUrl(item.directUrl) && !isStoreUrl(existing.directUrl)
          ? item.directUrl!
          : existing.directUrl,
      imageUrl: existing.imageUrl ?? item.imageUrl ?? null,
      description: existing.description ?? item.description ?? null,
      endDate: existing.endDate ?? item.endDate ?? null,
    };
    const updated = await db
      .update(deals)
      .set(better)
      .where(eq(deals.id, existing.id))
      .returning();
    deal = updated[0];
    isNew = false;
  }

  // Record the source linkage (idempotent per deal+source).
  await db
    .insert(dealSources)
    .values({ dealId: deal.id, source: item.source, sourceUrl: item.url, rawItemId })
    .onConflictDoNothing({ target: [dealSources.dealId, dealSources.source] });

  return { deal, isNew };
}

/** Age out expired / long-unseen deals so the website only shows live ones. */
async function deactivateStale(): Promise<number> {
  const now = new Date();
  const ttlCutoff = new Date(now.getTime() - ACTIVE_TTL_DAYS * 86400_000);
  const res = await db
    .update(deals)
    .set({ isActive: false })
    .where(
      and(
        eq(deals.isActive, true),
        or(
          // explicit end date has passed
          and(sql`${deals.endDate} is not null`, lt(deals.endDate, now)),
          // no end date and not seen for TTL days
          and(isNull(deals.endDate), lt(deals.lastSeenAt, ttlCutoff)),
        ),
      ),
    )
    .returning({ id: deals.id });
  return res.length;
}

/**
 * Full ingestion pass: fetch all sources, normalize, dedup, persist.
 * Returns the newly-created canonical deals (the ones that need delivery).
 */
export async function runIngest(): Promise<IngestSummary> {
  const { items, results } = await collectAll();

  let blocked = 0;
  let updated = 0;
  const newDeals: Deal[] = [];
  const seenKeysThisRun = new Set<string>();

  for (const item of items) {
    if (!item.title || !item.url) continue;
    if (isBlockedTitle(item.title)) {
      blocked++;
      continue;
    }
    const rawItemId = await upsertRawItem(item);
    const { deal, isNew } = await upsertDeal(item, rawItemId);
    if (isNew && !seenKeysThisRun.has(deal.canonicalKey)) {
      seenKeysThisRun.add(deal.canonicalKey);
      newDeals.push(deal);
    } else if (!isNew) {
      updated++;
    }
  }

  const deactivated = await deactivateStale();

  return {
    sources: results,
    itemsSeen: items.length,
    blocked,
    newDeals,
    updatedDeals: updated,
    deactivated,
  };
}
