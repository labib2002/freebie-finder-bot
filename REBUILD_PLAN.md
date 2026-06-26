# Freebie Finder Rebuild Plan

## Purpose

This document describes how to rebuild Freebie Finder into a cleaner, more reliable system.

The goal is not to patch the current architecture further. The goal is to replace the fragile parts:

- text-file state handoff
- URL-only deduplication
- Git as runtime storage
- weak database schema
- brittle summary generation
- source-specific delivery inconsistencies

## Current Problems

The current project works as a lightweight notifier, but it has structural limits:

- `freebies.db` stores only a single `url` column
- `daily_deals.txt` duplicates DB state and acts as a fragile summary queue
- the same deal can arrive from multiple sources under different URLs
- Reddit links often point to the Reddit thread instead of the actual claim page
- workflow state is committed back into Git, which pollutes history
- the summary system depends on AI output formatting instead of a stable internal digest model
- filtering for spam, megathreads, and recurring meta posts is very limited

## Rebuild Goals

The rebuild should provide:

1. One source of truth for state
2. Deterministic ingestion and deduplication
3. Direct deal links whenever possible
4. Reliable Telegram delivery with retries and delivery status
5. Daily summaries generated from database records, not text files
6. Clear separation between ingestion, normalization, storage, and delivery
7. Testable components

## Proposed Architecture

### Services

The rebuilt project should have four logical layers:

1. Ingestion
   - Poll RSS feeds and APIs
   - Scrape outbound links when needed
   - Normalize raw source items

2. Canonicalization
   - Resolve direct deal URLs
   - Normalize titles and platforms
   - Detect duplicates across sources

3. Persistence
   - Store raw discoveries
   - Store canonical deals
   - Store delivery and summary state

4. Delivery
   - Send real-time Telegram alerts
   - Build and send daily summaries
   - Retry failures safely

### Recommended Runtime Layout

- `app/config.py`
- `app/db.py`
- `app/models.py`
- `app/sources/reddit.py`
- `app/sources/gamerpower.py`
- `app/sources/primegaming.py`
- `app/sources/steamdb.py`
- `app/sources/itad.py`
- `app/normalization/titles.py`
- `app/normalization/links.py`
- `app/normalization/platforms.py`
- `app/delivery/telegram.py`
- `app/delivery/summaries.py`
- `app/jobs/run_realtime.py`
- `app/jobs/run_summary.py`

## Database Design

### Recommended Tables

#### `raw_items`

Stores exactly what each source produced.

- `id`
- `source`
- `source_item_id`
- `raw_title`
- `raw_url`
- `raw_payload_json`
- `discovered_at`
- `fetched_at`

#### `canonical_deals`

Stores the normalized deal record.

- `id`
- `canonical_key`
- `normalized_title`
- `direct_url`
- `platform`
- `deal_type`
- `is_active`
- `first_seen_at`
- `last_seen_at`
- `summary_group_key`

#### `deal_sources`

Maps a canonical deal to one or more source records.

- `id`
- `canonical_deal_id`
- `raw_item_id`
- `source`
- `source_url`
- `priority`

#### `deliveries`

Tracks real-time Telegram sends.

- `id`
- `canonical_deal_id`
- `channel`
- `message_type`
- `status`
- `telegram_message_id`
- `attempt_count`
- `last_attempt_at`
- `delivered_at`
- `error_text`

#### `digests`

Tracks daily summary jobs.

- `id`
- `digest_date`
- `status`
- `overview_text`
- `deal_count`
- `message_count`
- `created_at`
- `sent_at`
- `error_text`

#### `digest_items`

Connects canonical deals to a digest.

- `id`
- `digest_id`
- `canonical_deal_id`

#### `filters`

Optional table for configurable blocklists and rules.

- `id`
- `rule_type`
- `pattern`
- `is_enabled`
- `notes`

## Deduplication Strategy

### Current Problem

The current system deduplicates only by raw URL. That misses:

- Reddit thread vs direct store page
- GamerPower vs Reddit for the same giveaway
- repeated recurring promos with slightly different links

### New Strategy

Each incoming item should produce:

1. Raw source URL
2. Direct resolved URL, if available
3. Normalized title
4. Normalized platform
5. Canonical key

