import { expect, type Page, test } from '@playwright/test';
import { openStory } from './fixtures.js';

/** A strict split refuses to leave a pane under its floor, as tmux says "no space for new pane". */

const STORY = 'split-operation--split-and-unsplit';
const panels = (page: Page) => page.locator('[data-node^="p"]');
const refused = (page: Page) => page.getByTestId('split-refused');

test.describe('strict split', () => {
  test('splits while the panes fit, then refuses and leaves the tree alone', async ({ page }) => {
    await openStory(page, STORY);
    await page.getByTestId('strict').check();

    await page.getByTestId('split-y').click();
    await expect(panels(page)).toHaveCount(2);
    await expect(refused(page)).toHaveText('');

    // The 440px host halves to 220px panes; two 120px floors no longer fit.
    await page.getByTestId('split-y').click();
    await expect(refused(page)).toContainText('No space for new pane');
    await expect(panels(page)).toHaveCount(2);
    for (const box of await Promise.all((await panels(page).all()).map((l) => l.boundingBox()))) {
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(120);
    }
  });

  test('without strict, the same split goes through', async ({ page }) => {
    await openStory(page, STORY);
    await page.getByTestId('split-y').click();
    await page.getByTestId('split-y').click();
    await expect(panels(page)).toHaveCount(3);
    await expect(refused(page)).toHaveText('');
  });
});
