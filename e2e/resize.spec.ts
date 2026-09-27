import { expect, type Page, test } from '@playwright/test';
import { boxOf, centerOf, dragMouse, openStory, settledBox } from './fixtures.js';

const STORY = 'recursive-zones--split-resize';

// Gutter ids come from strip's own affordances: `resize-<axis>-<childId>`,
// emitted after every non-last child. The root strip is a/g1 (x axis); the
// nested group g1 is b/g2 (y axis).
const ROOT_GUTTER = '[data-affordance-hit="resize-x-a"]';
const MID_GUTTER = '[data-affordance-hit="resize-y-b"]';

const widthOf = async (page: Page, id: string) =>
  (await boxOf(page.locator(`[data-node="${id}"]`))).w;

test.describe('split resize', () => {
  test('dragging the root gutter right widens the left pane', async ({ page }) => {
    await openStory(page, STORY);
    const before = await settledBox(page.locator('[data-node="a"]'));
    const gutter = await settledBox(page.locator(ROOT_GUTTER));

    await dragMouse(page, centerOf(gutter), { x: centerOf(gutter).x + 120, y: centerOf(gutter).y });

    await expect.poll(() => widthOf(page, 'a')).toBeGreaterThan(before.w + 80);
    // The sibling absorbs the change rather than the container growing.
    await expect
      .poll(async () => (await boxOf(page.locator('[data-node="b"]'))).x)
      .toBeGreaterThan(before.x + before.w);
  });

  test('dragging the horizontal gutter down grows the pane above it', async ({ page }) => {
    await openStory(page, STORY);
    const before = await settledBox(page.locator('[data-node="b"]'));
    const gutter = await settledBox(page.locator(MID_GUTTER));

    await dragMouse(page, centerOf(gutter), { x: centerOf(gutter).x, y: centerOf(gutter).y + 90 });

    await expect
      .poll(async () => (await boxOf(page.locator('[data-node="b"]'))).h)
      .toBeGreaterThan(before.h + 60);
  });

  test('the drag keeps tracking after the pointer leaves the gutter', async ({ page }) => {
    // setPointerCapture is the only reason this works; jsdom cannot show it.
    await openStory(page, STORY);
    const before = await settledBox(page.locator('[data-node="a"]'));
    const gutter = await settledBox(page.locator(ROOT_GUTTER));
    const start = centerOf(gutter);

    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    // Well outside the 14px-wide hit area, and off its vertical extent too.
    await page.mouse.move(start.x + 150, start.y - 200, { steps: 15 });
    await page.mouse.up();

    await expect.poll(() => widthOf(page, 'a')).toBeGreaterThan(before.w + 100);
  });
});
