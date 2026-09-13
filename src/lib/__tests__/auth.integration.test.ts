import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, truncateAll } from "@/db/test";
import { users } from "@/db/schema";
import { upsertUser } from "../auth";

const { db, close } = createTestDb();
beforeEach(() => truncateAll(db));
afterAll(() => close());

describe("upsertUser", () => {
  it("inserts on first sign-in and refreshes name/image on later calls", async () => {
    const first = await upsertUser(db, { id: "user_1", email: "a@b.co", name: "Ada", imageUrl: null });
    expect(first.name).toBe("Ada");
    const second = await upsertUser(db, { id: "user_1", email: "a@b.co", name: "Ada L.", imageUrl: "https://img/a.png" });
    expect(second).toMatchObject({ name: "Ada L.", imageUrl: "https://img/a.png" });
    expect(await db.select().from(users)).toHaveLength(1);
  });
});
