import { config } from "./config";

/**
 * Guard for cron-triggered endpoints. Accepts either:
 *   Authorization: Bearer <CRON_SECRET>   (Vercel Cron sends this automatically)
 *   x-cron-secret: <CRON_SECRET>
 */
export function isAuthorizedCron(req: Request): boolean {
  let secret: string;
  try {
    secret = config.cronSecret();
  } catch {
    return false; // not configured => deny
  }
  const auth = req.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true;
  if (req.headers.get("x-cron-secret") === secret) return true;
  return false;
}
