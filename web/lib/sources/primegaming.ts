import Parser from "rss-parser";
import { fetchText } from "./http";
import type { SourceItem } from "./types";

const RSS_URL = "https://primegaming.blog/feed";

export async function fetchPrimeGaming(): Promise<SourceItem[]> {
  const xml = await fetchText(RSS_URL);
  const feed = await new Parser().parseString(xml);
  return (feed.items ?? []).map((item) => ({
    source: "primegaming",
    sourceItemId: item.guid || item.link || item.title || "",
    title: item.title ?? "",
    url: item.link ?? "",
    directUrl: item.link ?? null,
    platformHint: "Prime Gaming",
    description: (item.contentSnippet ?? "").slice(0, 500) || null,
    payload: item,
  }));
}
