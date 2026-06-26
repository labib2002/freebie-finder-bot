"use client";

import { useState } from "react";

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function PushButton({
  initiallyEnabled,
  vapidPublicKey,
}: {
  initiallyEnabled: boolean;
  vapidPublicKey: string;
}) {
  const [enabled, setEnabled] = useState(initiallyEnabled);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function enable() {
    setBusy(true);
    setError(null);
    try {
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        throw new Error("Web push isn't supported in this browser.");
      }
      const permission = await Notification.requestPermission();
      if (permission !== "granted") throw new Error("Notification permission denied.");

      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
      });
      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscription }),
      });
      if (!res.ok) throw new Error("Failed to save subscription.");
      setEnabled(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    try {
      await fetch("/api/push/subscribe", { method: "DELETE" });
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      await sub?.unsubscribe();
      setEnabled(false);
    } finally {
      setBusy(false);
    }
  }

  if (!vapidPublicKey) {
    return <p className="text-sm text-gray-400">Web push is not configured on this server.</p>;
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        onClick={enabled ? disable : enable}
        disabled={busy}
        className="w-fit rounded-lg border px-4 py-2 text-sm font-medium hover:bg-gray-50 disabled:opacity-50 dark:hover:bg-gray-900"
      >
        {busy ? "…" : enabled ? "Disable web push" : "Enable web push on this device"}
      </button>
      {error && <span className="text-xs text-red-500">{error}</span>}
    </div>
  );
}
