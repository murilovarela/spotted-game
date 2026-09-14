import { describe, expect, it } from "vitest";
import { backendFromEnv } from "../backend";

describe("backendFromEnv", () => {
  it("selects the paste backend when GENERATION_MODE=paste", () => {
    const sel = backendFromEnv({ GENERATION_MODE: "paste" });
    expect(sel.ok).toBe(true);
    if (sel.ok) expect(sel.backend.name).toBe("paste");
  });

  it("rejects an unknown mode with a config reason", () => {
    const sel = backendFromEnv({ GENERATION_MODE: "banana" });
    expect(sel.ok).toBe(false);
    if (!sel.ok) expect(sel.reason).toMatch(/^config: .*banana/);
  });

  it("requires GEMINI_API_KEY in gemini mode (the default)", () => {
    const sel = backendFromEnv({});
    expect(sel).toEqual({ ok: false, reason: "config: GEMINI_API_KEY not set" });
  });

  it("builds a gemini backend when the key is present", () => {
    const sel = backendFromEnv({ GEMINI_API_KEY: "k", GEMINI_IMAGE_MODEL: "img-x" });
    expect(sel.ok).toBe(true);
    if (sel.ok) expect(sel.backend.name).toBe("gemini:img-x");
  });
});
