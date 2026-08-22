import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { openStory } from './fixtures.js';

const STORY = 'parallel-zones--drag-between';

function focusedNode(page: Page) {
  return page.evaluate(
    () => document.activeElement?.closest('[data-node]')?.getAttribute('data-node') ?? null,
  );
}

/** Let a keypress and the focus effect it schedules land before asserting. */
function settleFrames(page: Page) {
  return page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

/** Which container a node currently renders inside, per the DOM. */
function zoneOf(page: Page, nodeId: string) {
  return page.evaluate(
    (id) =>
      document
        .querySelector(`[data-node="${id}"]`)
        ?.closest('[data-node-container]')
        ?.getAttribute('data-node-container') ?? null,
    nodeId,
  );
}

test.describe('sibling root zones', () => {
  // The two zones are separate roots composed by the story's own flexbox, so
  // nothing in the store relates them — only the origins each root publishes.
  test('an arrow key crosses from one root zone to the other', async ({ page }) => {
    await openStory(page, STORY);
    await page.locator('[data-node="left-a"]').click();
    await expect.poll(() => focusedNode(page)).toBe('left-a');

    await page.keyboard.press('ArrowRight');

    // left-a is the top of three; right-a is the top of two, so it is the
    // nearer of the right zone's panes by a wide margin.
    await expect.poll(() => focusedNode(page)).toBe('right-a');
  });

  test('shift+arrow reparents a panel into the other root zone', async ({ page }) => {
    await openStory(page, STORY);
    expect(await zoneOf(page, 'left-b')).toBe('left-zone');
    await page.locator('[data-node="left-b"]').click();
    await expect.poll(() => focusedNode(page)).toBe('left-b');

    await page.keyboard.press('Shift+ArrowRight');

    await expect.poll(() => zoneOf(page, 'left-b')).toBe('right-zone');
    await expect.poll(() => focusedNode(page)).toBe('left-b');
  });

  test('an arrow key at the outer edge is inert', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await openStory(page, STORY);
    await page.locator('[data-node="right-b"]').click();
    await expect.poll(() => focusedNode(page)).toBe('right-b');

    await page.keyboard.press('ArrowRight');
    await settleFrames(page);

    expect(await focusedNode(page)).toBe('right-b');
    expect(await zoneOf(page, 'right-b')).toBe('right-zone');
    expect(errors).toEqual([]);
  });
});
