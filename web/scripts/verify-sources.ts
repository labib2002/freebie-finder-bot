/**
 * Live smoke test for the source fetchers + dedup — no database required.
 * Run: npx tsx scripts/verify-sources.ts
 */
import { collectAll } from "../lib/sources";
import { canonicalKey } from "../lib/normalize";
import { isBlockedTitle } from "../lib/blocklist";

async function main() {
  const { items, results } = await collectAll();

  console.log("\n=== SOURCE RESULTS ===");
  for (const r of results) {
    console.log(`  ${r.ok ? "✓" : "✗"} ${r.source.padEnd(12)} ${r.count} items${r.error ? "  ERR: " + r.error.slice(0, 80) : ""}`);
  }

  const usable = items.filter((i) => i.title && i.url && !isBlockedTitle(i.title));
  const byKey = new Map<string, typeof usable>();
  for (const it of usable) {
    const k = canonicalKey({ directUrl: it.directUrl, title: it.title });
    (byKey.get(k) ?? byKey.set(k, []).get(k)!).push(it);
  }

  const merged = [...byKey.values()].filter((g) => g.length > 1);
  console.log("\n=== DEDUP ===");
  console.log(`  raw usable items : ${usable.length}`);
  console.log(`  canonical deals  : ${byKey.size}`);
  console.log(`  merged groups    : ${merged.length} (would have been duplicate alerts)`);

  console.log("\n=== SAMPLE CROSS-SOURCE MERGES ===");
  for (const g of merged.slice(0, 8)) {
    console.log(`  • ${g.map((x) => `${x.source}:"${x.title.slice(0, 40)}"`).join("  ==  ")}`);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
