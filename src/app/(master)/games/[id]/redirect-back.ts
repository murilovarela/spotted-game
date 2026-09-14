import { redirect } from "next/navigation";
import type { ActionError } from "@/lib/games/result";

export type SavedWhat = "window" | "position" | "object" | "background";

const SAVED_WHAT: readonly SavedWhat[] = ["window", "position", "object", "background"];

/** Narrows an untrusted `?ok=` query value to `SavedWhat`, so the page never trusts it blindly. */
export function isSavedWhat(v: unknown): v is SavedWhat {
  return typeof v === "string" && (SAVED_WHAT as readonly string[]).includes(v);
}

/**
 * Shared by every inline `"use server"` action on the edit page (and by `ObjectRow`'s
 * Confirm/Remove actions): redirect back to the game, carrying `?error=<code>` on failure
 * so the page renders fixed copy for it (error-copy.ts) — the code, never the message, so
 * nothing user-chosen reaches the alert. On success, an optional `saved` adds `?ok=<what>`
 * so the page can fire a one-shot toast (SavedToast). Plain helper, not itself a server
 * action — it is called *from inside* server actions, each of which may only close over
 * serializable values (a string id, a plain result object), never over a function reference.
 */
export function redirectBack(
  gameId: string,
  r: { readonly ok: true } | { readonly ok: false; readonly error: ActionError },
  saved?: SavedWhat,
): never {
  if (!r.ok) redirect(`/games/${gameId}?error=${r.error}`);
  redirect(`/games/${gameId}${saved ? `?ok=${saved}` : ""}`);
}
