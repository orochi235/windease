import { expect, type Page, test } from '@playwright/test';
import { openStory } from './fixtures.js';

/**
 * The live region is the whole feature: what a screen reader is handed when a
 * structural change moves no focus. jsdom can assert the text, but not that a
 * real click puts focus where the announcer reads it from.
 */

const STORY = 'announcements--live-region';

const region = (page: Page) => page.locator('.windease-live-region');

function focusedNode(page: Page) {
  return page.evaluate(
    () => document.activeElement?.closest('[data-node]')?.getAttribute('data-node') ?? null,
  );
}

async function focusPane(page: Page, id: string): Promise<void> {
  await page.locator(`[data-node="${id}"]`).click();
  await expect.poll(() => focusedNode(page)).toBe(id);
}

test('a closed pane is spoken by name', async ({ page }) => {
  await openStory(page, STORY);
  await expect(region(page)).toHaveText('');

  await focusPane(page, 'editor');
  await page.getByTestId('close').click();

  await expect(region(page)).toHaveText('Editor closed');
});

test('a relocation names the destination and the position in it', async ({ page }) => {
  await openStory(page, STORY);
  await focusPane(page, 'console');
  await page.getByTestId('move').click();

  await expect(region(page)).toHaveText(/Console moved to .*position \d+ of \d+/);
});

test('a reorder inside the same parent speaks the new position', async ({ page }) => {
  await openStory(page, STORY);
  await focusPane(page, 'console');
  await page.getByTestId('reorder').click();

  await expect(region(page)).toHaveText('Console moved to position 1 of 2');
});

test('announce={false} removes the region entirely', async ({ page }) => {
  await openStory(page, STORY);
  await page.getByTestId('announce').uncheck();
  await expect(region(page)).toHaveCount(0);

  // The gesture still works; it just says nothing.
  await focusPane(page, 'editor');
  await page.getByTestId('close').click();
  await expect(page.locator('[data-node="editor"]')).toHaveCount(0);
  await expect(region(page)).toHaveCount(0);
});
