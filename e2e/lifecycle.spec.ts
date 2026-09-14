import { expect, test } from "@playwright/test";
import { seed } from "./seed-data";

test("a scheduled game is 404 to a non-master", async ({ page }) => {
  const res = await page.goto(`/g/${seed().theirs.scheduled.publicId}`);
  expect(res?.status()).toBe(404);
});

test("a scheduled game renders for its master", async ({ page }) => {
  const { scheduled } = seed().mine;
  await page.goto(`/g/${scheduled.publicId}`);
  await expect(page).toHaveURL(new RegExp(`/games/${scheduled.id}$`));
  await expect(page.getByText("scheduled", { exact: true })).toBeVisible();
});

test("a finished game reveals positions and the final board", async ({ page }) => {
  await page.goto(`/g/${seed().theirs.finished.publicId}`);
  await expect(page.getByTestId("marker-canvas")).toHaveAttribute("data-mode", "reveal");
  await expect(page.getByTestId("marker")).toHaveCount(3);
  const rows = page.getByTestId("leaderboard").locator("tbody tr");
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText("Player 1"); // 3 found
  await expect(rows.nth(2)).toContainText("Player 3"); // 0 found, still listed (SPEC §3.4)
});
