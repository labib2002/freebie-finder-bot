import { and, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { channels } from "@/lib/db/schema";

export const runtime = "nodejs";

/** Save (or refresh) the current user's web push subscription. */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "unauthorized" }, { status: 401 });

  const { subscription } = (await req.json()) as { subscription?: unknown };
  if (!subscription) return Response.json({ error: "missing subscription" }, { status: 400 });

  const existing = (
    await db
      .select()
      .from(channels)
      .where(and(eq(channels.userId, session.user.id), eq(channels.type, "web_push")))
      .limit(1)
  )[0];

  if (existing) {
    await db
      .update(channels)
      .set({ config: subscription, enabled: true, verified: true })
      .where(eq(channels.id, existing.id));
  } else {
    await db.insert(channels).values({
      userId: session.user.id,
      type: "web_push",
      config: subscription,
      enabled: true,
      verified: true,
    });
  }
  return Response.json({ ok: true });
}

/** Disable the current user's web push subscription. */
export async function DELETE() {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "unauthorized" }, { status: 401 });
  await db
    .update(channels)
    .set({ enabled: false })
    .where(and(eq(channels.userId, session.user.id), eq(channels.type, "web_push")));
  return Response.json({ ok: true });
}
