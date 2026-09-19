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
});
