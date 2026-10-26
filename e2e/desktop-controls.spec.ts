import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { boxOf, dragMouse, openStory, settledBox } from './fixtures.js';

const STORY = 'desktop-controls--window-controls&mode=preview';

const node = (page: Page, id: string) => page.locator(`[data-node="${id}"]`);
const surface = (page: Page) => page.locator('.desktop-surface');

test.describe('desktop window controls', () => {
  test('close asks the host, which hides the window here; reopening shows it', async ({ page }) => {
    await openStory(page, STORY);
    await page.getByRole('button', { name: 'close notes' }).click();
    await expect(node(page, 'notes')).toBeHidden();
    await page.getByTestId('reopen-notes').click();
    await expect(node(page, 'notes')).toBeVisible();
  });

  test('close answered by a confirm leaves the window until the user agrees', async ({ page }) => {
    await openStory(page, `${STORY}&arg-onClose=confirm`);
    await page.getByRole('button', { name: 'close mail' }).click();
    await expect(page.getByTestId('confirm-mail')).toBeVisible();
    await expect(node(page, 'mail')).toBeVisible();
    await page.getByTestId('confirm-mail').getByRole('button', { name: 'Close' }).click();
    await expect(node(page, 'mail')).toBeHidden();
  });

  test('close works from the keyboard', async ({ page }) => {
    await openStory(page, STORY);
    await page.getByRole('button', { name: 'close notes' }).focus();
    await page.keyboard.press('Enter');
    await expect(node(page, 'notes')).toBeHidden();
  });

  test('zoom fills the desktop, and a second press restores the window', async ({ page }) => {
    await openStory(page, STORY);
    const before = await settledBox(node(page, 'mail'));
    const desk = await settledBox(surface(page));
    await page.getByRole('button', { name: 'zoom mail' }).click();
    await expect
      .poll(() => boxOf(node(page, 'mail')))
      .toMatchObject({ x: desk.x, y: desk.y, w: desk.w, h: desk.h });
    await page.getByRole('button', { name: 'restore size mail' }).click();
    await expect.poll(() => boxOf(node(page, 'mail'))).toMatchObject(before);
  });

  test('dragging a zoomed window by its title bar restores its size under the pointer', async ({
    page,
  }) => {
    await openStory(page, STORY);
    const before = await settledBox(node(page, 'mail'));
    await page.getByRole('button', { name: 'zoom mail' }).click();
    const zoomed = await settledBox(node(page, 'mail'));
    const from = { x: zoomed.x + zoomed.w / 2, y: zoomed.y + 13 };
    const to = { x: from.x, y: from.y + 80 };
    await dragMouse(page, from, to);
    const after = await settledBox(node(page, 'mail'));
    expect(after.w).toBeCloseTo(before.w, 0);
    expect(after.h).toBeCloseTo(before.h, 0);
    expect(to.x).toBeGreaterThan(after.x);
    expect(to.x).toBeLessThan(after.x + after.w);
    expect(to.y).toBeGreaterThan(after.y);
    expect(to.y).toBeLessThan(after.y + 26);
  });

  test('a window with placement.controls: [] carries no buttons', async ({ page }) => {
    await openStory(page, STORY);
    await expect(page.getByRole('button', { name: 'close notes' })).toHaveCount(1);
    await expect(
      page.locator('[data-affordance-hit$=":palette"][data-affordance-kind="click"]'),
    ).toHaveCount(0);
  });

  test("controlsSide: 'end' puts the boxes at the right of the title bar", async ({ page }) => {
    await openStory(page, `${STORY}&arg-side=end`);
    const win = await settledBox(node(page, 'notes'));
    await expect
      .poll(async () => {
        const zoom = await boxOf(page.getByRole('button', { name: 'zoom notes' }));
        return Math.round(zoom.x + zoom.w);
      })
      .toBe(Math.round(win.x + win.w));
  });

  test('turning every control off leaves no buttons', async ({ page }) => {
    await openStory(page, `${STORY}&arg-close=false&arg-minimize=false&arg-zoom=false`);
    await expect(page.locator('[data-affordance-kind="click"]')).toHaveCount(0);
  });
});
