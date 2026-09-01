import { expect, type Page, test } from '@playwright/test';
import { centerOf, openStory, settledBox } from './fixtures.js';

/**
 * `canAccept` overrides the strategy's own answer, and the only place that
 * decision is observable end to end is a real pointer drag: it runs on every
 * `pointermove`, and what it returns decides whether the release commits.
 */

const STORY = 'accept-policy--widening-the-cap';

const handle = (page: Page, id: string) => page.locator(`[data-windease-drag-handle="${id}"]`);
const frame = (page: Page, zone: string) => page.locator(`[data-testid="frame-${zone}"]`);

/** A zone's `childOrder`, from the story's readout, order-insensitive: this
 *  spec is about whether the drop landed, not which seam it chose. */
async function childIds(page: Page, zone: string): Promise<string[]> {
  const text = (await page.locator(`[data-testid="order-${zone}"]`).textContent()) ?? '';
  return text === '(empty)' ? [] : text.split(',').sort();
}

/**
 * Drag `sourceId` onto the middle of `zoneId`, asserting the hover verdict
 * before the release — without it a "nothing moved" assertion would also pass
 * for a gesture that never reached the target.
 */
async function dragInto(page: Page, sourceId: string, zoneId: string, verdict: string) {
  const from = centerOf(await settledBox(handle(page, sourceId)));
  const to = centerOf(await settledBox(page.locator(`[data-testid="${zoneId}"]`)));
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 14 });
  await expect(frame(page, zoneId)).toHaveClass(new RegExp(`ap-frame--${verdict}`));
  await page.mouse.up();
}

test.describe('canAccept', () => {
  test('a lenient zone takes a drop its strategy would refuse', async ({ page }) => {
    await openStory(page, STORY);
    expect(await childIds(page, 'zone-lenient')).toEqual(['lenient-1', 'lenient-2']);

    await dragInto(page, 'strict-1', 'zone-lenient', 'accept');

    await expect
      .poll(() => childIds(page, 'zone-lenient'))
      .toEqual(['lenient-1', 'lenient-2', 'strict-1']);
    expect(await childIds(page, 'zone-strict')).toEqual(['strict-2']);
    // Accepting is not the same as making room: strip still places `maxItems`
    // and reports the rest, which the story names.
    await expect(page.locator('[data-testid="withheld-zone-lenient"]')).toBeVisible();
  });

  test('a strict zone still refuses at its cap', async ({ page }) => {
    await openStory(page, STORY);
    const before = await settledBox(page.locator('[data-node="lenient-1"]'));

    await dragInto(page, 'lenient-1', 'zone-strict', 'reject');

    expect(await childIds(page, 'zone-strict')).toEqual(['strict-1', 'strict-2']);
    expect(await childIds(page, 'zone-lenient')).toEqual(['lenient-1', 'lenient-2']);
    expect(await settledBox(page.locator('[data-node="lenient-1"]'))).toEqual(before);
  });

  test('a fourth item hands the answer back to the strategy', async ({ page }) => {
    await openStory(page, STORY);
    await dragInto(page, 'strict-1', 'zone-lenient', 'accept');
    await expect.poll(() => childIds(page, 'zone-lenient')).toHaveLength(3);

    // `canAccept` returns undefined past three, so `maxItems: 2` decides again.
    await dragInto(page, 'strict-2', 'zone-lenient', 'reject');

    expect(await childIds(page, 'zone-lenient')).toEqual(['lenient-1', 'lenient-2', 'strict-1']);
    expect(await childIds(page, 'zone-strict')).toEqual(['strict-2']);
  });
});
