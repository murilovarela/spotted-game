import { describe, expect, it } from "vitest";
import { errorCopy, isActionError, PLAY_COPY } from "../error-copy";

describe("errorCopy", () => {
  it("maps a known play code to its fixed copy", () => {
    expect(errorCopy("NOT_ACTIVE")).toBe("This game is not open for play right now.");
    expect(errorCopy("MASTER_CANNOT_PLAY")).toBe("The game master cannot play their own game.");
    expect(errorCopy("UNAUTHENTICATED")).toBe("Sign in to start.");
  });

  it("falls back to a generic line for a known code the table does not cover", () => {
    expect(errorCopy("NOT_FOUND")).toBe("Something went wrong. Try again.");
    expect(errorCopy("WRONG_MARKER_COUNT")).toBe("Something went wrong. Try again.");
  });

  it("renders nothing for an unknown or absent value", () => {
    expect(errorCopy(undefined)).toBeNull();
    expect(errorCopy("")).toBeNull();
    expect(errorCopy("<script>alert(1)</script>")).toBeNull();
    expect(errorCopy("Your account was suspended, call 555-0100")).toBeNull();
    expect(errorCopy("not_active")).toBeNull(); // case-sensitive
    expect(errorCopy("__proto__")).toBeNull();
    expect(errorCopy("toString")).toBeNull(); // own keys only, never the prototype chain
  });

  it("looks up an alternate table", () => {
    const table = { NO_IMAGE: "Generate the image first." } as const;
    expect(errorCopy("NO_IMAGE", table)).toBe("Generate the image first.");
    expect(errorCopy("NOT_ACTIVE", table)).toBe("Something went wrong. Try again.");
    expect(errorCopy("nope", table)).toBeNull();
  });

  it("isActionError narrows only exact codes", () => {
    expect(isActionError("NOT_ACTIVE")).toBe(true);
    expect(isActionError(42)).toBe(false);
    expect(isActionError(null)).toBe(false);
    expect(isActionError("hasOwnProperty")).toBe(false);
  });

  it("the play table only names codes the Start action can emit", () => {
    expect(Object.keys(PLAY_COPY).sort()).toEqual(["MASTER_CANNOT_PLAY", "NOT_ACTIVE", "UNAUTHENTICATED"]);
  });
});
