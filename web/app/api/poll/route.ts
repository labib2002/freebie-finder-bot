import { isAuthorizedCron } from "@/lib/cron-auth";
import { runIngest } from "@/lib/ingest";
import { deliverDeals, retryFailedDeliveries } from "@/lib/delivery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Real-time pass: fetch sources → dedup → store → deliver new deals → retry failures. */
async function handle(req: Request) {
  if (!isAuthorizedCron(req)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const started = Date.now();
  const ingest = await runIngest();
  const delivered = await deliverDeals(ingest.newDeals);
  const retried = await retryFailedDeliveries();

  return Response.json({
    ok: true,
    durationMs: Date.now() - started,
    sources: ingest.sources,
    itemsSeen: ingest.itemsSeen,
    blocked: ingest.blocked,
    newDeals: ingest.newDeals.length,
    newDealTitles: ingest.newDeals.map((d) => d.title),
    deactivated: ingest.deactivated,
    delivered,
    retried,
  });
}

export const POST = handle;
// GET allowed so Vercel Cron (which issues GET) can trigger it too.
export const GET = handle;
