import { expect, type Page, test } from '@playwright/test';
import { openStory } from './fixtures.js';

const STORY = 'pack--packed-boxes';
const ZONE = 'pack';

interface Placed {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Every rendered box, relative to the zone's corner. */
async function placed(page: Page): Promise<Placed[]> {
  return page.evaluate((root) => {
    const container = document.querySelector(`[data-node-container="${root}"]`);
    if (!container) return [];
    const origin = container.getBoundingClientRect();
    return [...container.querySelectorAll(':scope > [data-node]')].map((el) => {
      const r = el.getBoundingClientRect();
      return {
        id: el.getAttribute('data-node') ?? '',
        x: Math.round(r.left - origin.left - container.clientLeft),
        y: Math.round(r.top - origin.top - container.clientTop),
        w: Math.round(r.width),
        h: Math.round(r.height),
      };
    });
  }, ZONE);
}

const atOrigin = async (page: Page) =>
  (await placed(page)).filter((b) => b.x === 0 && b.y === 0).map((b) => b.id);

test.describe('the Pack story drives the packers from config', () => {
  test('sort decides which box packs first', async ({ page }) => {
    await openStory(page, `${STORY}&arg-strategy=shelf`);
    await expect.poll(() => atOrigin(page)).toEqual(['box-1']);

    await openStory(page, `${STORY}&arg-strategy=shelf&arg-sort=height`);
    // 140×220, the tallest box, is seventh in the list.
    await expect.poll(() => atOrigin(page)).toEqual(['box-7']);
    expect(await placed(page)).toHaveLength(14);

    await openStory(page, `${STORY}&arg-strategy=shelf&arg-sort=width`);
    await expect.poll(() => atOrigin(page)).toEqual(['box-3']);
  });

  for (const strategy of ['shelf', 'skyline', 'column']) {
    test(`overflowMode unplaced keeps ${strategy} inside the container's height`, async ({
      page,
    }) => {
      const readout = page.getByTestId('pack-readout');
      await openStory(page, `${STORY}&arg-strategy=${strategy}&arg-height=200`);
      await expect(readout).toHaveText('14 placed, 0 unplaced');
      expect(Math.max(...(await placed(page)).map((b) => b.y + b.h))).toBeGreaterThan(200);

      await openStory(
        page,
        `${STORY}&arg-strategy=${strategy}&arg-height=200&arg-overflowMode=unplaced`,
      );
      await expect(readout).toHaveText(/^\d+ placed, [1-9]\d* unplaced$/);
      const boxes = await placed(page);
      await expect(readout).toHaveText(`${boxes.length} placed, ${14 - boxes.length} unplaced`);
      expect(Math.max(...boxes.map((b) => b.y + b.h))).toBeLessThanOrEqual(200);
    });
  }
});
