import { describe, expect, it } from "vitest";
import type { User } from "@/db/schema";
import { authorizeGameMaster, roleFromPublicMetadata, toUserRow } from "../auth";

const user: User = {
  id: "user_1",
  email: "a@b.co",
  name: "Ada",
  imageUrl: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
};

describe("toUserRow", () => {
  it("maps id, email, name, image", () => {
    expect(
      toUserRow({ id: "user_1", primaryEmailAddress: { emailAddress: "a@b.co" }, fullName: "Ada", imageUrl: "https://img/a.png" }),
    ).toEqual({ id: "user_1", email: "a@b.co", name: "Ada", imageUrl: "https://img/a.png" });
  });
  it("returns null without an email (cannot satisfy users.email NOT NULL)", () => {
    expect(toUserRow({ id: "user_1", primaryEmailAddress: null, fullName: null, imageUrl: "" })).toBeNull();
  });
  it("stores null name for an empty name", () => {
    expect(toUserRow({ id: "u", primaryEmailAddress: { emailAddress: "a@b.co" }, fullName: "  ", imageUrl: "" })).toMatchObject({ name: null });
  });
});

describe("roleFromPublicMetadata", () => {
  it("grants authoring only for the exact game_master role", () => {
    expect(roleFromPublicMetadata({ role: "game_master" })).toBe("game_master");
    expect(roleFromPublicMetadata({ role: "GAME_MASTER" })).toBe("player");
    expect(roleFromPublicMetadata({ role: "admin" })).toBe("player");
  });

  it.each([undefined, null, "game_master", {}, { role: 1 }])("fails closed for malformed or missing metadata: %j", (metadata) => {
    expect(roleFromPublicMetadata(metadata)).toBe("player");
  });
});

describe("authorizeGameMaster", () => {
  it("distinguishes signed-out users, players, and game masters", () => {
    expect(authorizeGameMaster(null)).toEqual({ ok: false, reason: "UNAUTHENTICATED" });
    expect(authorizeGameMaster({ user, role: "player" })).toEqual({ ok: false, reason: "FORBIDDEN" });
    expect(authorizeGameMaster({ user, role: "game_master" })).toEqual({ ok: true, user });
  });
});
