/**
 * Clerk is the identity provider; `users` is a mirror written lazily on first server
 * action (SPEC §5.2). No webhook: the row is upserted whenever we resolve the session.
 */
import { currentUser } from "@clerk/nextjs/server";
import { getDb, type Database } from "@/db";
import { users, type NewUser, type User } from "@/db/schema";

export type ClerkUserLike = {
  readonly id: string;
  readonly primaryEmailAddress: { readonly emailAddress: string } | null;
  readonly fullName: string | null;
  readonly imageUrl: string;
  readonly publicMetadata?: unknown;
};

export type UserRole = "game_master" | "player";

export type CurrentActor = {
  readonly user: User;
  readonly role: UserRole;
};

export type GameMasterAuth =
  | { readonly ok: true; readonly user: User }
  | { readonly ok: false; readonly reason: "UNAUTHENTICATED" | "FORBIDDEN" };

/** Clerk metadata is untrusted input. Only the exact allowlisted value grants authoring. */
export function roleFromPublicMetadata(metadata: unknown): UserRole {
  if (typeof metadata !== "object" || metadata === null) return "player";
  return "role" in metadata && metadata.role === "game_master" ? "game_master" : "player";
}

export function toUserRow(u: ClerkUserLike): NewUser | null {
  const email = u.primaryEmailAddress?.emailAddress;
  if (!email) return null;
  const name = u.fullName?.trim() || null;
  return { id: u.id, email, name, imageUrl: u.imageUrl || null };
}

export async function upsertUser(db: Database, row: NewUser): Promise<User> {
  const [user] = await db
    .insert(users)
    .values(row)
    .onConflictDoUpdate({
      target: users.id,
      set: { email: row.email, name: row.name ?? null, imageUrl: row.imageUrl ?? null },
    })
    .returning();
  return user;
}

/** Resolve both identity and authorization from Clerk on the server. */
export async function getCurrentActor(): Promise<CurrentActor | null> {
  const clerkUser = await currentUser();
  if (!clerkUser) return null;
  const row = toUserRow(clerkUser);
  if (!row) return null;
  return {
    user: await upsertUser(getDb(), row),
    role: roleFromPublicMetadata(clerkUser.publicMetadata),
  };
}

/** Pure authorization decision, split out so fail-closed behavior is unit-testable. */
export function authorizeGameMaster(actor: CurrentActor | null): GameMasterAuth {
  if (!actor) return { ok: false, reason: "UNAUTHENTICATED" };
  if (actor.role !== "game_master") return { ok: false, reason: "FORBIDDEN" };
  return { ok: true, user: actor.user };
}

/** The signed-in user as a `users` row, or null. Call from play actions and public pages. */
export async function getCurrentUser(): Promise<User | null> {
  return (await getCurrentActor())?.user ?? null;
}

/** Server-side authoring gate. UI visibility is never the authorization boundary. */
export async function getCurrentGameMaster(): Promise<GameMasterAuth> {
  return authorizeGameMaster(await getCurrentActor());
}
