CREATE TABLE "accounts" (
	"user_id" text NOT NULL,
	"type" text NOT NULL,
	"provider" text NOT NULL,
	"provider_account_id" text NOT NULL,
	"refresh_token" text,
	"access_token" text,
	"expires_at" integer,
	"token_type" text,
	"scope" text,
	"id_token" text,
	"session_state" text,
	CONSTRAINT "accounts_provider_provider_account_id_pk" PRIMARY KEY("provider","provider_account_id")
);
--> statement-breakpoint
CREATE TABLE "channels" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"type" text NOT NULL,
	"address" text,
	"config" jsonb,
	"enabled" boolean DEFAULT true NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deal_sources" (
	"id" serial PRIMARY KEY NOT NULL,
	"deal_id" integer NOT NULL,
	"source" text NOT NULL,
	"source_url" text NOT NULL,
	"raw_item_id" integer
);
--> statement-breakpoint
CREATE TABLE "deals" (
	"id" serial PRIMARY KEY NOT NULL,
	"canonical_key" text NOT NULL,
	"title" text NOT NULL,
	"normalized_title" text NOT NULL,
	"platform" text NOT NULL,
	"deal_type" text,
	"direct_url" text NOT NULL,
	"source_url" text,
	"image_url" text,
	"description" text,
	"end_date" timestamp,
	"is_active" boolean DEFAULT true NOT NULL,
	"first_seen_at" timestamp DEFAULT now() NOT NULL,
	"last_seen_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "deals_canonical_key_unique" UNIQUE("canonical_key")
);
--> statement-breakpoint
CREATE TABLE "deliveries" (
	"id" serial PRIMARY KEY NOT NULL,
	"deal_id" integer NOT NULL,
	"target" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"provider_message_id" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_attempt_at" timestamp,
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "digests" (
	"id" serial PRIMARY KEY NOT NULL,
	"digest_date" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"overview" text,
	"deal_count" integer DEFAULT 0 NOT NULL,
	"sent_at" timestamp,
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "digests_digest_date_unique" UNIQUE("digest_date")
);
--> statement-breakpoint
CREATE TABLE "raw_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"source_item_id" text NOT NULL,
	"raw_title" text NOT NULL,
	"raw_url" text NOT NULL,
	"payload" jsonb,
	"discovered_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"session_token" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"expires" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"email" text NOT NULL,
	"email_verified" timestamp,
	"image" text,
	"paused" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification_tokens" (
	"identifier" text NOT NULL,
	"token" text NOT NULL,
	"expires" timestamp NOT NULL,
	CONSTRAINT "verification_tokens_identifier_token_pk" PRIMARY KEY("identifier","token")
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channels" ADD CONSTRAINT "channels_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_sources" ADD CONSTRAINT "deal_sources_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_sources" ADD CONSTRAINT "deal_sources_raw_item_id_raw_items_id_fk" FOREIGN KEY ("raw_item_id") REFERENCES "public"."raw_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "channels_user_idx" ON "channels" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "deal_sources_deal_source_idx" ON "deal_sources" USING btree ("deal_id","source");--> statement-breakpoint
CREATE INDEX "deals_active_idx" ON "deals" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "deals_first_seen_idx" ON "deals" USING btree ("first_seen_at");--> statement-breakpoint
CREATE UNIQUE INDEX "deliveries_deal_target_idx" ON "deliveries" USING btree ("deal_id","target");--> statement-breakpoint
CREATE INDEX "deliveries_status_idx" ON "deliveries" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "raw_items_source_item_idx" ON "raw_items" USING btree ("source","source_item_id");