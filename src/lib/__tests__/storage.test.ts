import { describe, expect, it } from "vitest";
import { isAllowedImageType, objectKey } from "../storage";

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
