import {
  pgTable,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  serial,
  primaryKey,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

/* ------------------------------------------------------------------ *
 * Auth.js (next-auth) tables — shape required by @auth/drizzle-adapter.
 * `users` is extended with app fields (paused, createdAt).
 * ------------------------------------------------------------------ */

export const users = pgTable("users", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name"),
  email: text("email").notNull().unique(),
  emailVerified: timestamp("email_verified", { mode: "date" }),
  image: text("image"),
  // app-specific:
  paused: boolean("paused").notNull().default(false),
  createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
});

export const accounts = pgTable(
  "accounts",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (t) => [primaryKey({ columns: [t.provider, t.providerAccountId] })],
);

export const sessions = pgTable("sessions", {
  sessionToken: text("session_token").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { mode: "date" }).notNull(),
});

export const verificationTokens = pgTable(
  "verification_tokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { mode: "date" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.identifier, t.token] })],
);

/* ------------------------------------------------------------------ *
 * Delivery channels — per-user notification endpoints.
 * Shared Telegram channel / Discord webhook are env-config globals,
 * NOT rows here. These rows are the per-user opt-ins (email, web push,
 * personal telegram/discord DM).
 * ------------------------------------------------------------------ */

export type ChannelType = "email" | "web_push" | "telegram_dm" | "discord_dm";

export const channels = pgTable(
  "channels",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").$type<ChannelType>().notNull(),
    /** email address / telegram chat id / discord user id (web_push uses `config`). */
    address: text("address"),
    /** web push subscription JSON, or any channel-specific config. */
    config: jsonb("config"),
    enabled: boolean("enabled").notNull().default(true),
    verified: boolean("verified").notNull().default(false),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => [index("channels_user_idx").on(t.userId)],
);

/* ------------------------------------------------------------------ *
 * Ingestion: raw_items = exactly what each source produced.
 * ------------------------------------------------------------------ */

export const rawItems = pgTable(
  "raw_items",
  {
    id: serial("id").primaryKey(),
    source: text("source").notNull(),
    sourceItemId: text("source_item_id").notNull(),
    rawTitle: text("raw_title").notNull(),
    rawUrl: text("raw_url").notNull(),
    payload: jsonb("payload"),
    discoveredAt: timestamp("discovered_at", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("raw_items_source_item_idx").on(t.source, t.sourceItemId)],
);

/* ------------------------------------------------------------------ *
 * Canonicalization: one row per real-world deal, merged across sources.
 * ------------------------------------------------------------------ */

export const deals = pgTable(
  "deals",
  {
    id: serial("id").primaryKey(),
    canonicalKey: text("canonical_key").notNull().unique(),
    title: text("title").notNull(),
    normalizedTitle: text("normalized_title").notNull(),
    platform: text("platform").notNull(),
    dealType: text("deal_type"),
    /** best direct claim/store link we could resolve. */
    directUrl: text("direct_url").notNull(),
    /** original aggregator link (reddit thread / gamerpower landing). */
    sourceUrl: text("source_url"),
    imageUrl: text("image_url"),
    description: text("description"),
    endDate: timestamp("end_date", { mode: "date" }),
    isActive: boolean("is_active").notNull().default(true),
    firstSeenAt: timestamp("first_seen_at", { mode: "date" }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    index("deals_active_idx").on(t.isActive),
    index("deals_first_seen_idx").on(t.firstSeenAt),
  ],
);

export const dealSources = pgTable(
  "deal_sources",
  {
    id: serial("id").primaryKey(),
    dealId: integer("deal_id")
      .notNull()
      .references(() => deals.id, { onDelete: "cascade" }),
    source: text("source").notNull(),
    sourceUrl: text("source_url").notNull(),
    rawItemId: integer("raw_item_id").references(() => rawItems.id, { onDelete: "set null" }),
  },
  (t) => [uniqueIndex("deal_sources_deal_source_idx").on(t.dealId, t.source)],
);

/* ------------------------------------------------------------------ *
 * Delivery tracking — one row per (deal, target). Enables retry without
 * ever re-sending a deal that already succeeded.
 * ------------------------------------------------------------------ */

export type DeliveryStatus = "pending" | "sent" | "failed";

export const deliveries = pgTable(
  "deliveries",
  {
    id: serial("id").primaryKey(),
    dealId: integer("deal_id")
      .notNull()
      .references(() => deals.id, { onDelete: "cascade" }),
    /** "telegram:channel", "discord:webhook", or "channel:<id>" for per-user. */
    target: text("target").notNull(),
    status: text("status").$type<DeliveryStatus>().notNull().default("pending"),
    providerMessageId: text("provider_message_id"),
    attempts: integer("attempts").notNull().default(0),
    lastAttemptAt: timestamp("last_attempt_at", { mode: "date" }),
    error: text("error"),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("deliveries_deal_target_idx").on(t.dealId, t.target),
    index("deliveries_status_idx").on(t.status),
  ],
);

/* ------------------------------------------------------------------ *
 * Daily digest jobs.
 * ------------------------------------------------------------------ */

export const digests = pgTable("digests", {
  id: serial("id").primaryKey(),
  digestDate: text("digest_date").notNull().unique(), // YYYY-MM-DD
  status: text("status").notNull().default("pending"),
  overview: text("overview"),
  dealCount: integer("deal_count").notNull().default(0),
  sentAt: timestamp("sent_at", { mode: "date" }),
  error: text("error"),
  createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
});

export type Deal = typeof deals.$inferSelect;
export type NewDeal = typeof deals.$inferInsert;
export type RawItem = typeof rawItems.$inferSelect;
export type Channel = typeof channels.$inferSelect;
