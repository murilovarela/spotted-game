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
};

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

/** The signed-in user as a `users` row, or null. Call from server actions and pages. */
export async function getCurrentUser(): Promise<User | null> {
  const clerkUser = await currentUser();
  if (!clerkUser) return null;
  const row = toUserRow(clerkUser);
  if (!row) return null;
  return upsertUser(getDb(), row);
}
