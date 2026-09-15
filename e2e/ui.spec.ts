import { expect, test } from "@playwright/test";
import { settled, within } from "./helpers";
import { reseed } from "./reseed";
import { seed } from "./seed-data";

// This file's games must be fresh regardless of spec order or which project runs it (it
// runs under both `chromium` and `mobile`): reseed here instead of relying on whatever the
// other specs left behind in e2e/.auth/seed.json.
test.beforeAll(() => {
  const { user } = seed();
  reseed(user.id, user.email);
});

test("confirm dialog traps focus and closes on Escape", async ({ page }) => {
  const s = seed();
  await page.goto(`/g/${s.theirs.active.publicId}`);
  await page.getByRole("button", { name: "Start" }).click();
  const canvas = page.getByTestId("marker-canvas");
  await settled(canvas);
  for (const [x, y] of [
    [0.2, 0.2],
    [0.5, 0.5],
    [0.8, 0.8],
  ] as const) {
    const p = await within(canvas, x, y);
    await page.mouse.click(p.x, p.y);
  }
  await page.getByTestId("submit").click();
  const dialog = page.getByTestId("confirm-submit");
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect(dialog.locator(":focus")).toHaveCount(1); // focus never left the dialog
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});

test("play page fits a phone: no horizontal scroll, Submit and Timer visible without scrolling", async ({ page, isMobile }) => {
  test.skip(!isMobile, "mobile project only");
  const s = seed();
  await page.goto(`/g/${s.theirs.active.publicId}`);
  // The dialog test above starts (but does not submit) an attempt on this same game; elapsed
  // time is server-anchored and never pauses, so a second visit may land straight on the play
  // canvas with no Start button. Handle both: a fresh visit shows Start, a resumed one doesn't.
  const start = page.getByRole("button", { name: "Start" });
  const canvas = page.getByTestId("marker-canvas");
  await start.or(canvas).first().waitFor({ state: "visible" });
  if (await start.isVisible()) await start.click();
  await settled(canvas);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBe(0);
  await expect(page.getByTestId("submit")).toBeInViewport();
  await expect(page.getByTestId("timer")).toBeInViewport();
});

test("publish gate lists blockers and clears them", async ({ page }) => {
  const s = seed();
  await page.goto(`/games/${s.mine.draft.id}`);
  const canvas = page.getByTestId("marker-canvas");
  await settled(canvas);

  // The seeded draft starts with one object already unconfirmed (see author.spec.ts).
  // Nudging the first marker commits a position write, un-confirming a second object.
  const marker = page.getByTestId("marker").first();
  await marker.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByText("Saving…")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Publish" })).toBeDisabled();
  await expect(page.getByTestId("publish-blockers")).toContainText(/confirm 2 objects/i);

  const confirm = () => page.getByRole("button", { name: "Confirm", exact: true }).and(page.locator(":enabled")).first();
  await confirm().click();
  await expect(page.getByTestId("publish-blockers")).toContainText(/confirm 1 object/i);
  await confirm().click();
  await expect(page.getByTestId("publish-blockers")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Publish" })).toBeEnabled();
});
