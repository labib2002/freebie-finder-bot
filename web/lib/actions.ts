"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { auth, signIn, signOut } from "@/auth";
import { db } from "./db";
import { channels, users, type ChannelType } from "./db/schema";

async function requireUser() {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not authenticated");
  return { id: session.user.id, email: session.user.email ?? "" };
}

export async function startSignIn(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  if (!email) return;
  await signIn("resend", { email, redirectTo: "/preferences" });
}

export async function signOutAction() {
  await signOut({ redirectTo: "/" });
}

/** Enable/disable a per-user channel. Creates the row on first enable. */
export async function setChannel(type: ChannelType, enabled: boolean, address?: string) {
  const user = await requireUser();
  const existing = (
    await db
      .select()
      .from(channels)
      .where(and(eq(channels.userId, user.id), eq(channels.type, type)))
      .limit(1)
  )[0];

  if (existing) {
    await db
      .update(channels)
      .set({ enabled, address: address ?? existing.address })
      .where(eq(channels.id, existing.id));
  } else {
    await db.insert(channels).values({
      userId: user.id,
      type,
      address: address ?? (type === "email" ? user.email : null),
      enabled,
      verified: type === "email",
    });
  }
  revalidatePath("/preferences");
}

export async function toggleEmailDigest(formData: FormData) {
  await setChannel("email", formData.get("enabled") === "true");
}

export async function setPaused(formData: FormData) {
  const user = await requireUser();
  await db.update(users).set({ paused: formData.get("paused") === "true" }).where(eq(users.id, user.id));
  revalidatePath("/preferences");
}
