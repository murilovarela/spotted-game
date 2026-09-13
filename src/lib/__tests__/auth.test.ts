import { describe, expect, it } from "vitest";
import { toUserRow } from "../auth";

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
