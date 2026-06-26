/**
 * One-time migration: seed the canonical_key of every historical deal from the
 * legacy SQLite DB so the rebuilt poller does NOT re-blast 1,387 old freebies on
 * its first run. Seeded deals are marked inactive (they're history, not live).
 *
 * Run after `db:migrate`:  npx tsx scripts/migrate-legacy.ts
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { config as loadEnv } from "dotenv";
import { db } from "../lib/db";
import { deals } from "../lib/db/schema";
import { canonicalKey, normalizeTitle, extractPlatform } from "../lib/normalize";

loadEnv({ path: ".env.local" });

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Turn a URL's last path segment into rough title text for signature derivation. */
function slugToText(url: string): string {
  try {
    const path = new URL(url).pathname.replace(/\/+$/, "");
    const slug = path.split("/").pop() ?? "";
    return decodeURIComponent(slug).replace(/[-_]+/g, " ").trim();
  } catch {
    return "";
  }
}

async function main() {
  const urls: string[] = JSON.parse(readFileSync(join(__dirname, "legacy_urls.json"), "utf8"));
  console.log(`Seeding ${urls.length} legacy URLs…`);

  const seen = new Set<string>();
  let inserted = 0;
  for (const url of urls) {
    const text = slugToText(url);
    if (!text) continue;
    const key = canonicalKey({ title: text });
    if (seen.has(key)) continue;
    seen.add(key);

    const res = await db
      .insert(deals)
      .values({
        canonicalKey: key,
        title: normalizeTitle(text),
        normalizedTitle: normalizeTitle(text),
        platform: extractPlatform(url),
        directUrl: url,
        sourceUrl: url,
        isActive: false, // historical, not currently claimable
      })
      .onConflictDoNothing({ target: deals.canonicalKey })
      .returning({ id: deals.id });
    if (res[0]) inserted++;
  }

  console.log(`Done. Inserted ${inserted} canonical history rows (${seen.size} unique keys).`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
