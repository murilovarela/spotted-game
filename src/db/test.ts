/**
 * Integration-test database. Points at TEST_DATABASE_URL only — never DATABASE_URL —
 * because these helpers truncate every table.
 */
import { sql } from "drizzle-orm";
import { createDb, type Database } from "./index";

export function createTestDb(): { db: Database; close: () => Promise<void> } {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      "TEST_DATABASE_URL is not set. Point it at a disposable Neon branch; integration tests truncate tables.",
    );
  }
  const db = createDb(url);
  return { db, close: () => db.$client.end() };
}

export async function truncateAll(db: Database): Promise<void> {
  await db.execute(
    sql`truncate table markers, attempts, generation_runs, objects, games, users restart identity cascade`,
  );
}
