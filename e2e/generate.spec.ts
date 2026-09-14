import { expect, test } from "@playwright/test";

const FIX = "src/db/seed/fixtures";

/**
 * SPEC §8: a master goes from upload to published without touching a coordinate value.
 * Runs against the paste backend (GENERATION_MODE=paste, set on the webServer in
 * playwright.config.ts), so no Gemini call is made. The game it creates is left in the
 * database under an `[e2e]` prefix; a published game has no delete path in the UI.
 */
test("upload → generate → confirm → publish", async ({ page }) => {
  await page.goto("/games/new");
  await page.getByLabel(/title/i).fill("[e2e] generated game");
  await page.getByLabel(/prompt/i).fill("A plain test scene.");
  await page.getByRole("button", { name: /create/i }).click();
  await expect(page).toHaveURL(/\/games\/[0-9a-f-]{36}$/);

  await page.getByLabel("Upload background").setInputFiles(`${FIX}/background.png`);
  await expect(page.locator("img[alt='']").first()).toBeVisible();

  // The form remounts after each add (keyed on the object count), so "Add object" is disabled
  // again until the next upload has produced a key.
  const add = page.getByRole("button", { name: /add object/i });
  for (const [i, label] of ["Red ball", "Green box"].entries()) {
    await expect(add).toBeDisabled();
    await page.getByLabel(/^label/i).fill(label);
    await page.getByLabel("Object image").setInputFiles(`${FIX}/object-${i + 1}.png`);
    await expect(add).toBeEnabled();
    await add.click();
    await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
  }

  await page.getByTestId("generate").click();
  await expect(page.getByTestId("generation-state")).toHaveText(/passed/, { timeout: 60_000 });
  await expect(page.getByTestId("generation-run")).toHaveCount(1);
  await expect(page.getByTestId("marker-canvas")).toHaveAttribute("data-mode", "author");
  await expect(page.getByTestId("marker")).toHaveCount(2);
  await expect(page.getByText("unconfirmed", { exact: true })).toHaveCount(2);

  for (let i = 0; i < 2; i++) {
    // exact: the object chips are named "<label> (unconfirmed)", which a substring match would also hit.
    const next = page.getByRole("button", { name: "Confirm", exact: true }).and(page.locator(":enabled")).first();
    await next.click();
    await expect(page.getByText("unconfirmed", { exact: true })).toHaveCount(1 - i);
  }

  await page.getByLabel("Starts").fill("2030-01-01T10:00");
  await page.getByLabel("Ends").fill("2030-01-02T10:00");
  await page.getByRole("button", { name: /save window/i }).click();
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("scheduled", { exact: true })).toBeVisible();
});
