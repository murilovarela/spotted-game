import { redirect } from "next/navigation";
import type { ActionError } from "@/lib/games/result";

/**
 * Shared by every inline `"use server"` action on the edit page (and by `ObjectRow`'s
 * Confirm/Remove actions): redirect back to the game, carrying `?error=<code>` on failure
 * so the page renders fixed copy for it (error-copy.ts) — the code, never the message, so
 * nothing user-chosen reaches the alert. Plain helper, not itself a server action — it is
 * called *from inside* server actions, each of which may only close over serializable
 * values (a string id, a plain result object), never over a function reference.
 */
export function redirectBack(gameId: string, r: { readonly ok: true } | { readonly ok: false; readonly error: ActionError }): never {
  redirect(`/games/${gameId}${r.ok ? "" : `?error=${r.error}`}`);
}
