import { expect, type Page, test } from '@playwright/test';
import { boxOf, openStory, settledBox } from './fixtures.js';

const STORY = 'strip--sticky-tabs';
const tab = (page: Page, name: string) => page.locator(`[data-node="sticky-${name}"]`);
const scroller = (page: Page) => page.getByTestId('sticky-scroller');

async function scrollBar(page: Page, x: number): Promise<void> {
  await scroller(page).evaluate((el, left) => {
    el.scrollLeft = left;
  }, x);
}

/** Left edge relative to the scroller's visible box. */
async function visibleX(page: Page, name: string, read = boxOf): Promise<number> {
  const origin = (await read(scroller(page))).x;
  return Math.round((await read(tab(page, name))).x - origin);
}

test.describe('strip placement.sticky', () => {
  test('pinned tabs hold at the start while the pages scroll under them', async ({ page }) => {
    await openStory(page, STORY);
    const mail = await visibleX(page, 'mail', settledBox);
    const chat = await visibleX(page, 'chat', settledBox);
    const first = await visibleX(page, 'page-1', settledBox);

    await scrollBar(page, 300);
    await expect.poll(() => visibleX(page, 'page-1')).toBe(first - 300);
    await expect.poll(() => visibleX(page, 'mail')).toBe(mail);
    expect(await visibleX(page, 'chat', settledBox)).toBe(chat);
  });

  test('a pinned tab draws over the page scrolled beneath it', async ({ page }) => {
    await openStory(page, STORY);
    await scrollBar(page, 300);
    await expect
      .poll(async () => {
        const chat = await boxOf(tab(page, 'chat'));
        return page.evaluate(
          ({ x, y }) =>
            document.elementFromPoint(x, y)?.closest('[data-node]')?.getAttribute('data-node'),
          { x: chat.x + chat.w / 2, y: chat.y + chat.h / 2 },
        );
      })
      .toBe('sticky-chat');
  });
});
