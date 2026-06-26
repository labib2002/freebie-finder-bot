import Link from "next/link";
import { getActiveDeals, getDealSourceCounts, getRecentDealCount } from "@/lib/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SOURCE_LABELS: Record<string, string> = {
  reddit: "Reddit",
  gamerpower: "GamerPower",
  steamdb: "SteamDB",
  primegaming: "Prime",
  itad: "ITAD",
};

function fmtDate(d: Date | null): string | null {
  if (!d) return null;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export default async function Home() {
  const [deals, recent] = await Promise.all([getActiveDeals(120), getRecentDealCount(24)]);
  const sourceMap = await getDealSourceCounts(deals.map((d) => d.id));

  const tgChannel = process.env.TELEGRAM_CHANNEL_ID?.replace(/^@/, "");
  const discordInvite = process.env.DISCORD_INVITE_URL;

  return (
    <main className="mx-auto w-full max-w-5xl px-5 py-10">
      <header className="mb-10">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-3xl font-bold tracking-tight">🎁 Freebie Finder</h1>
          <Link
            href="/preferences"
            className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background hover:opacity-90"
          >
            Get alerts
          </Link>
        </div>
        <p className="mt-3 max-w-2xl text-base text-gray-500">
          Free games from Reddit, GamerPower, SteamDB, Prime Gaming and IsThereAnyDeal — merged
          into one feed with duplicates removed. {recent} new in the last 24h.
        </p>
        <div className="mt-4 flex flex-wrap gap-3 text-sm">
          {tgChannel && (
            <a className="rounded-md border px-3 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-900" href={`https://t.me/${tgChannel}`}>
              Join Telegram channel
            </a>
          )}
          {discordInvite && (
            <a className="rounded-md border px-3 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-900" href={discordInvite}>
              Join Discord
            </a>
          )}
        </div>
      </header>

      {deals.length === 0 ? (
        <p className="text-gray-500">No active freebies right now — check back soon.</p>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {deals.map((deal) => {
            const sources = sourceMap.get(deal.id) ?? [];
            const ends = fmtDate(deal.endDate);
            return (
              <li
                key={deal.id}
                className="flex flex-col gap-2 rounded-xl border border-gray-200 p-4 transition hover:border-gray-400 dark:border-gray-800"
              >
                <div className="flex items-start justify-between gap-3">
                  <h2 className="font-semibold leading-snug">{deal.title}</h2>
                  <span className="shrink-0 rounded-md bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
                    {deal.platform}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
                  {ends && <span>⏳ ends {ends}</span>}
                  {sources.length > 1 && (
                    <span title="merged from multiple sources">
                      🔗 {sources.map((s) => SOURCE_LABELS[s] ?? s).join(" + ")}
                    </span>
                  )}
                </div>
                <a
                  href={deal.directUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 inline-block w-fit rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700"
                >
                  Claim it →
                </a>
              </li>
            );
          })}
        </ul>
      )}

      <footer className="mt-12 border-t pt-6 text-sm text-gray-400">
        Freebie Finder · <Link href="/preferences" className="underline">manage your alerts</Link>
      </footer>
    </main>
  );
}
