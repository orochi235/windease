import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { openStory } from './fixtures.js';

const STORY = 'playground--playground';

function focusedNode(page: Page) {
  return page.evaluate(
    () => document.activeElement?.closest('[data-node]')?.getAttribute('data-node') ?? null,
  );
}

test.describe('keyboard navigation', () => {
  test('the whole tree costs one tab stop', async ({ page }) => {
    await openStory(page, STORY);
    const stops = await page.locator('[data-node][tabindex="0"]').count();
    expect(stops).toBe(1);
  });

  test('an arrow key moves focus between windows', async ({ page }) => {
    await openStory(page, STORY);
    await page.locator('[data-node][tabindex="0"]').focus();
    const before = await focusedNode(page);
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => focusedNode(page)).not.toBe(before);
  });

  test('F6 cycles from inside a text input', async ({ page }) => {
    await openStory(page, STORY);
    await page.locator('[data-node][tabindex="0"]').focus();
    const before = await focusedNode(page);
    await page.keyboard.press('F6');
    await expect.poll(() => focusedNode(page)).not.toBe(before);
  });

  test('focus survives destroying the focused panel', async ({ page }) => {
    await openStory(page, STORY);
    await page.locator('[data-node][tabindex="0"]').focus();
    const doomed = await focusedNode(page);
    await page.evaluate((id) => {
      const w = window as unknown as { __store?: { unregisterNode: (i: string) => void } };
      w.__store?.unregisterNode(id as string);
    }, doomed);
    await expect.poll(() => focusedNode(page)).not.toBeNull();
  });
});
