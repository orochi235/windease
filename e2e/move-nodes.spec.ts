import { expect, type Page, test } from '@playwright/test';
import { openStory } from './fixtures.js';

/**
 * `moveNodes` differs from a `moveNode` loop in two ways a unit test can assert
 * but a host only meets through a gesture: the run keeps its order against one
 * insertion point, and a lock is found before anything moves rather than
 * halfway through.
 */

const STORY = 'store--moving-several-nodes--one-batch-versus-a-loop';

const board = (page: Page, which: 'loop' | 'batch') =>
  page.locator(`.pol-row > div:nth-child(${which === 'loop' ? 1 : 2})`);

const order = (page: Page, which: 'loop' | 'batch', parent: 'src' | 'dock') =>
  board(page, which).getByTestId(`order-${parent}`);

/** Charlie starts unlocked; the second test is the one that needs the lock. */
async function lockCharlie(page: Page): Promise<void> {
  await page.getByTestId('lock-charlie').check();
}

test.describe('moveNodes', () => {
  test('the run keeps source order against one insertion point', async ({ page }) => {
    await openStory(page, STORY);

    await board(page, 'loop').getByTestId('move-loop').click();
    await board(page, 'batch').getByTestId('move-batch').click();

    // The loop inserts each node at 0 in turn, so the run lands reversed.
    await expect(order(page, 'loop', 'dock')).toHaveText('charlie bravo alpha echo');
    await expect(order(page, 'batch', 'dock')).toHaveText('alpha bravo charlie echo');
  });

  test('a lock halfway down the set leaves the loop partly applied', async ({ page }) => {
    await openStory(page, STORY);
    await lockCharlie(page);

    await board(page, 'loop').getByTestId('move-loop').click();
    await board(page, 'batch').getByTestId('move-batch').click();

    // Both refuse, but only the batch refuses before mutating anything.
    await expect(board(page, 'loop').getByTestId('error-loop')).toContainText('LockedError');
    await expect(board(page, 'batch').getByTestId('error-batch')).toContainText('LockedError');

    await expect(order(page, 'loop', 'dock')).toHaveText('bravo alpha echo');
    await expect(order(page, 'loop', 'src')).toHaveText('charlie delta');

    await expect(order(page, 'batch', 'dock')).toHaveText('echo');
    await expect(order(page, 'batch', 'src')).toHaveText('alpha bravo charlie delta');
  });
});
