import { expect, type Page, test } from '@playwright/test';
import { boxOf, openStory, settledBox } from './fixtures.js';

const STORY = 'strip--oversized-first-pane';
const pane = (page: Page, name: string) => page.locator(`[data-node="oversize-${name}"]`);
const heightOf = (page: Page) => async () => Math.round((await boxOf(pane(page, 'log'))).h);
const scrolls = (page: Page) =>
  page.getByTestId('oversize-scroller').evaluate((el) => el.scrollHeight > el.clientHeight);

test.describe("strip overflowMode 'unplaced' with a first pane taller than the zone", () => {
  test('clamps it by default, and lays it out in full under oversize: overflow', async ({
    page,
  }) => {
    await openStory(page, STORY);
    expect(Math.round((await settledBox(pane(page, 'log'))).h)).toBe(240);
    await expect(pane(page, 'notes')).toHaveCount(0);
    expect(await scrolls(page)).toBe(false);

    await page.getByTestId('oversize').selectOption('overflow');
    await expect.poll(heightOf(page)).toBe(420);
    await expect(pane(page, 'notes')).toHaveCount(0);
    await expect.poll(() => scrolls(page)).toBe(true);
  });
});
