import { expect, type Page, test } from '@playwright/test';
import { centerOf, dragMouse, openStory, settledBox } from './fixtures.js';

const STORY = 'strip--zoom';
const pane = (page: Page, name: string) => page.locator(`[data-node="zoom-${name}"]`);
const seam = (page: Page, after: string) =>
  page.locator(`[data-affordance-hit="resize-x-zoom-${after}"]`);

async function widths(page: Page): Promise<number[]> {
  const out: number[] = [];
  for (const name of ['shell', 'editor', 'logs']) {
    out.push(Math.round((await settledBox(pane(page, name))).w));
  }
  return out;
}

test.describe('zoom', () => {
  test('a zoomed strip pane fills the zone and the rest leave it', async ({ page }) => {
    await openStory(page, STORY);
    await page.getByTestId('zoom-zoom-editor').click();
    await expect(pane(page, 'shell')).toHaveCount(0);
    await expect(pane(page, 'logs')).toHaveCount(0);
    await expect(page.locator('[data-affordance-hit]')).toHaveCount(0);
    // 720 less 6px padding each side.
    await expect.poll(async () => Math.round((await settledBox(pane(page, 'editor'))).w)).toBe(708);
  });

  test('unzooming brings the row back at the sizes it was left at', async ({ page }) => {
    await openStory(page, STORY);
    const grip = centerOf(await settledBox(seam(page, 'shell')));
    await dragMouse(page, grip, { x: grip.x + 70, y: grip.y });
    const before = await widths(page);

    await page.getByTestId('zoom-zoom-logs').click();
    await expect(pane(page, 'shell')).toHaveCount(0);
    await page.getByTestId('zoom-none').click();
    await expect(pane(page, 'shell')).toHaveCount(1);
    await expect.poll(() => widths(page)).toEqual(before);
  });

  test('a zoomed stack child covers the tab band', async ({ page }) => {
    await openStory(page, STORY);
    await page.getByTestId('zoom-strategy').selectOption('stack');
    const body = await settledBox(pane(page, 'shell'));
    await page.getByTestId('zoom-zoom-logs').click();
    await expect(pane(page, 'shell')).toHaveCount(0);
    await expect
      .poll(async () => Math.round((await settledBox(pane(page, 'logs'))).y))
      .toBe(Math.round(body.y - 28));
  });
});
