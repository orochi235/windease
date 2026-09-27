import { expect, test } from '@playwright/test';
import { boxOf, centerOf, dragMouse, openStory, settledBox } from './fixtures.js';

const STORY = 'split-operation--split-and-unsplit';

const panels = (page: import('@playwright/test').Page) => page.locator('[data-node^="p"]');

/** Every panel's box once it has settled. Panels are the leaves — groups render
 *  nothing of their own, so `[data-node]` on a panel is the visible rect. */
async function panelBoxes(page: import('@playwright/test').Page) {
  const locators = await panels(page).all();
  return Promise.all(locators.map((l) => settledBox(l)));
}

/** The same boxes as they stand, for a poll to retry. */
async function panelBoxesNow(page: import('@playwright/test').Page) {
  const locators = await panels(page).all();
  return Promise.all(locators.map((l) => boxOf(l)));
}

test.describe('split operation', () => {
  test('repeated x splits tile without collapsing a pane', async ({ page }) => {
    await openStory(page, STORY);
    await page.getByTestId('split-x').click();
    await page.getByTestId('split-x').click();
    await expect(panels(page)).toHaveCount(3);

    const boxes = (await panelBoxes(page)).sort((a, b) => a.x - b.x);
    // splitStrategy's buildTree gave panel k a width of W / 2^k, so the third
    // pane collapsed. Every pane must have real width now.
    for (const b of boxes) expect(b.w).toBeGreaterThan(20);
    // And they must not overlap.
    for (let i = 1; i < boxes.length; i += 1) {
      expect(boxes[i]!.x).toBeGreaterThanOrEqual(boxes[i - 1]!.x + boxes[i - 1]!.w - 1);
    }
  });

  test("direction 'both' produces a 2x2", async ({ page }) => {
    await openStory(page, STORY);
    await page.getByTestId('split-both').click();
    await expect(panels(page)).toHaveCount(4);

    const boxes = await panelBoxes(page);
    const xs = new Set(boxes.map((b) => Math.round(b.x)));
    const ys = new Set(boxes.map((b) => Math.round(b.y)));
    expect(xs.size).toBe(2);
    expect(ys.size).toBe(2);
    for (const b of boxes) {
      expect(b.w).toBeGreaterThan(20);
      expect(b.h).toBeGreaterThan(20);
    }
  });

  test('dragging a gutter moves space between panes and conserves the total', async ({ page }) => {
    await openStory(page, STORY);
    await page.getByTestId('split-x').click();
    await expect(panels(page)).toHaveCount(2);

    const before = (await panelBoxes(page)).sort((a, b) => a.x - b.x);
    const totalBefore = before.reduce((sum, b) => sum + b.w, 0);
    // strip emits a trailing-edge affordance on every non-last child.
    const gutter = await settledBox(page.locator('[data-affordance-hit^="resize-x-"]').first());
    const start = centerOf(gutter);

    await dragMouse(page, start, { x: start.x + 100, y: start.y });

    await expect
      .poll(async () => (await panelBoxesNow(page)).sort((a, b) => a.x - b.x)[0]?.w)
      .toBeGreaterThan(before[0]!.w + 60);
    const after = await panelBoxes(page);
    expect(after.reduce((sum, b) => sum + b.w, 0)).toBeCloseTo(totalBefore, 0);
  });

  test('unsplit returns the tree to its previous shape', async ({ page }) => {
    await openStory(page, STORY);
    await expect(panels(page)).toHaveCount(1);

    await page.getByTestId('split-y').click();
    await expect(panels(page)).toHaveCount(2);

    await page.getByTestId('unsplit').click();
    await expect(panels(page)).toHaveCount(2);

    // unsplit dissolves the group, it does not destroy children — both panels
    // come back up to the root strip, now side by side on its x axis.
    await expect
      .poll(async () => {
        const [first, second] = await panelBoxesNow(page);
        return Math.round(first?.y ?? Number.NaN) - Math.round(second?.y ?? Number.NaN);
      })
      .toBe(0);
  });
});
