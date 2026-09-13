/**
 * Application database handle. Uses the WebSocket driver so transactions work
 * (the HTTP driver cannot hold a session — see docs/handoffs/phase-0.md).
 */
import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import * as schema from "./schema";

export type Database = ReturnType<typeof createDb>;

export function createDb(connectionString: string) {
  const pool = new Pool({ connectionString });
  return drizzle(pool, { schema, casing: "snake_case" });
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

// Lazy so importing this module in a unit test does not open a socket.
let singleton: Database | undefined;
export function getDb(): Database {
  singleton ??= createDb(required("DATABASE_URL"));
  return singleton;
}
