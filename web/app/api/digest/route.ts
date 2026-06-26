import { isAuthorizedCron } from "@/lib/cron-auth";
import { runDigest } from "@/lib/digest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function handle(req: Request) {
  if (!isAuthorizedCron(req)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const result = await runDigest();
  return Response.json({ ok: true, ...result });
}

export const POST = handle;
export const GET = handle;
