import { expect, type Page, test } from '@playwright/test';
import { boxOf, openStory, settledBox } from './fixtures.js';

const STORY = 'grid--frozen-headers';
const cell = (page: Page, r: number, c: number) => page.locator(`[data-node="sheet-${r}-${c}"]`);
const scroller = (page: Page) => page.getByTestId('sheet-scroller');

async function scrollTo(page: Page, left: number, top: number): Promise<void> {
  await scroller(page).evaluate(
    (el, to) => {
      el.scrollLeft = to.left;
      el.scrollTop = to.top;
    },
    { left, top },
  );
}

/** Top-left relative to the scroller's visible box. */
async function visible(page: Page, r: number, c: number, read = boxOf) {
  const origin = await read(scroller(page));
  const box = await read(cell(page, r, c));
  return { x: Math.round(box.x - origin.x), y: Math.round(box.y - origin.y) };
}

test.describe('grid placement.sticky', () => {
  test('headings hold at the top and row numbers at the left as the sheet scrolls', async ({
    page,
  }) => {
    await openStory(page, STORY);
    const heading = await visible(page, 0, 3, settledBox);
    const rowNumber = await visible(page, 5, 0, settledBox);
    const corner = await visible(page, 0, 0, settledBox);
    const body = await visible(page, 5, 3, settledBox);

    await scrollTo(page, 120, 80);
    await expect.poll(async () => (await visible(page, 5, 3)).y).toBe(body.y - 80);
    expect((await visible(page, 5, 3)).x).toBe(body.x - 120);
    // The heading keeps its height in view and scrolls sideways with its column.
    await expect
      .poll(async () => await visible(page, 0, 3))
      .toEqual({
        x: heading.x - 120,
        y: heading.y,
      });
    await expect
      .poll(async () => await visible(page, 5, 0))
      .toEqual({
        x: rowNumber.x,
        y: rowNumber.y - 80,
      });
    await expect.poll(async () => await visible(page, 0, 0)).toEqual(corner);
  });

  test('the corner draws over the headings scrolled beneath it', async ({ page }) => {
    await openStory(page, STORY);
    await scrollTo(page, 120, 80);
    await expect
      .poll(async () => {
        const box = await boxOf(cell(page, 0, 0));
        return page.evaluate(
          ({ x, y }) =>
            document.elementFromPoint(x, y)?.closest('[data-node]')?.getAttribute('data-node'),
          { x: box.x + box.w / 2, y: box.y + box.h / 2 },
        );
      })
      .toBe('sheet-0-0');
  });
});
