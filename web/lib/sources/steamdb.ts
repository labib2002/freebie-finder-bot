import Parser from "rss-parser";
import { fetchText } from "./http";
import type { SourceItem } from "./types";

const RSS_URL = "https://steamdb.info/upcoming/free/rss/";

/** Pull a Steam app id out of a steamdb.info or store.steampowered.com link. */
function steamAppId(url: string): string | null {
  const m = url.match(/(?:steamdb\.info|steampowered\.com)\/(?:app|sub)\/(\d+)/);
  return m ? m[1] : null;
}

export async function fetchSteamDb(): Promise<SourceItem[]> {
  const xml = await fetchText(RSS_URL);
  const feed = await new Parser().parseString(xml);
  return (feed.items ?? []).map((item) => {
    const link = item.link ?? "";
    const appId = steamAppId(link);
    return {
      source: "steamdb",
      sourceItemId: appId || item.guid || link || item.title || "",
      title: item.title ?? "",
      url: link,
      // Resolve to the real Steam store page so cross-source dedup can match by
      // steam app id.
      directUrl: appId ? `https://store.steampowered.com/app/${appId}/` : link,
      platformHint: "Steam",
      payload: item,
    } satisfies SourceItem;
  });
}
