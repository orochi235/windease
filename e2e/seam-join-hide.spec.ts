import { expect, type Page, test } from '@playwright/test';
import { boxOf, centerOf, openStory, settledBox } from './fixtures.js';

const STORY = 'seam-join--hide-on-overshoot';

const seam = (page: Page, after: string) =>
  page.locator(`[data-affordance-hit="resize-x-hide-${after}"]`);
const pane = (page: Page, id: string) => page.locator(`[data-node="hide-${id}"]`);
const hidden = (page: Page) => page.getByTestId('sj-hidden');

async function width(page: Page, id: string): Promise<number> {
  return Math.round((await settledBox(pane(page, id))).w);
}

/** Pushes the sidebar's seam left to its floor, then `past` further, and
 *  leaves the button down. */
async function pushSidebarShut(page: Page, past: number): Promise<void> {
  const s = seam(page, 'sidebar');
  const travel =
    Number(await s.getAttribute('aria-valuenow')) - Number(await s.getAttribute('aria-valuemin'));
  const from = centerOf(await boxOf(s));
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x - travel, from.y, { steps: 8 });
  await page.mouse.move(from.x - travel - past, from.y, { steps: 4 });
}

test.describe("seam join overshoot: 'hide'", () => {
  test('releasing past the floor hides the pane and the editor takes its space', async ({
    page,
  }) => {
    await openStory(page, STORY);
    expect(await width(page, 'sidebar')).toBe(200);
    await pushSidebarShut(page, 40);
    await expect(pane(page, 'sidebar')).toHaveAttribute('data-join-armed', 'true');
    await page.mouse.up();

    await expect(pane(page, 'sidebar')).toHaveCount(0);
    await expect(hidden(page)).toHaveText('hide-sidebar');
    // 800 less padding 16 and one gap 8, less the outline's 180.
    await expect.poll(() => width(page, 'editor')).toBe(596);
  });

  test('showing the pane brings it back at the width it had before the drag', async ({ page }) => {
    await openStory(page, STORY);
    await pushSidebarShut(page, 40);
    await page.mouse.up();
    await expect(hidden(page)).toHaveText('hide-sidebar');

    await page.getByTestId('sj-show-hide-sidebar').click();
    await expect(hidden(page)).toHaveText('(nothing)');
    await expect.poll(() => width(page, 'sidebar')).toBe(200);
    expect(await width(page, 'editor')).toBe(388);
  });

  test('Escape while armed hides nothing', async ({ page }) => {
    await openStory(page, STORY);
    await pushSidebarShut(page, 40);
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await expect(hidden(page)).toHaveText('(nothing)');
    await expect(pane(page, 'sidebar')).toHaveCount(1);
  });

  test('the keyboard arms with arrows and hides with Enter', async ({ page }) => {
    await openStory(page, STORY);
    await seam(page, 'sidebar').focus();
    // 80px to the floor at 8px a press, then past the 24px threshold.
    for (let i = 0; i < 10 + 4; i++) await page.keyboard.press('ArrowLeft');
    await expect(pane(page, 'sidebar')).toHaveAttribute('data-join-armed', 'true');
    await expect(page.locator('[data-join-live]').first()).toContainText('will hide');
    await page.keyboard.press('Enter');
    await expect(hidden(page)).toHaveText('hide-sidebar');
  });
});
