import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hourBucket, isAllowedImageType, isAssetKind, isOwnedKey, objectKey, presignGet } from "../storage";

describe("objectKey", () => {
  it("namespaces by game and kind and picks the extension from the content type", () => {
    const key = objectKey("background", "11111111-1111-4111-8111-111111111111", "image/png");
    expect(key).toMatch(/^games\/11111111-1111-4111-8111-111111111111\/background\/[A-Za-z0-9_-]{21}\.png$/);
    expect(objectKey("object", "g", "image/jpeg")).toMatch(/\.jpg$/);
    expect(objectKey("object", "g", "image/webp")).toMatch(/\.webp$/);
  });
  it("throws on a disallowed content type", () => {
    expect(() => objectKey("object", "g", "image/gif")).toThrow();
  });
});

describe("isAllowedImageType", () => {
  it("allows png, jpeg, webp only", () => {
    expect(isAllowedImageType("image/png")).toBe(true);
    expect(isAllowedImageType("image/gif")).toBe(false);
    expect(isAllowedImageType("text/html")).toBe(false);
  });
});

describe("isAssetKind", () => {
  it("allows background, object and generated only", () => {
    expect(isAssetKind("background")).toBe(true);
    expect(isAssetKind("object")).toBe(true);
    expect(isAssetKind("generated")).toBe(true);
    expect(isAssetKind("backgrounds")).toBe(false);
    expect(isAssetKind("")).toBe(false);
  });
});

describe("isOwnedKey", () => {
  const gameId = "11111111-1111-4111-8111-111111111111";

  it("accepts a key under games/<id>/<kind>/", () => {
    expect(isOwnedKey("background", gameId, `games/${gameId}/background/a.png`)).toBe(true);
    expect(isOwnedKey("object", gameId, `games/${gameId}/object/b.jpg`)).toBe(true);
    expect(isOwnedKey("generated", gameId, `games/${gameId}/generated/c.webp`)).toBe(true);
  });

  it("rejects a key for a different game or the wrong kind", () => {
    expect(isOwnedKey("background", gameId, "games/other-game/background/a.png")).toBe(false);
    expect(isOwnedKey("object", gameId, `games/${gameId}/background/a.png`)).toBe(false);
  });

  it("rejects a key with no prefix or a bare filename", () => {
    expect(isOwnedKey("background", gameId, "a.png")).toBe(false);
    expect(isOwnedKey("background", gameId, "")).toBe(false);
  });

  it("rejects a key containing a .. path-traversal segment", () => {
    expect(isOwnedKey("background", gameId, `games/${gameId}/background/../../../etc/passwd`)).toBe(false);
    expect(isOwnedKey("background", gameId, `games/${gameId}/background/..`)).toBe(false);
  });
});

describe("hourBucket", () => {
  it("floors to the hour in UTC", () => {
    expect(hourBucket(new Date("2026-09-14T13:59:59.999Z")).toISOString()).toBe("2026-09-14T13:00:00.000Z");
    expect(hourBucket(new Date("2026-09-14T14:00:00.000Z")).toISOString()).toBe("2026-09-14T14:00:00.000Z");
  });
});

describe("presignGet", () => {
  const env = process.env;
  beforeEach(() => {
    process.env = { ...env, AWS_ACCESS_KEY_ID: "test", AWS_SECRET_ACCESS_KEY: "test", AWS_ENDPOINT_URL_S3: "https://storage.example.test", AWS_REGION: "us-east-1" };
  });
  afterEach(() => {
    process.env = env;
  });
  it("is byte-identical within the same hour and differs across hours", async () => {
    const a = await presignGet("games/g/generated/x.png", new Date("2026-09-14T13:01:00Z"));
    const b = await presignGet("games/g/generated/x.png", new Date("2026-09-14T13:58:00Z"));
    const c = await presignGet("games/g/generated/x.png", new Date("2026-09-14T14:01:00Z"));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toContain("X-Amz-Expires=7200");
  });
});
