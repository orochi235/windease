import { expect, test } from '@playwright/test';
import { boxOf, openStory } from './fixtures.js';

const STORY = 'declarative--drop-intent';

/** Drag `grip-<id>` to a point and release, stepping the move: the hover
 *  hit-test runs on pointermove, and a single jump produces one. */
async function dropAt(
  page: import('@playwright/test').Page,
  gripId: string,
  target: { x: number; y: number },
): Promise<void> {
  const g = await boxOf(page.getByTestId(gripId));
  await page.mouse.move(g.x + g.w / 2, g.y + g.h / 2);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 12 });
  await page.mouse.up();
}

test.describe('a drop on a preset resolves where the cursor is', () => {
  test('a drop near a pane’s leading seam inserts there, not at the end', async ({ page }) => {
    await openStory(page, STORY);
    const readout = page.getByTestId('dd-readout');
    await expect(readout).toHaveText('shelf:alpha,bravo,charlie');
    const alpha = await boxOf(page.locator('[data-node="alpha"]'));
    // The left edge of the leftmost pane: index 0. Appending — what a preset
    // did before it had a hit-test — would leave the order unchanged.
    await dropAt(page, 'grip-charlie', { x: alpha.x + 3, y: alpha.y + alpha.h / 2 });
    await expect(readout).toHaveText('shelf:charlie,alpha,bravo');
  });

  test('a drop in the middle of a pane stacks the two into tabs', async ({ page }) => {
    await openStory(page, STORY);
    const alpha = await boxOf(page.locator('[data-node="alpha"]'));
    await dropAt(page, 'grip-charlie', { x: alpha.x + alpha.w / 2, y: alpha.y + alpha.h / 2 });
    await expect(page.getByTestId('dd-readout')).toHaveText(
      /shelf:stack-\d+,bravo stack-\d+:alpha,charlie/,
    );
    // The tabs are the point: a stack whose children cannot be reached is a
    // pane that swallowed another one.
    await expect(page.getByTestId('tab-alpha')).toBeVisible();
    await expect(page.getByTestId('tab-charlie')).toBeVisible();
  });

  test('a drop on a pane’s cross-axis edge splits its slot', async ({ page }) => {
    await openStory(page, STORY);
    const alpha = await boxOf(page.locator('[data-node="alpha"]'));
    // The top band of a pane in a horizontal strip is the cross axis.
    await dropAt(page, 'grip-charlie', { x: alpha.x + alpha.w / 2, y: alpha.y + 6 });
    await expect(page.getByTestId('dd-readout')).toHaveText(
      /shelf:split-\d+,bravo split-\d+:charlie,alpha/,
    );
    // Dropped on the top edge, so it takes the top half.
    const moved = await boxOf(page.locator('[data-node="charlie"]'));
    const target = await boxOf(page.locator('[data-node="alpha"]'));
    expect(moved.y).toBeLessThan(target.y);
    expect(Math.abs(moved.x - target.x)).toBeLessThanOrEqual(1);
  });
});

test.describe('a custom dropIntent replaces the hit-test', () => {
  const STORY = 'declarative--custom-drop-intent';

  test('a wide pane still stacks, as the shipped resolver would', async ({ page }) => {
    await openStory(page, STORY);
    const bravo = await boxOf(page.locator('[data-node="bravo"]'));
    await dropAt(page, 'grip-alpha', { x: bravo.x + bravo.w / 2, y: bravo.y + bravo.h / 2 });
    await expect(page.getByTestId('dd-readout')).toHaveText(
      /shelf:stack-\d+,charlie stack-\d+:bravo,alpha/,
    );
  });

  test('the sliver refuses the stack and takes an insert instead', async ({ page }) => {
    await openStory(page, STORY);
    const sliver = await boxOf(page.locator('[data-node="charlie"]'));
    expect(Math.round(sliver.w)).toBeLessThan(160);

    // The same gesture, on a pane the rule protects: dead centre, which is
    // nothing but the stack band.
    await dropAt(page, 'grip-alpha', { x: sliver.x + sliver.w / 2, y: sliver.y + sliver.h / 2 });

    await expect(page.getByTestId('dd-readout')).toHaveText(/^shelf:[a-z,]+$/);
    await expect(page.getByTestId('dd-readout')).toHaveText(/alpha/);
  });
});
