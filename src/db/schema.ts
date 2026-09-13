/**
 * Drizzle schema — the shared contract between all streams (SPEC §5.2).
 * Change this file, then `npm run db:generate`; never hand-edit migrations.
 *
 * There is no status column on games: status is derived on read from
 * starts_at / ends_at / published_at (invariant 3).
 */
import { relations, sql } from "drizzle-orm";
import {
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { GENERATION_RUN_STATUSES, PUBLIC_ID_LENGTH, type Normalized } from "@/lib/types";

// All timestamps are timestamptz and read back as UTC Dates (invariant 6).
const utc = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

// Coordinates are normalized [0,1] floats against the generated image (invariant 2).
// The brand is applied at the column so rows come out of the DB already typed.
const normalizedColumn = (name: string) => doublePrecision(name).$type<Normalized>();

/** Mirrored from Clerk on first sign-in. `id` is the Clerk user id. */
export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name"),
  imageUrl: text("image_url"),
  createdAt: utc("created_at").notNull().defaultNow(),
});

export const games = pgTable(
  "games",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** 21-character nanoid; the only id that appears in a URL. */
    publicId: varchar("public_id", { length: PUBLIC_ID_LENGTH }).notNull(),
    masterId: text("master_id")
      .notNull()
      .references(() => users.id),
    title: text("title").notNull(),
    /** Global style / difficulty prompt applied to the whole composition. */
    generalPrompt: text("general_prompt").notNull().default(""),
    /** Object key in the private `assets` bucket (neon.ts). Signed into a URL by `projectGame`. */
    backgroundKey: text("background_key"),
    /**
     * The canonical image, as an object key. All coordinates are relative to this, never to
     * the background. Any write here must also reset `objects.confirmed` for the game.
     */
    generatedImageKey: text("generated_image_key"),
    imageWidth: integer("image_width"),
    imageHeight: integer("image_height"),
    startsAt: utc("starts_at"),
    endsAt: utc("ends_at"),
    publishedAt: utc("published_at"),
    createdAt: utc("created_at").notNull().defaultNow(),
    updatedAt: utc("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("games_public_id_idx").on(t.publicId),
    index("games_master_id_idx").on(t.masterId),
    check("games_window_ordered", sql`${t.startsAt} IS NULL OR ${t.endsAt} IS NULL OR ${t.endsAt} > ${t.startsAt}`),
    check(
      "games_published_has_window",
      sql`${t.publishedAt} IS NULL OR (${t.startsAt} IS NOT NULL AND ${t.endsAt} IS NOT NULL)`,
    ),
    check("games_published_has_image", sql`${t.publishedAt} IS NULL OR ${t.generatedImageKey} IS NOT NULL`),
    check(
      "games_image_dims_together",
      sql`(${t.generatedImageKey} IS NULL) = (${t.imageWidth} IS NULL) AND (${t.imageWidth} IS NULL) = (${t.imageHeight} IS NULL)`,
    ),
    check("games_image_dims_positive", sql`${t.imageWidth} IS NULL OR (${t.imageWidth} > 0 AND ${t.imageHeight} > 0)`),
  ],
);

export const objects = pgTable(
  "objects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    gameId: uuid("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    /** Per-object placement prompt ("tucked behind the yellow tunnel, partially occluded"). */
    prompt: text("prompt").notNull().default(""),
    /** Object key in the private `assets` bucket. */
    sourceImageKey: text("source_image_key").notNull(),
    /** Thumbnail order during play. Not unique: reorder by swapping in one UPDATE. */
    sortOrder: integer("sort_order").notNull(),
    /** How large the object should appear, as a fraction of image width. Input to the SPEC §5.3 scale check. */
    requestedScale: normalizedColumn("requested_scale"),
    /** Null until generation proposes a position. Fraction of image width / height / width. */
    x: normalizedColumn("x"),
    y: normalizedColumn("y"),
    radius: normalizedColumn("radius"),
    /**
     * Set by the master after reviewing the position on the *current* generated image.
     * Gates publication (invariant 4). Any write to x/y/radius or to
     * games.generated_image_key must reset this to false; the publish transaction re-checks.
     */
    confirmed: boolean("confirmed").notNull().default(false),
  },
  (t) => [
    index("objects_game_sort_idx").on(t.gameId, t.sortOrder),
    check("objects_x_normalized", sql`${t.x} IS NULL OR (${t.x} >= 0 AND ${t.x} <= 1)`),
    check("objects_y_normalized", sql`${t.y} IS NULL OR (${t.y} >= 0 AND ${t.y} <= 1)`),
    check("objects_radius_normalized", sql`${t.radius} IS NULL OR (${t.radius} >= 0 AND ${t.radius} <= 1)`),
    check(
      "objects_scale_normalized",
      sql`${t.requestedScale} IS NULL OR (${t.requestedScale} > 0 AND ${t.requestedScale} <= 1)`,
    ),
    check(
      "objects_position_together",
      sql`(${t.x} IS NULL) = (${t.y} IS NULL) AND (${t.y} IS NULL) = (${t.radius} IS NULL)`,
    ),
    check("objects_confirmed_has_position", sql`NOT ${t.confirmed} OR ${t.x} IS NOT NULL`),
  ],
);

