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

test("the master of an active game is sent to its edit page, not the play surface (SPEC §11)", async ({ page }) => {
  const { active } = seed().mine;
  await page.goto(`/g/${active.publicId}`);
  await expect(page).toHaveURL(new RegExp(`/games/${active.id}$`));
  await expect(page.getByText("active", { exact: true })).toBeVisible();
  await expect(page.getByTestId("marker-canvas")).toHaveAttribute("data-mode", "reveal");
});

test("a signed-out visitor sees the Start screen with a sign-in prompt and no canvas", async ({ browser }) => {
  const context = await browser.newContext({ storageState: undefined });
  try {
    const page = await context.newPage();
    await page.goto(`/g/${seed().theirs.active.publicId}`);
    await expect(page.getByRole("link", { name: "Sign in to start" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Start" })).toHaveCount(0);
    await expect(page.getByTestId("object-rail").locator("li")).toHaveCount(3);
    await expect(page.getByTestId("marker-canvas")).toHaveCount(0);
  } finally {
    await context.close();
  }
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
