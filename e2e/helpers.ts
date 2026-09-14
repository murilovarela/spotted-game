import { expect, type Locator, type Page } from "@playwright/test";

export type Point = { x: number; y: number };

export async function boxOf(locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  const b = await locator.boundingBox();
  if (!b) throw new Error("element has no bounding box");
  return b;
}

/** Fractional position inside an element's box. */
export async function within(locator: Locator, fx: number, fy: number): Promise<Point> {
  const b = await boxOf(locator);
  return { x: b.x + b.width * fx, y: b.y + b.height * fy };
}

export async function centerOf(locator: Locator): Promise<Point> {
  return within(locator, 0.5, 0.5);
}

/** Pointer drag with intermediate moves so pointer capture and hit-testing behave like a real hand. */
export async function drag(page: Page, from: Locator, to: Point): Promise<void> {
  const start = await centerOf(from);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await page.mouse.up();
}

/**
 * Wait until every image on the page has finished loading and the canvas box has stopped
 * moving, then scroll the canvas fully into view. Images arrive from presigned URLs that
 * change on every server render, and some carry no dimensions (the master page's background
 * preview), so the page reflows after each navigation; a box measured before that is stale
 * by the time the pointer gets there. Pointer events outside the viewport are not hit-tested,
 * so a canvas below the fold must be scrolled to before any of its boxes are measured.
 */
export async function settled(canvas: Locator): Promise<void> {
  const page = canvas.page();
  await expect.poll(() => page.locator("img").evaluateAll((els) => els.every((el) => el instanceof HTMLImageElement && el.complete))).toBe(true);
  await expect.poll(() => canvas.locator("img").evaluate((el) => (el instanceof HTMLImageElement ? el.naturalWidth : 0))).toBeGreaterThan(0);
  let prev = await boxOf(canvas);
  for (let i = 0; ; i++) {
    if (i === 20) throw new Error("canvas layout did not settle");
    await page.waitForTimeout(100);
    const next = await boxOf(canvas);
    if (next.x === prev.x && next.y === prev.y && next.width === prev.width && next.height === prev.height) break;
    prev = next;
  }
  await canvas.scrollIntoViewIfNeeded();
}
