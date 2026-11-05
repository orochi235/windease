import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { boxOf, centerOf, dragMouse, dropAt, openStory, settledBox } from './fixtures.js';

const STORY = 'paged-grid--cell-drop';
const BAR = 28;

const card = (page: Page, id: string) => page.locator(`[data-node="${id}"]`);
const board = (page: Page) => page.locator('[data-node-container="board"]');

function shown(page: Page, containerId: string) {
  return page.evaluate(
    (id) =>
      [...document.querySelectorAll(`[data-node-container="${id}"] > [data-node]`)].map((el) =>
        el.getAttribute('data-node'),
      ),
    containerId,
  );
}

/** The center of cell (col, row) of the 3×2 grid, above the page bar. */
async function cellCenter(page: Page, col: number, row: number) {
  const b = await settledBox(board(page));
  const h = b.h - BAR;
  return dropAt({ x: b.x + (b.w * (col + 0.5)) / 3, y: b.y + (h * (row + 0.5)) / 2 });
}

test.describe('paged grid — drops', () => {
  test('a full page refuses a drop', async ({ page }) => {
    await openStory(page, STORY);
    await expect.poll(() => shown(page, 'board')).toHaveLength(6);
    const from = centerOf(await settledBox(card(page, 'new-1').locator('.pages-window__bar')));
    const to = await cellCenter(page, 1, 0);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 12 });
    await expect(page.locator('[data-drop-rejected]')).not.toHaveCount(0);
    await page.mouse.up();
    await expect.poll(() => shown(page, 'inbox')).toContain('new-1');
    await expect.poll(() => shown(page, 'board')).not.toContain('new-1');
  });

  test('on a page with room, a card lands in the cell it is dropped on', async ({ page }) => {
    await openStory(page, STORY);
    await page.getByRole('button', { name: 'Page 2 of 2' }).click();
    await expect.poll(() => shown(page, 'board')).toEqual(['room-1', 'room-2']);
    const from = centerOf(await settledBox(card(page, 'new-1').locator('.pages-window__bar')));
    await dragMouse(page, from, await cellCenter(page, 0, 1));
    await expect.poll(() => shown(page, 'board')).toContain('new-1');
    // Bottom left. Flow would fill (1, 0) first, so only cell targeting puts it here.
    await expect
      .poll(async () => {
        const b = await boxOf(board(page));
        const c = centerOf(await boxOf(card(page, 'new-1')));
        return [Math.floor(((c.x - b.x) / b.w) * 3), Math.floor(((c.y - b.y) / (b.h - BAR)) * 2)];
      })
      .toEqual([0, 1]);
    await page.getByRole('button', { name: 'Page 1 of 2' }).click();
    await expect.poll(() => shown(page, 'board')).not.toContain('new-1');
  });
});
