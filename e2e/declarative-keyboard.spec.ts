import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { openStory } from './fixtures.js';

const STORY = 'declarative--keyboard-nav';

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

/** Top-to-bottom order of the left column's panes, read off their rendered
 *  positions rather than the store. */
async function leftColumnOrder(page: Page): Promise<string[]> {
  const ids = ['kb-a', 'kb-b', 'kb-c'];
  const withTops: Array<{ id: string; top: number }> = [];
  for (const id of ids) {
    const box = await page.locator(`[data-node="${id}"]`).boundingBox();
    if (!box) throw new Error(`${id} has no box`);
    withTops.push({ id, top: box.y });
  }
  return withTops.sort((a, b) => a.top - b.top).map((e) => e.id);
}

test.describe('preset-built tree', () => {
  // Nothing here uses <Container>: the geometry the resolver scores comes from
  // the Zone and Panel presets reporting their own children.
  test('an arrow key crosses from the Zone column to the Panel column', async ({ page }) => {
    await openStory(page, STORY);
    await page.locator('[data-node="kb-a"]').click();
    await expect.poll(() => focusedNode(page)).toBe('kb-a');

    await page.keyboard.press('ArrowRight');

    // kb-a is the top of three; kb-d is the top of two, so it is the nearer of
    // the right column's panes.
    await expect.poll(() => focusedNode(page)).toBe('kb-d');
  });

  test('an arrow key moves the caret down a column', async ({ page }) => {
    await openStory(page, STORY);
    await page.locator('[data-node="kb-a"]').click();
    await expect.poll(() => focusedNode(page)).toBe('kb-a');

    await page.keyboard.press('ArrowDown');

    await expect.poll(() => focusedNode(page)).toBe('kb-b');
  });

  test('shift+arrow moves the pane itself', async ({ page }) => {
    await openStory(page, STORY);
    expect(await leftColumnOrder(page)).toEqual(['kb-a', 'kb-b', 'kb-c']);
    await page.locator('[data-node="kb-a"]').click();
    await expect.poll(() => focusedNode(page)).toBe('kb-a');

    await page.keyboard.press('Shift+ArrowDown');

    await expect.poll(() => leftColumnOrder(page)).toEqual(['kb-b', 'kb-a', 'kb-c']);
    await expect.poll(() => focusedNode(page)).toBe('kb-a');
  });

  test('an arrow key at the outer edge is inert', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await openStory(page, STORY);
    await page.locator('[data-node="kb-e"]').click();
    await expect.poll(() => focusedNode(page)).toBe('kb-e');

    await page.keyboard.press('ArrowRight');
    await settleFrames(page);

    expect(await focusedNode(page)).toBe('kb-e');
    expect(errors).toEqual([]);
  });
});
