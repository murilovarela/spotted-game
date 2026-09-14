import { expect, test } from "@playwright/test";
import { centerOf, drag, settled, within } from "./helpers";
import { seed } from "./seed-data";

test("master positions by dragging, confirms, and publishes", async ({ page }) => {
  const { draft } = seed().mine;
  await page.goto(`/games/${draft.id}`);
  const canvas = page.getByTestId("marker-canvas");
  await expect(canvas).toHaveAttribute("data-mode", "author");
  await settled(canvas);
  const markers = page.getByTestId("marker");
  await expect(markers).toHaveCount(3);
  const badge = (text: "confirmed" | "unconfirmed") => page.getByText(text, { exact: true });
  await expect(badge("unconfirmed")).toHaveCount(1);

  // Invariant 4 at the UI: publish is refused while any object is unconfirmed.
  await page.getByRole("button", { name: "Publish" }).click();
  // Next's route announcer is also role="alert", so narrow to the one carrying the message.
  await expect(page.getByRole("alert").filter({ hasText: /not confirmed/ })).toBeVisible();
  await settled(canvas); // the redirect re-rendered the page with fresh image URLs

  // A click that does not move the marker is not a change: no save, badge untouched (zero-delta guard).
  const still = await centerOf(markers.nth(0));
  await page.mouse.move(still.x, still.y);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(300);
  await expect(page.getByText("Saving…")).toHaveCount(0);
  await expect(badge("unconfirmed")).toHaveCount(1);

  // A radius-handle click that does not move it is the same zero-delta guard, handle kind:
  // no resize callback, so a confirmed marker stays confirmed.
  const handle = markers.nth(0).getByTestId("radius-handle");
  const handleCentre = await centerOf(handle);
  await page.mouse.move(handleCentre.x, handleCentre.y);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(300);
  await expect(page.getByText("Saving…")).toHaveCount(0);
  await expect(badge("unconfirmed")).toHaveCount(1);

  // Moving a confirmed object un-confirms it (Phase 1 rule, visible here).
  await drag(page, markers.nth(0), await within(canvas, 0.4, 0.4));
  await expect(badge("unconfirmed")).toHaveCount(2);

  // Confirm each row, then publish.
  for (let i = 0; i < 3; i++) {
    // exact: the object chips are named "<label> (unconfirmed)", which a substring match would also hit.
    const next = page.getByRole("button", { name: "Confirm", exact: true }).and(page.locator(":enabled")).first();
    if ((await next.count()) === 0) break;
    await next.click();
    await expect(badge("unconfirmed")).toHaveCount(Math.max(0, 1 - i));
  }
  await expect(badge("unconfirmed")).toHaveCount(0);
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("scheduled", { exact: true })).toBeVisible();
  await expect(canvas).toHaveAttribute("data-mode", "reveal");
});
