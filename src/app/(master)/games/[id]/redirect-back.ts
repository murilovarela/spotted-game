import { redirect } from "next/navigation";

/**
 * Shared by every inline `"use server"` action on the edit page (and by `ObjectRow`'s
 * Confirm/Remove actions): redirect back to the game, carrying `?error=` on failure so
 * the page renders it. Plain helper, not itself a server action — it is called *from
 * inside* server actions, each of which may only close over serializable values (a
 * string id, a plain result object), never over a function reference.
 */
export function redirectBack(gameId: string, r: { ok: boolean; message?: string }): never {
  redirect(`/games/${gameId}${r.ok ? "" : `?error=${encodeURIComponent(r.message ?? "")}`}`);
}