export const attempts = pgTable(
  "attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    gameId: uuid("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    /** Written server-side when the player presses Start (invariant 5). */
    startedAt: utc("started_at").notNull().defaultNow(),
    /**
     * Submit is `UPDATE … WHERE id = $1 AND submitted_at IS NULL`; a row count of 0 is a
     * rejected double submission. Markers are inserted in the same transaction.
     */
    submittedAt: utc("submitted_at"),
    /** Generated by the database from the two server-written timestamps; the client cannot influence it (invariant 5). */
    elapsedMs: integer("elapsed_ms").generatedAlwaysAs(
      sql`(extract(epoch from (submitted_at - started_at)) * 1000)::integer`,
    ),
    foundCount: integer("found_count"),
  },
  (t) => [
    /** One attempt per player per game, enforced here and not only in the UI (SPEC §3.4). */
    uniqueIndex("attempts_game_user_idx").on(t.gameId, t.userId),
    check("attempts_submission_complete", sql`(${t.submittedAt} IS NULL) = (${t.foundCount} IS NULL)`),
    check("attempts_submitted_after_start", sql`${t.submittedAt} IS NULL OR ${t.submittedAt} >= ${t.startedAt}`),
    check("attempts_found_non_negative", sql`${t.foundCount} IS NULL OR ${t.foundCount} >= 0`),
  ],
);

export const markers = pgTable(
  "markers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    attemptId: uuid("attempt_id")
      .notNull()
      .references(() => attempts.id, { onDelete: "cascade" }),
    x: normalizedColumn("x").notNull(),
    y: normalizedColumn("y").notNull(),
    /** Assigned at scoring time by greedy nearest-match; null for a miss. */
    matchedObjectId: uuid("matched_object_id").references(() => objects.id, { onDelete: "set null" }),
  },
  (t) => [
    index("markers_attempt_id_idx").on(t.attemptId),
    check("markers_x_normalized", sql`${t.x} >= 0 AND ${t.x} <= 1`),
    check("markers_y_normalized", sql`${t.y} >= 0 AND ${t.y} <= 1`),
  ],
);

export const generationRunStatus = pgEnum("generation_run_status", GENERATION_RUN_STATUSES);

/**
 * The durable record of the autonomous generation loop (SPEC §5.3). One row per
 * attempt; the sequence of rows for a game is the evidence of failure → adjustment → recovery.
 */
export const generationRuns = pgTable(
  "generation_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    gameId: uuid("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    /** 1-based, per game. */
    attemptNumber: integer("attempt_number").notNull(),
    status: generationRunStatus("status").notNull().default("queued"),
    promptUsed: text("prompt_used").notNull(),
    visionResponse: jsonb("vision_response"),
    /** One of the SPEC §5.3 failure classes, plus detail. Null when passed. */
    failureReason: text("failure_reason"),
    /** The SPEC §5.3 prompt adjustment applied in response to this run's failure. */
    adjustment: text("adjustment"),
    durationMs: integer("duration_ms"),
    startedAt: utc("started_at").notNull().defaultNow(),
    finishedAt: utc("finished_at"),
  },
  (t) => [
    uniqueIndex("generation_runs_game_attempt_idx").on(t.gameId, t.attemptNumber),
    check("generation_runs_attempt_positive", sql`${t.attemptNumber} >= 1`),
  ],
);

// ---------------------------------------------------------------------------
// Relations (for the relational query API)
// ---------------------------------------------------------------------------

export const usersRelations = relations(users, ({ many }) => ({
  games: many(games),
  attempts: many(attempts),
}));

export const gamesRelations = relations(games, ({ one, many }) => ({
  master: one(users, { fields: [games.masterId], references: [users.id] }),
  objects: many(objects),
  attempts: many(attempts),
  generationRuns: many(generationRuns),
}));

export const objectsRelations = relations(objects, ({ one }) => ({
  game: one(games, { fields: [objects.gameId], references: [games.id] }),
}));

export const attemptsRelations = relations(attempts, ({ one, many }) => ({
  game: one(games, { fields: [attempts.gameId], references: [games.id] }),
  user: one(users, { fields: [attempts.userId], references: [users.id] }),
  markers: many(markers),
}));

export const markersRelations = relations(markers, ({ one }) => ({
  attempt: one(attempts, { fields: [markers.attemptId], references: [attempts.id] }),
  matchedObject: one(objects, { fields: [markers.matchedObjectId], references: [objects.id] }),
}));

export const generationRunsRelations = relations(generationRuns, ({ one }) => ({
  game: one(games, { fields: [generationRuns.gameId], references: [games.id] }),
}));

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Game = typeof games.$inferSelect;
export type NewGame = typeof games.$inferInsert;
export type GameObject = typeof objects.$inferSelect;
export type NewGameObject = typeof objects.$inferInsert;
export type Attempt = typeof attempts.$inferSelect;
export type NewAttempt = typeof attempts.$inferInsert;
export type Marker = typeof markers.$inferSelect;
export type NewMarker = typeof markers.$inferInsert;
export type GenerationRun = typeof generationRuns.$inferSelect;
export type NewGenerationRun = typeof generationRuns.$inferInsert;
