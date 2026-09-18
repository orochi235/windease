import { expect, type Page, test } from '@playwright/test';
import { boxOf, openStory, settledBox } from './fixtures.js';

const STORY = 'strip--justify';
const zone = (page: Page) => page.locator('.windease-zone').first();
const tab = (page: Page, name: string) => page.locator(`[data-node="tab-${name}"]`);

/** Each tab's left edge, relative to the zone's padding box. */
async function lefts(page: Page): Promise<number[]> {
  const border = await zone(page).evaluate((el) => el.clientLeft);
  const origin = (await boxOf(zone(page))).x + border;
  const out: number[] = [];
  for (const name of ['inbox', 'docs', 'music']) {
    out.push(Math.round((await settledBox(tab(page, name))).x - origin));
  }
  return out;
}

test.describe('strip justify', () => {
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
