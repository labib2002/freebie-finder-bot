# Freebie Finder

Finds free games (Epic, Steam, GOG, Prime Gaming, itch.io and more) across five
sources, dedupes them into one canonical deal each, and announces every deal
exactly once on Telegram, Discord, email, and web push, plus a live website.

**Live site:** https://freebie-finder.vercel.app

## Features

- **Five sources**: Reddit r/FreeGameFindings, SteamDB, Prime Gaming,
  IsThereAnyDeal, and GamerPower. Fetchers run in parallel and fail soft, so
  one blocked or broken source never aborts a run.
- **Cross-source dedup**: every incoming item gets a canonical key. A resolved
  store URL identity wins (the same Steam app id is the same deal:
  `url:steam:12345`); otherwise a normalized title signature merges duplicates
  (bracket tags, stopwords, and platform words stripped, remaining tokens
  sorted). Raw source records stay idempotent per source item id, so re-polls
  never duplicate data.
- **Delivery channels**, each independently optional and enabled by its env
  vars: a public Telegram channel, a Discord webhook, per-user daily email
  digests (Resend), and per-user web push (VAPID). Every send is tracked in a
  deliveries table with capped retries, so each deal goes out once per target.
- **Magic-link auth and per-user preferences**: passwordless sign-in
  (NextAuth v5 + Resend), and a `/preferences` page to toggle email digests
  and web push or pause everything.
- **Public live-deals site**: the homepage lists active deals with platform
  and source labels, no signup needed.
- **Daily digest**: built deterministically from database records; the AI
  (Gemini) writes only the one-sentence overview, and the model id is resolved
  at runtime to the newest available Flash model. Links and deal lists are
  never AI-generated.
- **14-day deal TTL**: deals whose end date has passed, or that have no end
  date and have not been seen for 14 days, are deactivated so the site only
  shows live deals.
- **Blocklist**: megathreads, discussion threads, and recurring roundup posts
  are filtered out before they can become alerts.

## How it works

The pipeline is four layers, each in its own module under
[`web/lib/`](web/lib/):

| Layer | Where | What it does |
|---|---|---|
| Ingestion | `web/lib/sources/` | One fetcher per source, run in parallel with per-source error isolation |
| Canonicalization | `web/lib/normalize.ts` | Pure functions that normalize titles, resolve platform aliases, reduce store URLs to stable identities, and build the canonical key |
| Persistence | `web/lib/db/` | Drizzle ORM + Postgres: raw items, canonical deals, deal-source links, deliveries, digests, users and channels |
| Delivery | `web/lib/delivery/` | Fan-out to all targets with per-channel formatting, per-target delivery records, and capped retries |

Vercel hosts the app; scheduling comes from three GitHub Actions workflows in
[`.github/workflows/`](.github/workflows/):

- **`poll.yml`** (every 30 minutes) posts to `/api/poll` with a `CRON_SECRET`
  bearer token. The app fetches all sources, normalizes, dedupes, stores, and
  delivers the new deals.
- **`reddit.yml`** (every 30 minutes) fetches the r/FreeGameFindings RSS on
  the Actions runner and forwards the raw XML to `/api/ingest-reddit`, because
  Reddit blocks requests from datacenter IPs (including Vercel's) while
  serving GitHub runners normally. The app then parses and ingests it like any
  other source.
- **`digest.yml`** (daily at 22:00 UTC) posts to `/api/digest`, which builds
  and sends the daily digest to the broadcast channels and to each subscribed
  user's email.

## Tech stack

Next.js 16 (App Router), React 19, TypeScript, Drizzle ORM + Postgres (Neon),
NextAuth v5 (magic links via Resend), @google/genai, rss-parser, web-push,
Tailwind CSS 4, vitest, GitHub Actions + Vercel.

## Setup

```bash
cd web
npm install
cp .env.example .env.local   # placeholders and comments for every variable
npm run db:migrate           # Drizzle migrations against DATABASE_URL
npm run dev
```

All configuration is env vars; [`web/.env.example`](web/.env.example)
documents each one. Only `DATABASE_URL`, `AUTH_SECRET`, and `CRON_SECRET` are
required: every delivery channel turns on when its variables are set. For
production, deploy `web/` to Vercel with the same env vars, then add `APP_URL`
and `CRON_SECRET` as GitHub Actions repository secrets so the workflows can
call the deployed endpoints. More detail in [`web/README.md`](web/README.md).

## Testing

```bash
cd web && npm test   # vitest
```

The dedup suite ([`web/lib/normalize.test.ts`](web/lib/normalize.test.ts)) is
seeded with real duplicate pairs: the same giveaways as they appeared on
Reddit and on GamerPower under different titles and URLs, which must collapse
to a single canonical key, plus checks that distinct games stay distinct.

## Background

Freebie Finder began as a Python Telegram bot in 2025 and was rebuilt as this
Next.js app in June 2026. [`REBUILD_PLAN.md`](REBUILD_PLAN.md) has the design
notes behind the rebuild.
