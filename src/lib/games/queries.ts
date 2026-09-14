/**
 * The only read path for game data. Everything returned here has been through
 * `projectGame` (invariant 1). Callers never see rows.
 */
import { asc, desc, eq } from "drizzle-orm";
import type { Database } from "@/db";
import { games, generationRuns, objects } from "@/db/schema";
import { deriveStatus } from "@/lib/status";
import { urlResolverFor } from "@/lib/storage";
import type { GameView, MasterGameView } from "@/lib/types";
import { projectGame } from "@/lib/visibility";
import { isUuid } from "./validation";

type Resolver = (keys: readonly (string | null)[]) => Promise<(key: string) => string>;

async function project(
  db: Database,
  game: typeof games.$inferSelect,
  userId: string | null,
  now: Date,
  resolve: Resolver,
): Promise<GameView | null> {
  const objs = await db.select().from(objects).where(eq(objects.gameId, game.id)).orderBy(asc(objects.sortOrder));
  const isMaster = userId !== null && userId === game.masterId;
  const runs = isMaster
    ? await db.select().from(generationRuns).where(eq(generationRuns.gameId, game.id)).orderBy(asc(generationRuns.attemptNumber))
    : [];
  const resolveUrl = await resolve([game.generatedImageKey, game.backgroundKey, ...objs.map((o) => o.sourceImageKey)]);
  return projectGame({ game, objects: objs, generationRuns: runs, userId, now, resolveUrl });
}

export async function loadGameForViewer(
  db: Database,
  publicId: string,
  userId: string | null,
  now: Date,
  resolve: Resolver = urlResolverFor,
): Promise<GameView | null> {
  const [game] = await db.select().from(games).where(eq(games.publicId, publicId));
  if (!game) return null;
  return project(db, game, userId, now, resolve);
}

export async function loadGameForMasterById(
  db: Database,
  gameId: string,
  userId: string,
  now: Date,
  resolve: Resolver = urlResolverFor,
): Promise<MasterGameView | null> {
  if (!isUuid(gameId)) return null;
  const [game] = await db.select().from(games).where(eq(games.id, gameId));
  if (!game || game.masterId !== userId) return null;
  const view = await project(db, game, userId, now, resolve);
  return view?.viewer === "master" ? view : null;
}

export async function listGamesForMaster(db: Database, userId: string, now: Date, resolve: Resolver = urlResolverFor) {
  const rows = await db
    .select({
      id: games.id,
      publicId: games.publicId,
      title: games.title,
      startsAt: games.startsAt,
      endsAt: games.endsAt,
      publishedAt: games.publishedAt,
      generatedImageKey: games.generatedImageKey,
    })
    .from(games)
    .where(eq(games.masterId, userId))
    .orderBy(desc(games.createdAt));
  const resolveUrl = await resolve(rows.map((r) => r.generatedImageKey));
  return rows.map(({ publishedAt, generatedImageKey, ...r }) => ({
    ...r,
    status: deriveStatus({ ...r, publishedAt }, now),
    imageUrl: generatedImageKey === null ? null : resolveUrl(generatedImageKey),
  }));
}
