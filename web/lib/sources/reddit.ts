import Parser from "rss-parser";
import { fetchJson, fetchText } from "./http";
import type { SourceItem } from "./types";

const SUBREDDIT = "FreeGameFindings";
// old.reddit.com is far less aggressively IP-blocked than www.reddit.com
// (www returns 403/429 from datacenter IPs like Vercel; old still serves RSS).
const JSON_URL = `https://old.reddit.com/r/${SUBREDDIT}/new.json?limit=50`;
const RSS_URL = `https://old.reddit.com/r/${SUBREDDIT}/new.rss`;

interface RedditChild {
  data: {
    id: string;
    title: string;
    permalink: string;
    url_overridden_by_dest?: string;
    is_self?: boolean;
    thumbnail?: string;
    selftext?: string;
  };
}

function isUsableDirectUrl(url: string | undefined): url is string {
  if (!url) return false;
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return !host.endsWith("reddit.com") && !host.endsWith("redd.it");
  } catch {
    return false;
  }
}

/** Preferred path: the JSON listing already carries the outbound store link. */
async function fetchViaJson(): Promise<SourceItem[]> {
  const data = await fetchJson<{ data: { children: RedditChild[] } }>(JSON_URL);
  return data.data.children.map(({ data: p }) => {
    const permalink = `https://www.reddit.com${p.permalink}`;
    const direct = isUsableDirectUrl(p.url_overridden_by_dest)
      ? p.url_overridden_by_dest!
      : null;
    return {
      source: "reddit",
      sourceItemId: p.id,
      title: p.title,
      url: permalink,
      directUrl: direct,
      imageUrl:
        p.thumbnail && p.thumbnail.startsWith("http") ? p.thumbnail : null,
      description: p.selftext?.slice(0, 500) || null,
      payload: p,
    } satisfies SourceItem;
  });
}

/** Parse Reddit RSS XML into SourceItems. Shared by the in-process fetch and
 * the /api/ingest-reddit endpoint (which receives XML fetched by GitHub Actions
 * from a non-datacenter IP, since Reddit 403s Vercel's IPs). */
export async function parseRedditRss(xml: string): Promise<SourceItem[]> {
  const feed = await new Parser().parseString(xml);
  return (feed.items ?? []).map((item) => ({
    source: "reddit",
    sourceItemId: item.id || item.guid || item.link || item.title || "",
    title: item.title ?? "",
    url: item.link ?? "",
    directUrl: null, // RSS doesn't expose the outbound link
    payload: item,
  }));
}

/** Fallback when Reddit blocks the JSON API (cloud IPs sometimes get 403). */
async function fetchViaRss(): Promise<SourceItem[]> {
  return parseRedditRss(await fetchText(RSS_URL));
}

export async function fetchReddit(): Promise<SourceItem[]> {
  try {
    return await fetchViaJson();
  } catch {
    return await fetchViaRss();
  }
}
