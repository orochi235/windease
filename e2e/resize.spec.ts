import { expect, test } from '@playwright/test';
import { boxOf, centerOf, dragMouse, openStory } from './fixtures.js';

const STORY = 'recursive-zones--split-resize';

// Gutter ids come from splitStrategy's walk over the SplitNode tree:
// '' is the root, '1' its b-side, '1.1' that side's own b-split.
const ROOT_GUTTER = '[data-affordance-hit="split-"]';
const MID_GUTTER = '[data-affordance-hit="split-1"]';

test.describe('split resize', () => {
  test('dragging the root gutter right widens the left pane', async ({ page }) => {
    await openStory(page, STORY);
    const before = await boxOf(page.locator('[data-node="a"]'));
    const gutter = await boxOf(page.locator(ROOT_GUTTER));

    await dragMouse(page, centerOf(gutter), { x: centerOf(gutter).x + 120, y: centerOf(gutter).y });

    const after = await boxOf(page.locator('[data-node="a"]'));
    expect(after.w).toBeGreaterThan(before.w + 80);
    // The sibling absorbs the change rather than the container growing.
    const b = await boxOf(page.locator('[data-node="b"]'));
    expect(b.x).toBeGreaterThan(before.x + before.w);
  });

  test('dragging the horizontal gutter down grows the pane above it', async ({ page }) => {
    await openStory(page, STORY);
    const before = await boxOf(page.locator('[data-node="b"]'));
    const gutter = await boxOf(page.locator(MID_GUTTER));

    await dragMouse(page, centerOf(gutter), { x: centerOf(gutter).x, y: centerOf(gutter).y + 90 });

    const after = await boxOf(page.locator('[data-node="b"]'));
    expect(after.h).toBeGreaterThan(before.h + 60);
  });

  test('the drag keeps tracking after the pointer leaves the gutter', async ({ page }) => {
    // setPointerCapture is the only reason this works; jsdom cannot show it.
    await openStory(page, STORY);
    const before = await boxOf(page.locator('[data-node="a"]'));
    const gutter = await boxOf(page.locator(ROOT_GUTTER));
    const start = centerOf(gutter);

    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    // Well outside the 14px-wide hit area, and off its vertical extent too.
    await page.mouse.move(start.x + 150, start.y - 200, { steps: 15 });
    await page.mouse.up();

    const after = await boxOf(page.locator('[data-node="a"]'));
    expect(after.w).toBeGreaterThan(before.w + 100);
  });
});
