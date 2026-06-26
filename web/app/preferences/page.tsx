import Link from "next/link";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { channels, users } from "@/lib/db/schema";
import { toggleEmailDigest, setPaused, signOutAction } from "@/lib/actions";
import { PushButton } from "./PushButton";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function Preferences() {
  const session = await auth();

  if (!session?.user?.id) {
    return (
      <main className="mx-auto w-full max-w-md flex-1 px-5 py-16">
        <h1 className="text-2xl font-bold">Your alerts</h1>
        <p className="mt-2 text-gray-500">Sign in to manage email digests and web push.</p>
        <Link
          href="/signin"
          className="mt-4 inline-block rounded-lg bg-emerald-600 px-4 py-2 font-medium text-white"
        >
          Sign in
        </Link>
        <p className="mt-8 text-sm text-gray-400">
          No account needed for the shared{" "}
          <Link href="/" className="underline">Telegram / Discord channels</Link>.
        </p>
      </main>
    );
  }

  const userId = session.user.id;
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  const userChannels = await db.select().from(channels).where(eq(channels.userId, userId));
  const emailOn = userChannels.find((c) => c.type === "email")?.enabled ?? false;
  const pushOn = userChannels.find((c) => c.type === "web_push")?.enabled ?? false;
  const paused = user?.paused ?? false;

  return (
    <main className="mx-auto w-full max-w-lg flex-1 px-5 py-12">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Your alerts</h1>
        <form action={signOutAction}>
          <button className="text-sm text-gray-500 underline">Sign out</button>
        </form>
      </div>
      <p className="mt-1 text-sm text-gray-500">{session.user.email}</p>

      <div className="mt-8 flex flex-col gap-6">
        <section className="rounded-xl border p-4 dark:border-gray-800">
          <h2 className="font-semibold">📧 Daily email digest</h2>
          <p className="mt-1 text-sm text-gray-500">One email a day with the new free games.</p>
          <form action={toggleEmailDigest} className="mt-3">
            <input type="hidden" name="enabled" value={(!emailOn).toString()} />
            <button className="rounded-lg border px-4 py-2 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-900">
              {emailOn ? "Turn off email digest" : "Turn on email digest"}
            </button>
          </form>
        </section>

        <section className="rounded-xl border p-4 dark:border-gray-800">
          <h2 className="font-semibold">🔔 Web push</h2>
          <p className="mt-1 text-sm text-gray-500">Instant browser notifications for each new freebie.</p>
          <div className="mt-3">
            <PushButton initiallyEnabled={pushOn} vapidPublicKey={process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? ""} />
          </div>
        </section>

        <section className="rounded-xl border p-4 dark:border-gray-800">
          <h2 className="font-semibold">⏸️ Pause everything</h2>
          <p className="mt-1 text-sm text-gray-500">Stop all your personal alerts without losing settings.</p>
          <form action={setPaused} className="mt-3">
            <input type="hidden" name="paused" value={(!paused).toString()} />
            <button className="rounded-lg border px-4 py-2 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-900">
              {paused ? "Resume alerts" : "Pause all alerts"}
            </button>
          </form>
        </section>
      </div>

      <p className="mt-8 text-sm text-gray-400">
        ← <Link href="/" className="underline">Back to all freebies</Link>
      </p>
    </main>
  );
}
