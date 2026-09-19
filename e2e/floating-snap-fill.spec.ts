import { expect, type Page, test } from '@playwright/test';
import { boxOf, centerOf, dragMouse, openStory, settledBox } from './fixtures.js';

/** `snap: 'fill'`: a floating legend dropped on a pane fills it, FancyZones-style. */

const STORY = 'floating--snap-fill';
const LEGEND = '[data-node="legend"]';
const HANDLE = '[data-affordance-hit="floating:drag:legend"]';
const pane = (page: Page, n: number) => page.locator(`[data-node="panel-${n}"]`);

const near = (a: number, b: number) => Math.abs(a - b) <= 1;
function sameBox(a: { x: number; y: number; w: number; h: number }, b: typeof a) {
  return near(a.x, b.x) && near(a.y, b.y) && near(a.w, b.w) && near(a.h, b.h);
}

async function dropOnPane(page: Page, n: number) {
  const handle = await boxOf(page.locator(HANDLE));
  await dragMouse(page, centerOf(handle), centerOf(await boxOf(pane(page, n))));
}

test.describe("floating snap: 'fill'", () => {
  test('dropping the legend on a pane fills that pane', async ({ page }) => {
    await openStory(page, STORY);
    await dropOnPane(page, 2);
    const target = await settledBox(pane(page, 2));
    expect(sameBox(await settledBox(page.locator(LEGEND)), target)).toBe(true);
  });

  test('the legend follows its pane when the grid reflows', async ({ page }) => {
    await openStory(page, STORY);
    await dropOnPane(page, 1);
    const before = await settledBox(pane(page, 1));
    await page.locator('[data-testid="add-pane"]').click();
    await expect(pane(page, 5)).toBeVisible();
    const after = await settledBox(pane(page, 1));
    expect(after.h).toBeLessThan(before.h - 10);
    expect(sameBox(await settledBox(page.locator(LEGEND)), after)).toBe(true);
  });

  test('dragging it off the pane frees it back to its own size', async ({ page }) => {
    await openStory(page, STORY);
    const own = await settledBox(page.locator(LEGEND));
    await dropOnPane(page, 4);
    expect((await settledBox(page.locator(LEGEND))).w).toBeGreaterThan(own.w);

    // The gap between the panes belongs to none of them.
    const p1 = await boxOf(pane(page, 1));
    const p2 = await boxOf(pane(page, 2));
    const handle = await boxOf(page.locator(HANDLE));
    await dragMouse(page, centerOf(handle), { x: (p1.x + p1.w + p2.x) / 2, y: p1.y + 20 });
    const freed = await settledBox(page.locator(LEGEND));
    expect(Math.round(freed.w)).toBe(Math.round(own.w));
    expect(Math.round(freed.h)).toBe(Math.round(own.h));
  });
});
