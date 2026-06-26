/** A normalized item produced by a source fetcher, before canonicalization. */
export interface SourceItem {
  /** Source slug: "reddit" | "gamerpower" | "steamdb" | "primegaming" | "itad". */
  source: string;
  /** Stable id within the source (used to dedup re-fetches of the same item). */
  sourceItemId: string;
  /** Raw title as the source provides it. */
  title: string;
  /** The source/aggregator URL (reddit thread, gamerpower landing, blog post). */
  url: string;
  /** Resolved direct store/claim link when we can extract one. */
  directUrl?: string | null;
  /** Explicit platform field from the source, if any (e.g. "PC, Steam"). */
  platformHint?: string | null;
  imageUrl?: string | null;
  description?: string | null;
  /** When the giveaway ends, if the source tells us. */
  endDate?: Date | null;
  dealType?: string | null;
  /** Raw source payload, stored for debugging/auditing. */
  payload?: unknown;
}

export type Fetcher = () => Promise<SourceItem[]>;