Suggested canonical key priority:

1. Direct claim/store URL after normalization
2. Stable deal identifier from the source, if available
3. Normalized title + platform + date bucket fallback

### Title Normalization Rules

- lowercase
- strip bracket prefixes like `[Steam]`
- remove noise words like `giveaway`, `free`, `key giveaway`
- normalize punctuation and whitespace
- normalize platform aliases like `Epic Games Mobile` vs `Epic Games`

## Link Resolution Strategy

### Reddit

Reddit should not be the final user-facing link if a direct claim page can be extracted.

Expected flow:

1. RSS gives Reddit thread URL
2. Fetch thread page
3. Extract outbound deal link
4. Store both Reddit source URL and direct deal URL
5. Deliver the direct deal URL to Telegram

### GamerPower

Prefer the final claim/store link when possible. If GamerPower only provides a landing page, keep both:

- source link
- resolved final link

## Summary Strategy

### Principle

The daily summary should be deterministic before AI touches it.

The AI should enhance the digest, not define its structure.

### New Flow

1. Query deals delivered in the last 24 hours and not yet summarized
2. Build a deterministic deal list from DB records
3. Ask the model for:
   - one overview sentence
   - optional title polish
   - optional categorization
4. Build the final Telegram messages locally
5. Mark included deals as summarized only after send success

### Summary Rules

- never depend on AI to preserve URLs exactly
- never depend on AI to decide whether a deal exists
- always chunk messages by Telegram size limit
- always log digest status and included deal IDs

## Delivery Strategy

### Real-Time Alerts

For each canonical deal:

1. Check whether it was already delivered
2. Generate a platform-aware message template
3. Send via Telegram
4. Persist delivery success or failure
5. Retry failures later without losing the deal

### Retry Policy

- retry on transient network and Telegram API failures
- do not mark delivered until Telegram confirms success
- cap retries with exponential backoff

## Storage and Deployment

### Recommended Storage

Best option:

- Postgres or hosted Postgres-like service

Simple option:

- SQLite outside the repo, not committed to Git

### Recommended Deployment

Acceptable:

- GitHub Actions for cron jobs

Better:

- a small always-on worker or scheduled container job

If GitHub Actions stays in use:

- keep secrets in Actions secrets only
- never use Git as the database
- upload logs or artifacts only when needed

## Suggested Tech Choices

### Keep

- Python
- `python-telegram-bot`
- feed polling for RSS

### Replace or Improve

- replace file-based summary handoff with DB state
- keep `google-genai` only for lightweight summary enhancement
- add `httpx` or `aiohttp` for async HTTP usage
- add migrations with `alembic` if moving to SQLAlchemy

## Migration Plan

### Phase 1: Foundation

- create new app layout
- define DB schema
- add migrations
- move config handling into one module

### Phase 2: Ingestion

- rebuild source fetchers
- normalize titles and URLs
- store both raw items and canonical deals

### Phase 3: Delivery

- rebuild Telegram sender
- add delivery records and retry logic
- add platform-aware message templates

### Phase 4: Summaries

- build deterministic digest generator
- layer AI overview generation on top
- chunk messages safely

### Phase 5: Migration and Cutover

- import historical URLs from current DB
- optionally import historical titles from `daily_deals.txt`
- dry-run realtime and summary flows
- switch Actions to the new entry points

## Minimal First Version

If a full rebuild is too much at once, the smallest worthwhile rebuild would be:

- one proper DB schema
- direct link resolution for Reddit
- canonical deal table
- real-time delivery status table
- summary jobs based on DB queries instead of `daily_deals.txt`

That would remove most of the current architectural risk without requiring a large product rewrite.

## Success Criteria

The rebuild is successful when:

- no text file is used as a workflow queue
- no runtime state is committed to Git
- the same giveaway from multiple sources creates one canonical deal
- Reddit-origin deals deliver direct store links where possible
- failed Telegram sends can be retried without losing deals
- daily summaries are generated from DB records and sent reliably
- core normalization and dedup logic are covered by tests

## Recommended Next Step

Create the rebuild in a separate branch or a new folder structure alongside the current project, then cut over source by source.

This reduces risk and lets the current notifier continue running while the new architecture is built and tested.
