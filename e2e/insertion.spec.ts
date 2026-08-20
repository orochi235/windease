import { expect, test } from '@playwright/test';
import { boxOf, centerOf, openStory } from './fixtures.js';

/**
 * Insertion ordering is only observable where `<Container>`'s own drop-target
 * registration survives. A consumer that calls `useDropTarget` for the same
 * zone id clobbers it — child effects run before parent effects — and every
 * drop appends instead.
 */
const STORY = 'playground--playground';

function orderIn(page: import('@playwright/test').Page, containerId: string) {
  return page.evaluate(
    (id) =>
      [...document.querySelectorAll(`[data-node-container="${id}"] [data-node]`)].map((e) =>
        e.getAttribute('data-node'),
      ),
    containerId,
  );
}

test.describe('drop insertion index', () => {
  test('a drop aimed at index 0 is routed around the pinned head', async ({ page }) => {
    await openStory(page, STORY);
    expect(await orderIn(page, 'main')).toEqual(['main-controls', 'panel-1', 'panel-2']);

    const handle = centerOf(await boxOf(page.locator('[data-windease-drag-handle="panel-2"]')));
    const first = await boxOf(page.locator('[data-node="main-controls"]'));

    await page.mouse.move(handle.x, handle.y);
    await page.mouse.down();
    // Above the first cell's midpoint, which the controller resolves to
    // insertIndex 0 — but `main-controls` is pinned there, so the pin holds
    // its slot and the incoming node takes the next one.
    await page.mouse.move(first.x + 8, first.y + 8, { steps: 15 });
    await page.mouse.up();

    await expect.poll(() => orderIn(page, 'main')).toEqual(['main-controls', 'panel-2', 'panel-1']);
  });

  test('dragging a panel into another zone lands it there', async ({ page }) => {
    await openStory(page, STORY);
    const handle = centerOf(await boxOf(page.locator('[data-windease-drag-handle="panel-1"]')));
    const sidebar = centerOf(await boxOf(page.locator('[data-node-container="sidebar"]')));

    await page.mouse.move(handle.x, handle.y);
    await page.mouse.down();
    await page.mouse.move(sidebar.x, sidebar.y, { steps: 15 });
    await page.mouse.up();

    await expect.poll(() => orderIn(page, 'sidebar')).toContain('panel-1');
    expect(await orderIn(page, 'main')).not.toContain('panel-1');
  });
});
