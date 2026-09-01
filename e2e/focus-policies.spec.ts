import { expect, type Page, test } from '@playwright/test';
import { openStory } from './fixtures.js';

/**
 * `chooseSuccessor` and `resolveNavigation` both decide where the caret goes,
 * and both are only observable once a real focus move has happened — the store
 * consults them on destroy and on a key, not on render.
 */

const SUCCESSOR = 'policies--focus-successor--sending-focus-home';
const NAVIGATION = 'policies--navigation--wrapping-at-the-ends';

/** Each story pairs a built-in board with a policy-carrying one, so every
 *  assertion is a contrast rather than a bare value. */
const board = (page: Page, which: 'builtin' | 'custom') =>
  page.locator(`.pol-row > div:nth-child(${which === 'builtin' ? 1 : 2})`);

const focused = (page: Page, which: 'builtin' | 'custom') =>
  board(page, which).locator('.pol-readout code');

test.describe('chooseSuccessor', () => {
  test('a policy claims the destroy the built-in would answer differently', async ({ page }) => {
    await openStory(page, SUCCESSOR);
    await expect(focused(page, 'builtin')).toHaveText('Bravo');
    await expect(focused(page, 'custom')).toHaveText('Bravo');

    await board(page, 'builtin').getByTestId('close-bravo').click();
    await board(page, 'custom').getByTestId('close-bravo').click();

    // Built-in walks to the next visible sibling; the policy returns Home.
    await expect(focused(page, 'builtin')).toHaveText('Charlie');
    await expect(focused(page, 'custom')).toHaveText('Home');
  });

  test('a policy that defers on this reason leaves the built-in in charge', async ({ page }) => {
    await openStory(page, SUCCESSOR);

    // The same pane, hidden rather than destroyed: the policy returns
    // `undefined` for that reason, so both boards must agree.
    await board(page, 'builtin').getByTestId('hide-bravo').click();
    await board(page, 'custom').getByTestId('hide-bravo').click();

    await expect(focused(page, 'builtin')).toHaveText('Charlie');
    await expect(focused(page, 'custom')).toHaveText('Charlie');
  });
});

test.describe('resolveNavigation', () => {
  test('a policy reaches where geometry finds nothing', async ({ page }) => {
    await openStory(page, NAVIGATION);

    await board(page, 'builtin').getByLabel('Alpha').click();
    await page.keyboard.press('ArrowLeft');
    // Nothing is to the left of the first pane, and the built-in stops there.
    await expect(focused(page, 'builtin')).toHaveText('Alpha');

    await board(page, 'custom').getByLabel('Alpha').click();
    await page.keyboard.press('ArrowLeft');
    await expect(focused(page, 'custom')).toHaveText('Delta');
  });

  test('returning null refuses the move outright', async ({ page }) => {
    await openStory(page, NAVIGATION);

    await board(page, 'custom').getByLabel('Bravo').click();
    await expect(focused(page, 'custom')).toHaveText('Bravo');

    await page.keyboard.press('ArrowUp');
    await expect(focused(page, 'custom')).toHaveText('Bravo');
  });
});
