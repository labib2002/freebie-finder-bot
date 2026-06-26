/** Centralized env access. Throws only when a feature is actually used. */

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export const config = {
  /** Shared secret required to trigger /api/poll and /api/digest. */
  cronSecret: () => requireEnv("CRON_SECRET"),

  appUrl: () => process.env.APP_URL || process.env.NEXTAUTH_URL || "http://localhost:3000",

  telegram: {
    botToken: () => process.env.TELEGRAM_BOT_TOKEN || "",
    /** Public channel id/username everyone can join, e.g. "@freebiefinder". */
    channelId: () => process.env.TELEGRAM_CHANNEL_ID || "",
    enabled: () => !!process.env.TELEGRAM_BOT_TOKEN && !!process.env.TELEGRAM_CHANNEL_ID,
  },

  discord: {
    /** Shared server channel webhook URL. */
    webhookUrl: () => process.env.DISCORD_WEBHOOK_URL || "",
    enabled: () => !!process.env.DISCORD_WEBHOOK_URL,
  },

  email: {
    apiKey: () => process.env.RESEND_API_KEY || "",
    from: () => process.env.EMAIL_FROM || "Freebie Finder <onboarding@resend.dev>",
    enabled: () => !!process.env.RESEND_API_KEY,
  },

  webPush: {
    publicKey: () => process.env.VAPID_PUBLIC_KEY || "",
    privateKey: () => process.env.VAPID_PRIVATE_KEY || "",
    subject: () => process.env.VAPID_SUBJECT || "mailto:freebies@example.com",
    enabled: () => !!process.env.VAPID_PUBLIC_KEY && !!process.env.VAPID_PRIVATE_KEY,
  },

  gemini: {
    apiKey: () => process.env.GEMINI_API_KEY || "",
    /**
     * Optional manual pin. When unset, digest.ts auto-resolves the newest
     * free Flash model at runtime via ListModels (see resolveLatestFlashModel),
     * so we never hardcode a version that Google may rename or retire.
     */
    modelOverride: () => process.env.SUMMARY_MODEL || "",
    enabled: () => !!process.env.GEMINI_API_KEY,
  },
};
