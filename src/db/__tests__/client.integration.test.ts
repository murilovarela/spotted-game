import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { users } from "../schema";
import { createTestDb, truncateAll } from "../test";

const { db, close } = createTestDb();
beforeEach(() => truncateAll(db));
afterAll(() => close());

describe("test database", () => {
  it("is empty after truncateAll", async () => {
    await db.insert(users).values({ id: "u1", email: "u1@example.com" });
    await truncateAll(db);
    expect(await db.select().from(users)).toHaveLength(0);
  });

  it("runs a transaction that rolls back on error", async () => {
    await expect(
      db.transaction(async (tx) => {
        await tx.insert(users).values({ id: "u1", email: "u1@example.com" });
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await db.select().from(users)).toHaveLength(0);
  });

  it("reads timestamps back as UTC Dates", async () => {
    // A typed select, not a raw db.execute(): drizzle's neon-serverless driver deliberately
    // disables the pg wire-protocol date parser and does its own conversion from each
    // column's declared type (schema.ts's `utc()` helper), so only queries that carry field
    // metadata — select/insert/etc. — get Date objects back. A raw `db.execute(sql\`select
    // now()\`)` has no field metadata and returns the driver's un-decoded string instead.
    await db.insert(users).values({ id: "u1", email: "u1@example.com" });
    const [row] = await db.select().from(users);
    expect(row.createdAt).toBeInstanceOf(Date);
  });
});
