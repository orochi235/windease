import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { boxOf, centerOf, openStory } from './fixtures.js';

const STORY = 'playground--playground';

/** The node holding the roving tab stop — the React layer's record of which
 *  node is focused, and what a reparenting re-render is most likely to lose. */
function rovingNode(page: Page) {
  return page.evaluate(
    () => document.querySelector('[data-node][tabindex="0"]')?.getAttribute('data-node') ?? null,
  );
}

/** Where the keyboard caret actually is, which is a separate question. */
function activeNode(page: Page) {
  return page.evaluate(
    () => document.activeElement?.closest('[data-node]')?.getAttribute('data-node') ?? null,
  );
}

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

function focusModel(page: Page, nodeId: string) {
  return page.evaluate((id) => {
    (window as unknown as { __store?: { focusNode: (i: string) => void } }).__store?.focusNode(id);
  }, nodeId);
}

async function dragTo(page: Page, handleFor: string, targetContainer: string) {
  const handle = centerOf(await boxOf(page.locator(`[data-windease-drag-handle="${handleFor}"]`)));
  const target = centerOf(await boxOf(page.locator(`[data-node-container="${targetContainer}"]`)));
  await page.mouse.move(handle.x, handle.y);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 15 });
  await page.mouse.up();
}

/**
 * A drop reparents a node, unmounting and remounting its wrapper under a
 * different container. Nothing else in the suite watches focus across that.
 */
test.describe('focus across a drag', () => {
  test('grabbing a pane focuses it', async ({ page }) => {
    await openStory(page, STORY);
    await focusModel(page, 'panel-1');
    await expect.poll(() => rovingNode(page)).toBe('panel-1');

    await dragTo(page, 'panel-2', 'sidebar');

    // Not a DnD rule: the pointerdown focuses the wrapper and `focusin` tells
    // the store, the same path a plain click takes.
    await expect.poll(() => rovingNode(page)).toBe('panel-2');
  });

  test('the dragged node keeps the tab stop after it reparents', async ({ page }) => {
    await openStory(page, STORY);
    await dragTo(page, 'panel-1', 'sidebar');

    await expect.poll(() => zoneOf(page, 'panel-1')).toBe('sidebar');
    expect(await rovingNode(page)).toBe('panel-1');
  });

  test('a cancelled drag leaves the node and the tab stop where they were', async ({ page }) => {
    await openStory(page, STORY);
    const handle = centerOf(await boxOf(page.locator('[data-windease-drag-handle="panel-1"]')));
    const target = centerOf(await boxOf(page.locator('[data-node-container="sidebar"]')));
    await page.mouse.move(handle.x, handle.y);
    await page.mouse.down();
    await page.mouse.move(target.x, target.y, { steps: 15 });
    await page.keyboard.press('Escape');
    await page.mouse.up();

    expect(await zoneOf(page, 'panel-1')).toBe('main');
    expect(await rovingNode(page)).toBe('panel-1');
  });

  test('DOM focus survives the remount, not just the model', async ({ page }) => {
    await openStory(page, STORY);
    await dragTo(page, 'panel-1', 'sidebar');

    await expect.poll(() => zoneOf(page, 'panel-1')).toBe('sidebar');
    await expect.poll(() => activeNode(page)).toBe('panel-1');
  });
});
