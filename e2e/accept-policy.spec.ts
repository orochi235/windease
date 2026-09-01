import { expect, type Page, test } from '@playwright/test';
import { centerOf, openStory, settledBox } from './fixtures.js';

/**
 * `acceptPolicy` overrides the strategy's own answer, and the only place that
 * decision is observable end to end is a real pointer drag: it runs on every
 * `pointermove`, and what it returns decides whether the release commits.
 */

const STORY = 'policies--accept--widening-the-cap';

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

test.describe('acceptPolicy', () => {
  test('a lenient zone takes a drop its strategy would refuse', async ({ page }) => {
    await openStory(page, STORY);
    expect(await childIds(page, 'zone-lenient')).toEqual(['lenient-1']);

    // First drop: the zone has room, so it lands and both panes re-lay out.
    await dragInto(page, 'strict-1', 'zone-lenient', 'accept');
    await expect.poll(() => childIds(page, 'zone-lenient')).toEqual(['lenient-1', 'strict-1']);
    await expect.poll(() => childIds(page, 'zone-strict')).toEqual(['strict-2']);
    await expect(page.locator('[data-testid="withheld-zone-lenient"]')).toBeHidden();

    // Second drop: past the cap, so only `acceptPolicy` lets it in — and strip
    // still places `maxItems` and reports the rest, which the story names.
    await dragInto(page, 'strict-2', 'zone-lenient', 'accept');
    await expect
      .poll(() => childIds(page, 'zone-lenient'))
      .toEqual(['lenient-1', 'strict-1', 'strict-2']);
    await expect(page.locator('[data-testid="withheld-zone-lenient"]')).toBeVisible();
  });

  test('a strict zone still refuses at its cap', async ({ page }) => {
    await openStory(page, STORY);
    const before = await settledBox(page.locator('[data-node="lenient-1"]'));

    await dragInto(page, 'lenient-1', 'zone-strict', 'reject');

    await expect.poll(() => childIds(page, 'zone-strict')).toEqual(['strict-1', 'strict-2']);
    await expect.poll(() => childIds(page, 'zone-lenient')).toEqual(['lenient-1']);
    expect(await settledBox(page.locator('[data-node="lenient-1"]'))).toEqual(before);
  });

  test('a fourth item hands the answer back to the strategy', async ({ page }) => {
    await openStory(page, STORY);

    // Fill Lenient to the three `acceptPolicy` allows: one seeded, two dropped.
    await dragInto(page, 'strict-1', 'zone-lenient', 'accept');
    await expect.poll(() => childIds(page, 'zone-lenient')).toHaveLength(2);
    await dragInto(page, 'strict-2', 'zone-lenient', 'accept');
    await expect.poll(() => childIds(page, 'zone-lenient')).toHaveLength(3);

    // `acceptPolicy` returns undefined past three, so `maxItems: 2` decides again.
    await dragInto(page, 'refusing-1', 'zone-lenient', 'reject');

    await expect
      .poll(() => childIds(page, 'zone-lenient'))
      .toEqual(['lenient-1', 'strict-1', 'strict-2']);
    await expect.poll(() => childIds(page, 'zone-refusing')).toEqual(['refusing-1']);
  });

  test('a false answer refuses a drop the strategy has room for', async ({ page }) => {
    await openStory(page, STORY);
    // One pane under a cap of two: `strip.canAccept` would take this drop.
    expect(await childIds(page, 'zone-refusing')).toEqual(['refusing-1']);

    await dragInto(page, 'strict-1', 'zone-refusing', 'reject');

    await expect.poll(() => childIds(page, 'zone-refusing')).toEqual(['refusing-1']);
    await expect.poll(() => childIds(page, 'zone-strict')).toEqual(['strict-1', 'strict-2']);
  });
});
