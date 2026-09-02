import { expect, type Page, test } from '@playwright/test';
import { boxOf, centerOf, openStory, settledBox } from './fixtures.js';

/**
 * Both controlled props are defined by what does *not* happen: the gesture
 * hands the host a value and writes nothing. Refusing it is the assertion, and
 * a refusal is only visible against a real gesture.
 */

const PLACEMENT_STORY = 'controlled--placement';
const ORDER_STORY = 'controlled--child-order';

async function dragSeamBy(page: Page, dx: number): Promise<void> {
  const box = await settledBox(page.locator('[data-affordance-hit="resize-x-left"]'));
  const from = centerOf(box);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx, from.y, { steps: 10 });
  await page.mouse.up();
}

const hostWidth = async (page: Page) => Number(await page.getByTestId('host-width').textContent());

test.describe('onPlacementChange', () => {
  test('the host commits the width the seam proposed', async ({ page }) => {
    await openStory(page, PLACEMENT_STORY);
    expect(await hostWidth(page)).toBe(220);
    expect(Math.round((await settledBox(page.locator('[data-node="left"]'))).w)).toBe(220);

    await dragSeamBy(page, 80);

    await expect.poll(() => hostWidth(page)).toBeGreaterThan(280);
    // The pane renders what the host holds, not what the gesture wanted.
    const paneW = Math.round((await settledBox(page.locator('[data-node="left"]'))).w);
    expect(paneW).toBe(await hostWidth(page));
  });

  test('a host that refuses leaves the pane where it was', async ({ page }) => {
    await openStory(page, PLACEMENT_STORY);
    await page.getByTestId('commit').uncheck();

    await dragSeamBy(page, 80);

    // The proposal arrived — the gesture ran, it just committed nothing.
    await expect(page.getByTestId('proposal')).toHaveText(/resize-x-left → \d+/);
    expect(await hostWidth(page)).toBe(220);
    expect(Math.round((await settledBox(page.locator('[data-node="left"]'))).w)).toBe(220);
  });

  test('the host can set the width without a gesture', async ({ page }) => {
    await openStory(page, PLACEMENT_STORY);
    await dragSeamBy(page, 80);
    await expect.poll(() => hostWidth(page)).toBeGreaterThan(280);

    await page.getByTestId('reset').click();

    await expect(page.getByTestId('host-width')).toHaveText('220');
    await expect
      .poll(async () => Math.round((await boxOf(page.locator('[data-node="left"]'))).w))
      .toBe(220);
  });
});

/** Drag `id`'s grip onto `onto`'s lower half, which inserts after it. */
async function dragBelow(page: Page, id: string, onto: string): Promise<void> {
  const grip = centerOf(await settledBox(page.getByTestId(`grip-${id}`)));
  const target = await settledBox(page.locator(`[data-node="${onto}"]`));
  await page.mouse.move(grip.x, grip.y);
  await page.mouse.down();
  await page.mouse.move(target.x + target.w / 2, target.y + target.h - 4, { steps: 12 });
  await page.mouse.up();
}

test.describe('onChildOrderChange', () => {
  test('the host commits the order the drop proposed', async ({ page }) => {
    await openStory(page, ORDER_STORY);
    await expect(page.getByTestId('store-order')).toHaveText('alpha,bravo,charlie');

    await dragBelow(page, 'alpha', 'charlie');

    await expect(page.getByTestId('proposal')).toHaveText('alpha → bravo,charlie,alpha');
    await expect(page.getByTestId('store-order')).toHaveText('bravo,charlie,alpha');
  });

  test('a host that refuses keeps the order the store had', async ({ page }) => {
    await openStory(page, ORDER_STORY);
    await page.getByTestId('commit').uncheck();

    await dragBelow(page, 'alpha', 'charlie');

    await expect(page.getByTestId('proposal')).toHaveText('alpha → bravo,charlie,alpha');
    await expect(page.getByTestId('store-order')).toHaveText('alpha,bravo,charlie');
  });

  test('the host writing the store directly is never intercepted', async ({ page }) => {
    await openStory(page, ORDER_STORY);
    await page.getByTestId('commit').uncheck();

    await page.getByTestId('reverse').click();

    await expect(page.getByTestId('store-order')).toHaveText('charlie,bravo,alpha');
    await expect(page.getByTestId('proposal')).toHaveText('none');
  });
});
