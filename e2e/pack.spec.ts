import { expect, type Page, test } from '@playwright/test';
import { openStory } from './fixtures.js';

const STORY = 'pack--packed-boxes';
const ZONE = 'pack';

interface Placed {
  id: string;
  /** The size the box asked for, from its `w×h` title. */
  own: { w: number; h: number };
  rotation: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Every rendered box, relative to the zone's inside corner, with its title's size and turn. */
async function placed(page: Page): Promise<Placed[]> {
  return page.evaluate((root) => {
    const container = document.querySelector(`[data-node-container="${root}"]`);
    if (!container) return [];
    const origin = container.getBoundingClientRect();
    return [...container.querySelectorAll(':scope > [data-node]')].map((el) => {
      const r = el.getBoundingClientRect();
      const [w, h] = (el.textContent ?? '').match(/\d+/g)!.map(Number);
      const id = el.getAttribute('data-node') ?? '';
      const turned = container.querySelector(`[data-turned="${id}"]`) ? 90 : 0;
      return {
        id,
        own: { w: w!, h: h! },
        rotation: turned,
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

  test('rotate turns a box too wide for the container, and the chrome reads the turn', async ({
    page,
  }) => {
    const wide = async () => (await placed(page)).find((b) => b.id === 'box-3')!;
    await openStory(page, `${STORY}&arg-strategy=shelf&arg-width=180`);
    await expect.poll(async () => (await wide()).w).toBe(200);

    await openStory(page, `${STORY}&arg-strategy=shelf&arg-width=180&arg-rotate=true`);
    await expect.poll(async () => (await wide()).rotation).toBe(90);
    expect(await wide()).toMatchObject({ w: 150, h: 200 });
    await expect(page.getByTestId('pack-readout')).toContainText(/, [1-9]\d* turned$/);
  });

  for (const strategy of ['shelf', 'skyline', 'column']) {
    test(`rotate places every ${strategy} box at its own size or turned, as its channel says`, async ({
      page,
    }) => {
      await openStory(page, `${STORY}&arg-strategy=${strategy}&arg-rotate=true&arg-sort=area`);
      await expect.poll(async () => (await placed(page)).length).toBe(14);
      for (const box of await placed(page)) {
        const want =
          box.rotation === 90 ? { w: box.own.h, h: box.own.w } : { w: box.own.w, h: box.own.h };
        expect({ w: box.w, h: box.h }, box.id).toEqual(want);
        expect(box.x + box.w, box.id).toBeLessThanOrEqual(480);
      }
    });
  }

  test('cols fixes the column count and widens the columns to fill the width', async ({ page }) => {
    const xs = async () => [...new Set((await placed(page)).map((b) => b.x))].sort((a, b) => a - b);
    await openStory(page, `${STORY}&arg-strategy=column&arg-cols=3`);
    // (480 − 2·8) / 3 ≈ 154.7 wide: every box starts on one of three columns.
    await expect.poll(xs).toEqual([0, 163, 325]);

    await openStory(page, `${STORY}&arg-strategy=column&arg-cols=3&arg-width=720`);
    await expect.poll(xs).toEqual([0, 243, 485]);
  });

  test('justify places fixed-width columns in the width they leave', async ({ page }) => {
    const left = async () => Math.min(...(await placed(page)).map((b) => b.x));
    const base = `${STORY}&arg-strategy=column&arg-columnWidth=100`;
    await openStory(page, base);
    await expect.poll(left).toBe(0);
    // Four columns of 100 and three gaps of 8 leave 56 of 480.
    await openStory(page, `${base}&arg-justify=center`);
    await expect.poll(left).toBe(28);
    await openStory(page, `${base}&arg-justify=end`);
    await expect.poll(left).toBe(56);
  });
});
