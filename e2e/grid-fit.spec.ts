import { expect, type Page, test } from '@playwright/test';
import { openStory, settledBox } from './fixtures.js';

const FITTED = 'grid--fitted-grid';

const tile = (page: Page, n: number) => page.locator(`[data-node="fit-${n}"]`);

/** How many tiles share the top row, which is the column count without the
 *  test having to know a cell's size. */
async function columns(page: Page, count: number): Promise<number> {
  const top = (await settledBox(tile(page, 1))).y;
  let cols = 0;
  for (let n = 1; n <= count; n++) {
    const box = await settledBox(tile(page, n));
    if (Math.abs(box.y - top) < 1) cols++;
  }
  return cols;
}

test.describe("grid orientation 'fit'", () => {
  test('a tall container takes fewer columns than a wide one holding the same tiles', async ({
    page,
  }) => {
    await openStory(page, `${FITTED}&arg-width=300&arg-height=450&arg-tileCount=10`);
    await expect(page.getByTestId('fit-tiling')).toHaveText('3 × 4');
    expect(await columns(page, 10)).toBe(3);

    await openStory(page, `${FITTED}&arg-width=600&arg-height=300&arg-tileCount=10`);
    await expect(page.getByTestId('fit-tiling')).toHaveText('5 × 2');
    expect(await columns(page, 10)).toBe(5);
  });

  test("'wide' answers the same count whatever shape it is squaring inside", async ({ page }) => {
    await openStory(page, `${FITTED}&arg-width=300&arg-height=450&arg-tileCount=10`);
    await page.getByTestId('fit-orientation').selectOption('wide');
    await expect(page.getByTestId('fit-tiling')).toHaveText('4 × 3');

    await openStory(page, `${FITTED}&arg-width=600&arg-height=300&arg-tileCount=10`);
    await page.getByTestId('fit-orientation').selectOption('wide');
    await expect(page.getByTestId('fit-tiling')).toHaveText('4 × 3');
  });

  test('fitting leaves the cells squarer than squaring the count does', async ({ page }) => {
    await openStory(page, `${FITTED}&arg-width=300&arg-height=450&arg-tileCount=10`);
    await expect(page.getByTestId('fit-tiling')).toHaveText('3 × 4');
    const fitted = await settledBox(tile(page, 1));
    await page.getByTestId('fit-orientation').selectOption('wide');
    // The caption is the tiling the cells were placed into, so waiting on it
    // is waiting for the relayout — measuring straight after the select reads
    // the box the fitted grid left behind.
    await expect(page.getByTestId('fit-tiling')).toHaveText('4 × 3');
    const wide = await settledBox(tile(page, 1));
    const aspect = (b: { w: number; h: number }) => Math.max(b.w / b.h, b.h / b.w);
    expect(aspect(fitted)).toBeLessThan(aspect(wide));
    expect(Math.min(fitted.w, fitted.h)).toBeGreaterThan(Math.min(wide.w, wide.h));
  });
});
