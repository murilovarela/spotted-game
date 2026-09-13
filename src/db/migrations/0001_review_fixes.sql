ALTER TABLE "games" RENAME COLUMN "background_url" TO "background_key";--> statement-breakpoint
ALTER TABLE "games" RENAME COLUMN "generated_image_url" TO "generated_image_key";--> statement-breakpoint
ALTER TABLE "objects" RENAME COLUMN "source_image_url" TO "source_image_key";--> statement-breakpoint
ALTER TABLE "attempts" DROP CONSTRAINT "attempts_elapsed_non_negative";--> statement-breakpoint
ALTER TABLE "attempts" DROP CONSTRAINT "attempts_submission_complete";--> statement-breakpoint
ALTER TABLE "games" DROP CONSTRAINT "games_image_dims_together";--> statement-breakpoint
DROP INDEX "objects_game_sort_idx";--> statement-breakpoint
ALTER TABLE "attempts" drop column "elapsed_ms";--> statement-breakpoint
ALTER TABLE "attempts" ADD COLUMN "elapsed_ms" integer GENERATED ALWAYS AS ((extract(epoch from (submitted_at - started_at)) * 1000)::integer) STORED;--> statement-breakpoint
ALTER TABLE "objects" ADD COLUMN "requested_scale" double precision;--> statement-breakpoint
CREATE INDEX "objects_game_sort_idx" ON "objects" USING btree ("game_id","sort_order");--> statement-breakpoint
ALTER TABLE "attempts" ADD CONSTRAINT "attempts_submitted_after_start" CHECK ("attempts"."submitted_at" IS NULL OR "attempts"."submitted_at" >= "attempts"."started_at");--> statement-breakpoint
ALTER TABLE "attempts" ADD CONSTRAINT "attempts_submission_complete" CHECK (("attempts"."submitted_at" IS NULL) = ("attempts"."found_count" IS NULL));--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_published_has_image" CHECK ("games"."published_at" IS NULL OR "games"."generated_image_key" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_image_dims_together" CHECK (("games"."generated_image_key" IS NULL) = ("games"."image_width" IS NULL) AND ("games"."image_width" IS NULL) = ("games"."image_height" IS NULL));--> statement-breakpoint
ALTER TABLE "objects" ADD CONSTRAINT "objects_scale_normalized" CHECK ("objects"."requested_scale" IS NULL OR ("objects"."requested_scale" > 0 AND "objects"."requested_scale" <= 1));