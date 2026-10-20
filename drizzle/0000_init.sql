-- pg_trgm powers Chinese substring search (gin_trgm_ops indexes below)
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"count" integer NOT NULL,
	"last_request" bigint NOT NULL,
	CONSTRAINT "rate_limits_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	"impersonated_by" text,
	CONSTRAINT "sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"role" text DEFAULT 'user' NOT NULL,
	"banned" boolean DEFAULT false NOT NULL,
	"ban_reason" text,
	"ban_expires" timestamp with time zone,
	"submit_mode" text DEFAULT 'review' NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verifications" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "artist_aliases" (
	"artist_id" integer NOT NULL,
	"alias" text NOT NULL,
	CONSTRAINT "artist_aliases_artist_id_alias_pk" PRIMARY KEY("artist_id","alias"),
	CONSTRAINT "artist_aliases_alias_key" UNIQUE("alias")
);
--> statement-breakpoint
CREATE TABLE "artists" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "artists_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"links" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"pack_count" integer DEFAULT 0 NOT NULL,
	"legacy_slug" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "artists_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "character_aliases" (
	"character_id" integer NOT NULL,
	"alias" text NOT NULL,
	CONSTRAINT "character_aliases_character_id_alias_pk" PRIMARY KEY("character_id","alias"),
	CONSTRAINT "character_aliases_alias_key" UNIQUE("alias")
);
--> statement-breakpoint
CREATE TABLE "characters" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "characters_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"theme_color" text,
	"avatar_emoji_id" text,
	"sort" integer DEFAULT 0 NOT NULL,
	"pack_count" integer DEFAULT 0 NOT NULL,
	"emoji_count" integer DEFAULT 0 NOT NULL,
	"legacy_slug" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "characters_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "collection_packs" (
	"collection_id" integer NOT NULL,
	"pack_id" integer NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "collection_packs_collection_id_pack_id_pk" PRIMARY KEY("collection_id","pack_id")
);
--> statement-breakpoint
CREATE TABLE "collections" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "collections_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"cover_emoji_id" text,
	"sort" integer DEFAULT 0 NOT NULL,
	"published" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "collections_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "emoji_characters" (
	"emoji_id" text NOT NULL,
	"character_id" integer NOT NULL,
	CONSTRAINT "emoji_characters_emoji_id_character_id_pk" PRIMARY KEY("emoji_id","character_id")
);
--> statement-breakpoint
CREATE TABLE "emojis" (
	"id" text PRIMARY KEY NOT NULL,
	"pack_id" integer NOT NULL,
	"storage_pack_key" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"original_key" text NOT NULL,
	"format" text NOT NULL,
	"mime" text NOT NULL,
	"bytes" integer NOT NULL,
	"width" integer,
	"height" integer,
	"frames" integer DEFAULT 1 NOT NULL,
	"duration_ms" integer,
	"poster_frame" integer DEFAULT 0 NOT NULL,
	"sha256" text,
	"dominant_color" text,
	"variant_rev" integer DEFAULT 1 NOT NULL,
	"p240_bytes" integer,
	"a160_bytes" integer,
	"full_bytes" integer,
	"derived_ready" boolean DEFAULT false NOT NULL,
	"full_ready" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pack_artists" (
	"pack_id" integer NOT NULL,
	"artist_id" integer NOT NULL,
	"role" text DEFAULT 'artist' NOT NULL,
	CONSTRAINT "pack_artists_pack_id_artist_id_role_pk" PRIMARY KEY("pack_id","artist_id","role")
);
--> statement-breakpoint
CREATE TABLE "pack_characters" (
	"pack_id" integer NOT NULL,
	"character_id" integer NOT NULL,
	CONSTRAINT "pack_characters_pack_id_character_id_pk" PRIMARY KEY("pack_id","character_id")
);
--> statement-breakpoint
CREATE TABLE "pack_tags" (
	"pack_id" integer NOT NULL,
	"tag_id" integer NOT NULL,
	CONSTRAINT "pack_tags_pack_id_tag_id_pk" PRIMARY KEY("pack_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "packs" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "packs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"pack_key" text NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"excerpt" text,
	"description_md" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"owner_id" text,
	"source_kind" text DEFAULT 'community' NOT NULL,
	"license" text DEFAULT 'unknown' NOT NULL,
	"downloadable" boolean DEFAULT false NOT NULL,
	"kind" text DEFAULT 'static' NOT NULL,
	"pin_level" integer DEFAULT 0 NOT NULL,
	"memorial" boolean DEFAULT false NOT NULL,
	"commissioner" text,
	"credits_text" text,
	"source_url" text,
	"legacy_post_name" text,
	"cover_emoji_id" text,
	"emoji_count" integer DEFAULT 0 NOT NULL,
	"download_count" bigint DEFAULT 0 NOT NULL,
	"favorite_count" integer DEFAULT 0 NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "packs_pack_key_unique" UNIQUE("pack_key"),
	CONSTRAINT "packs_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "tags_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"dimension" text DEFAULT 'custom' NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tags_dimension_slug_key" UNIQUE("dimension","slug")
);
--> statement-breakpoint
CREATE TABLE "batch_lists" (
	"user_id" text PRIMARY KEY NOT NULL,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "comment_reactions" (
	"comment_id" bigint NOT NULL,
	"reactor_key" text NOT NULL,
	"reaction_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "comment_reactions_comment_id_reactor_key_reaction_key_pk" PRIMARY KEY("comment_id","reactor_key","reaction_key")
);
--> statement-breakpoint
CREATE TABLE "comment_reports" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "comment_reports_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"comment_id" bigint NOT NULL,
	"reporter_key" text NOT NULL,
	"reason" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "comment_reports_once_key" UNIQUE("comment_id","reporter_key")
);
--> statement-breakpoint
CREATE TABLE "comments" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "comments_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"thread_type" text NOT NULL,
	"thread_id" text NOT NULL,
	"parent_id" bigint,
	"root_id" bigint,
	"author_id" text,
	"guest_name" text,
	"guest_email_hash" text,
	"body_src" text NOT NULL,
	"sticker_ids" text[] DEFAULT '{}' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"staff_badge" text,
	"edited_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"ip_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "favorite_folders" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "favorite_folders_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "favorites" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "favorites_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" text NOT NULL,
	"folder_id" integer,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "favorites_user_target_key" UNIQUE("user_id","folder_id","target_type","target_id")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "notifications_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"pack_id" integer NOT NULL,
	"submitter_id" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"declaration" jsonb,
	"base_updated_at" timestamp with time zone,
	"reviewer_id" text,
	"review_note" text,
	"submitted_at" timestamp with time zone,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "upload_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submission_id" uuid,
	"pack_id" integer NOT NULL,
	"uploader_id" text NOT NULL,
	"tmp_key" text NOT NULL,
	"filename" text NOT NULL,
	"bytes" integer NOT NULL,
	"mime" text NOT NULL,
	"status" text DEFAULT 'signed' NOT NULL,
	"error" text,
	"emoji_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "upload_items_tmp_key_unique" UNIQUE("tmp_key")
);
--> statement-breakpoint
CREATE TABLE "blocked_sources" (
	"subject" text PRIMARY KEY NOT NULL,
	"mode" text DEFAULT 'watch' NOT NULL,
	"reason" text,
	"until" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "download_counters" (
	"subject" text NOT NULL,
	"day" date NOT NULL,
	"kind" text NOT NULL,
	"n" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "download_counters_subject_day_kind_pk" PRIMARY KEY("subject","day","kind")
);
--> statement-breakpoint
CREATE TABLE "download_stats_daily" (
	"day" date NOT NULL,
	"kind" text NOT NULL,
	"subject_count" integer DEFAULT 0 NOT NULL,
	"n" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "download_stats_daily_day_kind_pk" PRIMARY KEY("day","kind")
);
--> statement-breakpoint
CREATE TABLE "rate_windows" (
	"subject" text NOT NULL,
	"bucket" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"n" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "rate_windows_subject_bucket_window_start_pk" PRIMARY KEY("subject","bucket","window_start")
);
--> statement-breakpoint
CREATE TABLE "zip_artifacts" (
	"pack_id" integer PRIMARY KEY NOT NULL,
	"content_hash" text NOT NULL,
	"object_key" text NOT NULL,
	"bytes" bigint NOT NULL,
	"built_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "audit_logs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"actor_id" text,
	"actor_role" text,
	"impersonated_by" text,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"diff" jsonb,
	"ip_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "redirects" (
	"from_path" text PRIMARY KEY NOT NULL,
	"to_path" text NOT NULL,
	"code" integer DEFAULT 301 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "site_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artist_aliases" ADD CONSTRAINT "artist_aliases_artist_id_artists_id_fk" FOREIGN KEY ("artist_id") REFERENCES "public"."artists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_aliases" ADD CONSTRAINT "character_aliases_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_packs" ADD CONSTRAINT "collection_packs_collection_id_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_packs" ADD CONSTRAINT "collection_packs_pack_id_packs_id_fk" FOREIGN KEY ("pack_id") REFERENCES "public"."packs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emoji_characters" ADD CONSTRAINT "emoji_characters_emoji_id_emojis_id_fk" FOREIGN KEY ("emoji_id") REFERENCES "public"."emojis"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emoji_characters" ADD CONSTRAINT "emoji_characters_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emojis" ADD CONSTRAINT "emojis_pack_id_packs_id_fk" FOREIGN KEY ("pack_id") REFERENCES "public"."packs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pack_artists" ADD CONSTRAINT "pack_artists_pack_id_packs_id_fk" FOREIGN KEY ("pack_id") REFERENCES "public"."packs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pack_artists" ADD CONSTRAINT "pack_artists_artist_id_artists_id_fk" FOREIGN KEY ("artist_id") REFERENCES "public"."artists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pack_characters" ADD CONSTRAINT "pack_characters_pack_id_packs_id_fk" FOREIGN KEY ("pack_id") REFERENCES "public"."packs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pack_characters" ADD CONSTRAINT "pack_characters_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pack_tags" ADD CONSTRAINT "pack_tags_pack_id_packs_id_fk" FOREIGN KEY ("pack_id") REFERENCES "public"."packs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pack_tags" ADD CONSTRAINT "pack_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packs" ADD CONSTRAINT "packs_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_lists" ADD CONSTRAINT "batch_lists_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_reactions" ADD CONSTRAINT "comment_reactions_comment_id_comments_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_reports" ADD CONSTRAINT "comment_reports_comment_id_comments_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "favorite_folders" ADD CONSTRAINT "favorite_folders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_folder_id_favorite_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."favorite_folders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_pack_id_packs_id_fk" FOREIGN KEY ("pack_id") REFERENCES "public"."packs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_submitter_id_users_id_fk" FOREIGN KEY ("submitter_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_items" ADD CONSTRAINT "upload_items_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_items" ADD CONSTRAINT "upload_items_pack_id_packs_id_fk" FOREIGN KEY ("pack_id") REFERENCES "public"."packs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_items" ADD CONSTRAINT "upload_items_uploader_id_users_id_fk" FOREIGN KEY ("uploader_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zip_artifacts" ADD CONSTRAINT "zip_artifacts_pack_id_packs_id_fk" FOREIGN KEY ("pack_id") REFERENCES "public"."packs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accounts_user_idx" ON "accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "users_role_idx" ON "users" USING btree ("role");--> statement-breakpoint
CREATE INDEX "verifications_identifier_idx" ON "verifications" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "artist_aliases_trgm_idx" ON "artist_aliases" USING gin ("alias" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "artists_name_trgm_idx" ON "artists" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "character_aliases_trgm_idx" ON "character_aliases" USING gin ("alias" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "characters_name_trgm_idx" ON "characters" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "emoji_characters_character_idx" ON "emoji_characters" USING btree ("character_id");--> statement-breakpoint
CREATE INDEX "emojis_pack_sort_idx" ON "emojis" USING btree ("pack_id","sort_order");--> statement-breakpoint
CREATE INDEX "emojis_status_idx" ON "emojis" USING btree ("status");--> statement-breakpoint
CREATE INDEX "emojis_sha256_idx" ON "emojis" USING btree ("sha256");--> statement-breakpoint
CREATE INDEX "pack_artists_artist_idx" ON "pack_artists" USING btree ("artist_id");--> statement-breakpoint
CREATE INDEX "pack_characters_character_idx" ON "pack_characters" USING btree ("character_id");--> statement-breakpoint
CREATE INDEX "pack_tags_tag_idx" ON "pack_tags" USING btree ("tag_id");--> statement-breakpoint
CREATE INDEX "packs_status_published_idx" ON "packs" USING btree ("status","published_at");--> statement-breakpoint
CREATE INDEX "packs_owner_idx" ON "packs" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "packs_title_trgm_idx" ON "packs" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "tags_name_trgm_idx" ON "tags" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "comments_thread_idx" ON "comments" USING btree ("thread_type","thread_id","created_at");--> statement-breakpoint
CREATE INDEX "comments_status_idx" ON "comments" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "comments_root_idx" ON "comments" USING btree ("root_id");--> statement-breakpoint
CREATE INDEX "favorite_folders_user_idx" ON "favorite_folders" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "favorites_target_idx" ON "favorites" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "submissions_status_idx" ON "submissions" USING btree ("status","submitted_at");--> statement-breakpoint
CREATE INDEX "submissions_submitter_idx" ON "submissions" USING btree ("submitter_id","created_at");--> statement-breakpoint
CREATE INDEX "submissions_pack_idx" ON "submissions" USING btree ("pack_id");--> statement-breakpoint
CREATE INDEX "upload_items_submission_idx" ON "upload_items" USING btree ("submission_id");--> statement-breakpoint
CREATE INDEX "upload_items_status_idx" ON "upload_items" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_created_idx" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_target_idx" ON "audit_logs" USING btree ("target_type","target_id");

--> statement-breakpoint
-- Hot counters: no WAL. Emptied after a crash, which daily limits tolerate; hourly rollups go to download_stats_daily.
ALTER TABLE "download_counters" SET UNLOGGED;
--> statement-breakpoint
ALTER TABLE "rate_windows" SET UNLOGGED;
--> statement-breakpoint
-- At least one active 站长 (admin) must remain. Better Auth's admin endpoints (set-role, ban, remove-user)
-- bypass app code, so this lives in the database. Locking every admin row serialises concurrent demotions.
CREATE OR REPLACE FUNCTION keep_last_admin() RETURNS trigger AS $$
DECLARE
  remaining integer;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.role <> 'admin' OR OLD.banned THEN
      RETURN OLD;
    END IF;
  ELSE
    IF NOT (OLD.role = 'admin' AND NOT OLD.banned) THEN
      RETURN NEW;
    END IF;
    IF NEW.role = 'admin' AND NOT NEW.banned THEN
      RETURN NEW;
    END IF;
  END IF;
  PERFORM 1 FROM "users" WHERE "role" = 'admin' AND NOT "banned" FOR UPDATE;
  SELECT count(*) INTO remaining FROM "users" WHERE "role" = 'admin' AND NOT "banned" AND "id" <> OLD."id";
  IF remaining = 0 THEN
    RAISE EXCEPTION 'at least one active admin (站长) must remain' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER users_keep_last_admin BEFORE UPDATE OF "role", "banned" OR DELETE ON "users" FOR EACH ROW EXECUTE FUNCTION keep_last_admin();
