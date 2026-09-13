CREATE TYPE "public"."generation_run_status" AS ENUM('queued', 'running', 'passed', 'failed');--> statement-breakpoint
CREATE TABLE "attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_at" timestamp with time zone,
	"elapsed_ms" integer,
	"found_count" integer,
	CONSTRAINT "attempts_submission_complete" CHECK (("attempts"."submitted_at" IS NULL) = ("attempts"."elapsed_ms" IS NULL) AND ("attempts"."elapsed_ms" IS NULL) = ("attempts"."found_count" IS NULL)),
	CONSTRAINT "attempts_elapsed_non_negative" CHECK ("attempts"."elapsed_ms" IS NULL OR "attempts"."elapsed_ms" >= 0),
	CONSTRAINT "attempts_found_non_negative" CHECK ("attempts"."found_count" IS NULL OR "attempts"."found_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "games" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"public_id" varchar(21) NOT NULL,
	"master_id" text NOT NULL,
	"title" text NOT NULL,
	"general_prompt" text DEFAULT '' NOT NULL,
	"background_url" text,
	"generated_image_url" text,
	"image_width" integer,
	"image_height" integer,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "games_window_ordered" CHECK ("games"."starts_at" IS NULL OR "games"."ends_at" IS NULL OR "games"."ends_at" > "games"."starts_at"),
	CONSTRAINT "games_published_has_window" CHECK ("games"."published_at" IS NULL OR ("games"."starts_at" IS NOT NULL AND "games"."ends_at" IS NOT NULL)),
	CONSTRAINT "games_image_dims_together" CHECK (("games"."generated_image_url" IS NULL) = ("games"."image_width" IS NULL) AND ("games"."image_width" IS NULL) = ("games"."image_height" IS NULL)),
	CONSTRAINT "games_image_dims_positive" CHECK ("games"."image_width" IS NULL OR ("games"."image_width" > 0 AND "games"."image_height" > 0))
);
--> statement-breakpoint
CREATE TABLE "generation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" uuid NOT NULL,
	"attempt_number" integer NOT NULL,
	"status" "generation_run_status" DEFAULT 'queued' NOT NULL,
	"prompt_used" text NOT NULL,
	"vision_response" jsonb,
	"failure_reason" text,
	"adjustment" text,
	"duration_ms" integer,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "generation_runs_attempt_positive" CHECK ("generation_runs"."attempt_number" >= 1)
);
--> statement-breakpoint
CREATE TABLE "markers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attempt_id" uuid NOT NULL,
	"x" double precision NOT NULL,
	"y" double precision NOT NULL,
	"matched_object_id" uuid,
	CONSTRAINT "markers_x_normalized" CHECK ("markers"."x" >= 0 AND "markers"."x" <= 1),
	CONSTRAINT "markers_y_normalized" CHECK ("markers"."y" >= 0 AND "markers"."y" <= 1)
);
--> statement-breakpoint
CREATE TABLE "objects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" uuid NOT NULL,
	"label" text NOT NULL,
	"prompt" text DEFAULT '' NOT NULL,
	"source_image_url" text NOT NULL,
	"sort_order" integer NOT NULL,
	"x" double precision,
	"y" double precision,
	"radius" double precision,
	"confirmed" boolean DEFAULT false NOT NULL,
	CONSTRAINT "objects_x_normalized" CHECK ("objects"."x" IS NULL OR ("objects"."x" >= 0 AND "objects"."x" <= 1)),
	CONSTRAINT "objects_y_normalized" CHECK ("objects"."y" IS NULL OR ("objects"."y" >= 0 AND "objects"."y" <= 1)),
	CONSTRAINT "objects_radius_normalized" CHECK ("objects"."radius" IS NULL OR ("objects"."radius" >= 0 AND "objects"."radius" <= 1)),
	CONSTRAINT "objects_position_together" CHECK (("objects"."x" IS NULL) = ("objects"."y" IS NULL) AND ("objects"."y" IS NULL) = ("objects"."radius" IS NULL)),
	CONSTRAINT "objects_confirmed_has_position" CHECK (NOT "objects"."confirmed" OR "objects"."x" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"image_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "attempts" ADD CONSTRAINT "attempts_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attempts" ADD CONSTRAINT "attempts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_master_id_users_id_fk" FOREIGN KEY ("master_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_runs" ADD CONSTRAINT "generation_runs_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "markers" ADD CONSTRAINT "markers_attempt_id_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "markers" ADD CONSTRAINT "markers_matched_object_id_objects_id_fk" FOREIGN KEY ("matched_object_id") REFERENCES "public"."objects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "objects" ADD CONSTRAINT "objects_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "attempts_game_user_idx" ON "attempts" USING btree ("game_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "games_public_id_idx" ON "games" USING btree ("public_id");--> statement-breakpoint
CREATE INDEX "games_master_id_idx" ON "games" USING btree ("master_id");--> statement-breakpoint
CREATE UNIQUE INDEX "generation_runs_game_attempt_idx" ON "generation_runs" USING btree ("game_id","attempt_number");--> statement-breakpoint
CREATE INDEX "markers_attempt_id_idx" ON "markers" USING btree ("attempt_id");--> statement-breakpoint
CREATE UNIQUE INDEX "objects_game_sort_idx" ON "objects" USING btree ("game_id","sort_order");