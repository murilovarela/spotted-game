"use server";
import { getCurrentUser } from "@/lib/auth";
import { getDb } from "@/db";
import { games } from "@/db/schema";
import { eq } from "drizzle-orm";
import { isAllowedImageType, objectKey, presignPut, type AssetKind } from "@/lib/storage";
import { fail, ok, type ActionResult } from "./result";

export async function requestUploadUrl(input: {
  gameId: string;
  kind: AssetKind;
  contentType: string;
}): Promise<ActionResult<{ key: string; url: string }>> {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHENTICATED", "Sign in first");
  if (!isAllowedImageType(input.contentType)) return fail("INVALID_INPUT", "Use a PNG, JPEG, or WebP image");
  const [game] = await getDb()
    .select({ masterId: games.masterId, publishedAt: games.publishedAt })
    .from(games)
    .where(eq(games.id, input.gameId));
  if (!game) return fail("NOT_FOUND", "Game not found");
  if (game.masterId !== user.id) return fail("NOT_MASTER", "Only the game master can upload");
  if (game.publishedAt !== null) return fail("NOT_DRAFT", "Published games cannot change images");
  const key = objectKey(input.kind, input.gameId, input.contentType);
  return ok({ key, url: await presignPut(key, input.contentType) });
}
