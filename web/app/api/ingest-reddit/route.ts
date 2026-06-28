import { isAuthorizedCron } from "@/lib/cron-auth";
import { parseRedditRss } from "@/lib/sources/reddit";
import { ingestItems } from "@/lib/ingest";
import { deliverDeals } from "@/lib/delivery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Reddit ingestion endpoint. Reddit 403s Vercel's datacenter IPs, so a GitHub
 * Actions job (whose IP Reddit allows) fetches the RSS feed and POSTs the raw
 * XML here. We parse + dedup + deliver it through the same path as every other
 * source. Body: the raw Reddit RSS XML (Content-Type text/xml or text/plain).
 */
async function handle(req: Request) {
  if (!isAuthorizedCron(req)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const xml = await req.text();
  if (!xml || xml.length < 50) {
    return Response.json({ error: "empty or too-short body" }, { status: 400 });
  }

  let items;
  try {
    items = await parseRedditRss(xml);
  } catch (e) {
    return Response.json({ error: `parse failed: ${String(e)}` }, { status: 422 });
  }

  const ingest = await ingestItems(items);
  const delivered = await deliverDeals(ingest.newDeals);

  return Response.json({
    ok: true,
    itemsSeen: ingest.itemsSeen,
    blocked: ingest.blocked,
    newDeals: ingest.newDeals.length,
    newDealTitles: ingest.newDeals.map((d) => d.title),
    delivered,
  });
}

export const POST = handle;
