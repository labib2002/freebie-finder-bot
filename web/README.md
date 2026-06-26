# Freebie Finder v2

Free-game aggregator + multi-channel notifier. Rebuilt from the original Python
scripts to fix duplicate alerts, support multiple users, and deliver across
Telegram, Discord, email, and web push.

## What changed vs the old bot

| Old | New |
| --- | --- |
| Dedup by exact URL → same game 3× | **Cross-source dedup** by resolved store link + normalized title (one alert per game) |
| One hardcoded Telegram chat | **Multi-user**: shared Telegram/Discord channels + per-user email & web push |
| Telegram only | **Telegram + Discord + email + web push + website** |
| State committed to git every 30 min | **Postgres** (Neon); no runtime state in git |
| `daily_deals.txt` queue | Digest built deterministically from DB records |

## Architecture

```
GitHub Actions cron (*/30) ──> POST /api/poll   ──> sources → dedup → Postgres → fan-out delivery
GitHub Actions cron (daily) ──> POST /api/digest ──> deterministic digest + AI overview → channels
Next.js website ──> live deal list (no signup) + /preferences (magic-link auth)
```

Core logic lives in [`lib/`](lib/): `normalize.ts` (dedup), `sources/` (fetchers),
`ingest.ts` (pipeline), `delivery/` (channels + retry), `digest.ts`.

## Setup

1. **Install**: `npm install`
2. **Database**: create a Neon (or any) Postgres, set `DATABASE_URL` in `.env.local`.
3. **Env**: copy `.env.example` → `.env.local` and fill in. Generate keys:
   - `npx auth secret` → `AUTH_SECRET`
   - `npx web-push generate-vapid-keys` → VAPID keys
   - a random string → `CRON_SECRET`
4. **Migrate schema**: `npm run db:migrate`
5. **Seed history (no re-blast)**: `npx tsx scripts/migrate-legacy.ts`
6. **Run**: `npm run dev`, or deploy to Vercel.
7. **Cron**: add repo secrets `APP_URL` + `CRON_SECRET`; the workflows in
   `.github/workflows/poll.yml` + `digest.yml` drive the schedule.

## Channels

- **Telegram**: create a bot (@BotFather), make it admin of a public channel; set
  `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHANNEL_ID`. Friends just join the channel link.
- **Discord**: create a channel webhook; set `DISCORD_WEBHOOK_URL`.
- **Email / Web push**: per-user, opted into on `/preferences`.

## Test

```
npm test          # dedup engine unit tests (real legacy duplicate pairs)
```
