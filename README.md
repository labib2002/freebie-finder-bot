# Freebie Finder

Finds free games (Epic, Steam, GOG, Prime Gaming, itch.io, …) across five
sources, de-duplicates them into one canonical deal each, and announces every
deal once — on Telegram, Discord, email, and web push — plus a live website.

**Live site:** https://freebie-finder.vercel.app

## The two eras of this repo

This repository contains one project built twice, and the history shows both.

### v1 — Python bot (July 2025)

A single-file Python notifier (`bot_v2.py`, later split into
`bot_realtime.py` + `bot_summarizer.py`): poll RSS/APIs every 30 minutes from
a GitHub Actions cron, dedup by exact URL in a committed SQLite file, post to
one Telegram chat, and queue a daily summary through `daily_deals.txt`.

It then ran **unattended for ~11.5 months** (July 10, 2025 → June 27, 2026).
The fossil record is right in the log: 813 automated
"Update state files (automated)" / "Clear daily deals log" commits, because
v1 used *git itself* as its database. It worked — and its flaws accumulated:
the same game alerted 2-3× under different URLs, Reddit links pointed at
threads instead of claim pages, and runtime state polluted history every half
hour.

### v2 — TypeScript / Next.js rebuild (June 2026)

[`REBUILD_PLAN.md`](REBUILD_PLAN.md) documents the redesign; the
[cut-over commit](../../commit/8051691) replaced the Python scripts with the
Next.js 16 app in [`web/`](web/). The plan's four layers map directly onto
the code:

| Layer | Where | What it does |
|---|---|---|
| Ingestion | `web/lib/sources/` | Fetchers for Reddit (r/FreeGameFindings), GamerPower, Prime Gaming, SteamDB, IsThereAnyDeal |
| Canonicalization | `web/lib/normalize.ts` | Pure functions: strip noise words/brackets, resolve platform aliases, build a **canonical key** from the resolved store link + normalized title signature |
| Persistence | `web/lib/db/` (Drizzle + Postgres/Neon) | Raw discoveries, canonical deals, delivery/digest state, users & subscriptions |
| Delivery | `web/lib/delivery/` | Fan-out with per-channel formatting and delivery tracking |

The canonical-key dedup is the core fix: validated against the 1,387-row
legacy database, ~65% of GamerPower deals also arrived via Reddit under a
different URL — v2 merges them into a single alert.

## How it runs in production

Vercel hosts the app; GitHub Actions provides the scheduling (Vercel Hobby
cron is daily-only, Actions is free at 30-minute cadence). Three workflows in
[`.github/workflows/`](.github/workflows/):

- **`poll.yml`** (every 30 min) — `POST /api/poll` with a `CRON_SECRET`
  bearer token: fetch sources → normalize → dedup → store → deliver.
- **`digest.yml`** (daily 22:00 UTC) — `POST /api/digest`: builds a
  deterministic digest from DB records, then asks Gemini for a short
  overview (the model id is auto-resolved to the newest free Flash model via
  ListModels, so Google renames never break it).
- **`reddit.yml`** (every 30 min) — the fetch-and-forward workaround:
  Reddit 403s requests from Vercel's datacenter IPs but serves GitHub
  Actions runners fine, so the runner fetches the subreddit RSS and POSTs
  the raw XML to `/api/ingest-reddit`, where it is parsed and ingested like
  any other source.

Delivery channels (each independently optional, enabled by its env vars):

- **Telegram** — bot posts to a public channel anyone can join
- **Discord** — channel webhook
- **Email** — per-user daily digests via Resend
- **Web push** — per-user browser notifications (VAPID)
- **Website** — live deal list without signup; `/preferences` behind
  passwordless **magic-link auth** (NextAuth v5 + Resend + Drizzle adapter)

## Setup

Full details live in [`web/README.md`](web/README.md); the short version:

```bash
cd web
npm install
cp .env.example .env.local     # fill in — see comments in the file
npm run db:migrate             # Drizzle migrations against DATABASE_URL
npx tsx scripts/migrate-legacy.ts   # optional: seed v1 URLs so old deals aren't re-announced
npm run dev
```

Deploy to Vercel, set the same env vars there, then add `APP_URL` and
`CRON_SECRET` as GitHub Actions repository secrets so the workflows can
trigger the deployed endpoints. Secrets exist only in env vars / Actions
secrets — `web/.env.example` is a placeholder template and nothing sensitive
is committed (v1 also kept its tokens in Actions secrets; its gitignored
`config.ini` never entered history).

## Tests

```bash
cd web && npm test   # vitest
```

The dedup engine (`web/lib/normalize.test.ts`) is unit-tested against real
duplicate pairs taken from the v1 database — the exact failure cases the
rebuild had to fix.

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · Drizzle ORM + Postgres
(Neon) · NextAuth v5 (magic links via Resend) · @google/genai · rss-parser ·
web-push · Tailwind CSS 4 · vitest · GitHub Actions + Vercel
