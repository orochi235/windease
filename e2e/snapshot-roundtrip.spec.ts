import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { boxOf, centerOf, dragMouse, openStory } from './fixtures.js';

const STORY = 'recursive-zones--split-resize';
const ROOT_GUTTER = '[data-affordance-hit="resize-x-a"]';
const MID_GUTTER = '[data-affordance-hit="resize-y-b"]';

interface Bridge {
  __store: unknown;
  __windease: {
    serialize: (s: unknown) => unknown;
    deserialize: (s: unknown, snap: unknown) => void;
  };
}

function snapshot(page: Page) {
  return page.evaluate(() => {
    const w = window as unknown as Bridge;
    return JSON.stringify(w.__windease.serialize(w.__store));
  });
}

function hydrate(page: Page, snap: string) {
  return page.evaluate((json) => {
    const w = window as unknown as Bridge;
    w.__windease.deserialize(w.__store, JSON.parse(json));
  }, snap);
}

const widthOf = (page: Page, id: string) =>
  boxOf(page.locator(`[data-node="${id}"]`)).then((b) => Math.round(b.w));
const heightOf = (page: Page, id: string) =>
  boxOf(page.locator(`[data-node="${id}"]`)).then((b) => Math.round(b.h));

/**
 * Resize state round-trips through `serialize` headlessly — that is unit
 * tested. What is not is whether hydrating it back puts the same pixels on
 * screen: the React layer has to tear down and rebuild against a store that
 * was emptied and refilled underneath it.
 */
test.describe('snapshot round-trip through the DOM', () => {
  test('a hydrated snapshot restores the pane widths it captured', async ({ page }) => {
    await openStory(page, STORY);
    const gutter = centerOf(await boxOf(page.locator(ROOT_GUTTER)));
    await dragMouse(page, gutter, { x: gutter.x + 120, y: gutter.y });

    const captured = await widthOf(page, 'a');
    const snap = await snapshot(page);

    const moved = centerOf(await boxOf(page.locator(ROOT_GUTTER)));
    await dragMouse(page, moved, { x: moved.x - 90, y: moved.y });
    expect(await widthOf(page, 'a')).toBeLessThan(captured - 40);

    await hydrate(page, snap);

    await expect.poll(() => widthOf(page, 'a')).toBe(captured);
  });

  test('it restores a nested container too, not just the root', async ({ page }) => {
    await openStory(page, STORY);
    const gutter = centerOf(await boxOf(page.locator(MID_GUTTER)));
    await dragMouse(page, gutter, { x: gutter.x, y: gutter.y + 90 });

    const captured = await heightOf(page, 'b');
    const snap = await snapshot(page);

    const moved = centerOf(await boxOf(page.locator(MID_GUTTER)));
    await dragMouse(page, moved, { x: moved.x, y: moved.y - 70 });
    expect(await heightOf(page, 'b')).toBeLessThan(captured - 30);

    await hydrate(page, snap);

    await expect.poll(() => heightOf(page, 'b')).toBe(captured);
  });

  test('every pane comes back, not just the sized one', async ({ page }) => {
    await openStory(page, STORY);
    const snap = await snapshot(page);
    await hydrate(page, snap);

    for (const id of ['a', 'b', 'c', 'd']) {
      await expect(page.locator(`[data-node="${id}"]`)).toBeVisible();
    }
  });
});
