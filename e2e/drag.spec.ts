import { expect, test } from '@playwright/test';
import { boxOf, centerOf, openStory } from './fixtures.js';

const STORY = 'parallel-zones--drag-between';

/** Which container a node currently renders inside, per the DOM. */
function zoneOf(page: import('@playwright/test').Page, nodeId: string) {
  return page.evaluate(
    (id) =>
      document
        .querySelector(`[data-node="${id}"]`)
        ?.closest('[data-node-container]')
        ?.getAttribute('data-node-container') ?? null,
    nodeId,
  );
}

test.describe('drag between zones', () => {
  test('dropping a panel on the other zone reparents it', async ({ page }) => {
    await openStory(page, STORY);
    expect(await zoneOf(page, 'left-a')).toBe('left-zone');

    const handle = centerOf(await boxOf(page.locator('[data-windease-drag-handle="left-a"]')));
    const target = centerOf(await boxOf(page.locator('[data-node-container="right-zone"]')));

    await page.mouse.move(handle.x, handle.y);
    await page.mouse.down();
    await page.mouse.move(target.x, target.y, { steps: 15 });
    await page.mouse.up();

    await expect.poll(() => zoneOf(page, 'left-a')).toBe('right-zone');
  });

  test('escape mid-drag cancels without moving the node', async ({ page }) => {
    await openStory(page, STORY);
    const handle = centerOf(await boxOf(page.locator('[data-windease-drag-handle="left-a"]')));
    const target = centerOf(await boxOf(page.locator('[data-node-container="right-zone"]')));

    await page.mouse.move(handle.x, handle.y);
    await page.mouse.down();
    await page.mouse.move(target.x, target.y, { steps: 15 });
    await page.keyboard.press('Escape');
    await page.mouse.up();

    expect(await zoneOf(page, 'left-a')).toBe('left-zone');
  });

  test('releasing outside every drop target leaves the node put', async ({ page }) => {
    await openStory(page, STORY);
    const handle = centerOf(await boxOf(page.locator('[data-windease-drag-handle="left-b"]')));

    await page.mouse.move(handle.x, handle.y);
    await page.mouse.down();
    await page.mouse.move(5, 5, { steps: 15 });
    await page.mouse.up();

    expect(await zoneOf(page, 'left-b')).toBe('left-zone');
  });
});
