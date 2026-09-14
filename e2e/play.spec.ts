import { expect, test } from "@playwright/test";
import { centerOf, drag, settled, within } from "./helpers";
import { seed } from "./seed-data";

const GENERATED = /\/generated\//;
const TEXTUAL = /text\/html|text\/x-component|application\/json|javascript/;

test("plays a seeded game to a scored submission", async ({ page }) => {
  const { theirs } = seed();
  const url = `/g/${theirs.active.publicId}`;

  // Invariant (handoff "image before Start"): nothing the browser receives before Start
  // references the generated image. Checked on the wire, not in the DOM.
  let started = false;
  const checks: Promise<string | null>[] = [];
  page.on("response", (res) => {
    if (started || !TEXTUAL.test(res.headers()["content-type"] ?? "")) return;
    checks.push(res.text().then((body) => (GENERATED.test(body) ? res.url() : null)).catch(() => null));
  });

  await page.goto(url);
  const startButton = page.getByRole("button", { name: "Start" });
  await expect(startButton).toBeVisible();
  await expect(page.getByText(/does not pause/)).toBeVisible();
  await expect(page.getByTestId("object-rail").locator("li")).toHaveCount(3);
  await expect(page.getByTestId("marker-canvas")).toHaveCount(0);
  expect((await Promise.all(checks)).filter(Boolean), "generated image reached the client before Start").toEqual([]);

  started = true;
  await startButton.click();
  const canvas = page.getByTestId("marker-canvas");
  await expect(canvas).toBeVisible();
  await expect(page.getByTestId("timer")).toBeVisible();
  await settled(canvas);
  const markers = page.getByTestId("marker");
  const submit = page.getByTestId("submit");

  // Add up to N; the N+1th click is ignored.
  for (const [fx, fy] of [[0.25, 0.3], [0.62, 0.55]]) {
    const p = await within(canvas, fx, fy);
    await page.mouse.click(p.x, p.y);
  }
  await expect(markers).toHaveCount(2);
  await expect(page.getByTestId("marker-count")).toHaveText("2 / 3 markers");
  await expect(submit).toBeDisabled();
  const wrong = await within(canvas, 0.1, 0.9);
  await page.mouse.click(wrong.x, wrong.y);
  await expect(markers).toHaveCount(3);
  await expect(submit).toBeEnabled();
  const extra = await within(canvas, 0.5, 0.5);
  await page.mouse.click(extra.x, extra.y);
  await expect(markers).toHaveCount(3);

  // Drag the wrong one onto the third object; drag the first into the trash; re-add it.
  await drag(page, markers.nth(2), await within(canvas, 0.8, 0.2));
  const trash = page.getByTestId("trash-zone");
  await trash.scrollIntoViewIfNeeded(); // it sits just below the fold; the pointer must be able to reach it
  await drag(page, markers.nth(0), await centerOf(trash));
  await expect(markers).toHaveCount(2);
  await expect(submit).toBeDisabled();
  const first = await within(canvas, 0.25, 0.3);
  await page.mouse.click(first.x, first.y);
  await expect(markers).toHaveCount(3);

  // Submit is confirmed, and the response carries no coordinates.
  const submitResponse = page.waitForResponse((r) => r.request().method() === "POST" && r.url().includes(url));
  await submit.click();
  await expect(page.getByTestId("confirm-submit")).toBeVisible();
  await page.getByTestId("confirm-submit-yes").click();
  const body = await (await submitResponse).text();
  expect(body).not.toMatch(/"radius"|"x":\s*0\./);

  await expect(page.getByTestId("result")).toContainText("Found 3 of 3");
  await expect(page.getByTestId("leaderboard").locator("tr[data-viewer]")).toHaveCount(1);

  // One shot: reloading shows the result again, never the canvas.
  await page.reload();
  await expect(page.getByTestId("result")).toBeVisible();
  await expect(page.getByTestId("marker-canvas")).toHaveCount(0);
});
