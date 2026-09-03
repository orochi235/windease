import { expect, type Page, test } from '@playwright/test';
import { openStory } from './fixtures.js';

/**
 * `channels` is the one thing a unit test cannot show end to end: a number the
 * strategy attaches, the core carries without reading, and a component applies.
 * These assert it survives the whole trip and moves when the layout re-runs.
 */

const STORY = 'channels--receding-row';

const opacities = (page: Page) =>
  page.getByTestId('card').evaluateAll((els) => els.map((e) => e.textContent!.trim()));

test.describe('channels', () => {
  test('a strategy value reaches the component that renders it', async ({ page }) => {
    await openStory(page, STORY);
    // The ramp is the strategy's, not the DOM's — nothing between them read it.
    expect(await opacities(page)).toEqual(['1.00', '0.80', '0.60', '0.40', '0.20']);
  });

  test('republishes when config changes the values', async ({ page }) => {
    await openStory(page, STORY);
    await page.getByRole('button', { name: /fade from/ }).click();
    await expect
      .poll(() => opacities(page))
      .toEqual(['0.20', '0.40', '0.60', '0.80', '1.00']);
  });

  test('recomputes every channel when the child set changes', async ({ page }) => {
    await openStory(page, STORY);
    await page.getByRole('button', { name: 'add card' }).click();
    // Six cards, and every value moved — the ramp is over the new count, not
    // the old one with an entry appended.
    await expect
      .poll(() => opacities(page))
      .toEqual(['1.00', '0.84', '0.68', '0.52', '0.36', '0.20']);
  });
});
