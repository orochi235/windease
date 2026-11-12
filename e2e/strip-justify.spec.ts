import { expect, type Page, test } from '@playwright/test';
import { boxOf, centerOf, openStory, settledBox } from './fixtures.js';

const STORY = 'strip--justify';
const zone = (page: Page) => page.locator('.windease-zone').first();
const tab = (page: Page, name: string) => page.locator(`[data-node="tab-${name}"]`);

/** Each tab's left edge, relative to the zone's padding box. */
async function lefts(page: Page): Promise<number[]> {
  const border = await zone(page).evaluate((el) => el.clientLeft);
  const origin = (await settledBox(zone(page))).x + border;
  const out: number[] = [];
  for (const name of ['inbox', 'docs', 'music']) {
    out.push(Math.round((await settledBox(tab(page, name))).x - origin));
  }
  return out;
}

const seam = (page: Page, after = 'inbox') =>
  page.locator(`[data-affordance-hit="resize-x-tab-${after}"]`);

/** Drags the seam after tab `after` `dx` px and answers how far it should
 *  have gone. */
async function dragSeam(page: Page, dx: number, after = 'inbox'): Promise<number> {
  const from = centerOf(await settledBox(seam(page, after)));
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx, from.y, { steps: 8 });
  await page.mouse.up();
  return from.x + dx;
}

const seamX =
  (page: Page, after = 'inbox') =>
  async () =>
    centerOf(await boxOf(seam(page, after))).x;

test.describe('strip justify', () => {
  test('center: a dragged seam stays under the pointer', async ({ page }) => {
    await openStory(page, STORY);
    await page.getByTestId('justify').selectOption('center');
    await expect.poll(() => lefts(page)).toEqual([154, 320, 486]);
    const to = await dragSeam(page, -30);
    await expect.poll(seamX(page)).toBeCloseTo(to, 0);
    // The tab gives up 30px on each side, and the others hold their width.
    await expect.poll(() => lefts(page)).toEqual([184, 290, 456]);
  });

  test('end: a dragged seam stays under the pointer by resizing the tab after it', async ({
    page,
  }) => {
    await openStory(page, STORY);
    await page.getByTestId('justify').selectOption('end');
    await expect.poll(() => lefts(page)).toEqual([302, 468, 634]);
    const to = await dragSeam(page, 30);
    await expect.poll(seamX(page)).toBeCloseTo(to, 0);
    await expect.poll(() => lefts(page)).toEqual([332, 498, 634]);
  });

  test('between: a dragged middle seam stays under the pointer', async ({ page }) => {
    await openStory(page, STORY);
    await page.getByTestId('justify').selectOption('between');
    await expect.poll(() => lefts(page)).toEqual([6, 320, 634]);
    const to = await dragSeam(page, -30, 'docs');
    await expect.poll(seamX(page, 'docs')).toBeCloseTo(to, 0);
    // docs gives up 60px, and half of it comes back as the gap before it.
    await expect.poll(() => lefts(page)).toEqual([6, 350, 634]);
  });

  // A full row is 776px of tabs: 256, 264, 256.
  test('end: shrinking a tab in a full row keeps its seam under the pointer', async ({ page }) => {
    await openStory(page, STORY);
    await page.getByTestId('justify').selectOption('end');
    await page.getByTestId('row').selectOption('full');
    await expect.poll(() => lefts(page)).toEqual([6, 268, 538]);
    const to = await dragSeam(page, -30, 'docs');
    await expect.poll(seamX(page, 'docs')).toBeCloseTo(to, 0);
    await expect.poll(() => lefts(page)).toEqual([6, 268, 508]);
  });

  for (const justify of ['start', 'end'] as const) {
    test(`${justify}: a share before the dragged tab holds its width`, async ({ page }) => {
      await openStory(page, STORY);
      await page.getByTestId('justify').selectOption(justify);
      await page.getByTestId('row').selectOption('shared');
      // docs holds 256, and inbox and music split the other 520.
      await expect.poll(() => lefts(page)).toEqual([6, 272, 534]);
      const to = await dragSeam(page, -30, 'docs');
      await expect.poll(seamX(page, 'docs')).toBeCloseTo(to, 0);
      await expect.poll(() => lefts(page)).toEqual([6, 272, 504]);
    });
  }

  // 800 wide, padding 6, gap 6, three tabs capped at 160: 800 - 12 - 12 - 480
  // leaves 296 over.
  test('places the leftover space as the select says', async ({ page }) => {
    await openStory(page, STORY);
    expect(await lefts(page)).toEqual([6, 172, 338]);

    await page.getByTestId('justify').selectOption('center');
    await expect.poll(() => lefts(page)).toEqual([154, 320, 486]);

    await page.getByTestId('justify').selectOption('end');
    await expect.poll(() => lefts(page)).toEqual([302, 468, 634]);

    await page.getByTestId('justify').selectOption('between');
    await expect.poll(() => lefts(page)).toEqual([6, 320, 634]);
  });
});
