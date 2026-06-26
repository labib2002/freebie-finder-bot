/** A realistic UA — some sources (Reddit, SteamDB) reject obvious bots. */
export const USER_AGENT =
  "Mozilla/5.0 (compatible; FreebieFinder/2.0; +https://github.com/labib2002/freebie-finder-bot)";

export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = 15000,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: { "User-Agent": USER_AGENT, ...(init.headers ?? {}) },
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchText(url: string, timeoutMs = 15000): Promise<string> {
  const res = await fetchWithTimeout(url, {}, timeoutMs);
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.text();
}

export async function fetchJson<T = unknown>(url: string, timeoutMs = 15000): Promise<T> {
  const res = await fetchWithTimeout(url, { headers: { Accept: "application/json" } }, timeoutMs);
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return (await res.json()) as T;
}
