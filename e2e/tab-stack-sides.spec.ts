import { expect, type Page, test } from '@playwright/test';
import { boxOf, openStory, settledBox } from './fixtures.js';

/** The stack's tab band on each edge, as one strip or as stacked title bars. */

const STORY = 'tab-stack--tabs-and-side';
const TAB = 24;

const open = (page: Page, tabs: string, side: string) =>
  openStory(page, `${STORY}&arg-tabs=${tabs}&arg-side=${side}`);
const tab = (page: Page, id: string) => page.locator(`[data-testid="tab-${id}"]`);
const body = (page: Page, id: string) => page.locator(`[data-testid="body-${id}"]`);
const stack = (page: Page) => page.locator('[data-testid="stack-sided"]');

test.describe('stack tab band', () => {
  test('stacked title bars push the body down one bar per pane', async ({ page }) => {
    await open(page, 'stacked', 'top');
    const frame = await boxOf(stack(page));
    const b = await settledBox(body(page, 'editor'));
    expect(Math.round(b.y - frame.y)).toBeGreaterThanOrEqual(3 * TAB);
    expect(Math.round(b.y - frame.y)).toBeLessThanOrEqual(3 * TAB + 2);

    const editor = await boxOf(tab(page, 'editor'));
    const preview = await boxOf(tab(page, 'preview'));
    expect(Math.round(preview.y - editor.y)).toBe(TAB);
  });

  test('adding a pane grows the band by one bar', async ({ page }) => {
    await open(page, 'stacked', 'top');
    const before = await settledBox(body(page, 'editor'));
    await page.locator('[data-testid="add-pane"]').click();
    await expect(tab(page, 'extra-1')).toBeVisible();
    await expect
      .poll(async () => Math.round((await boxOf(body(page, 'editor'))).y - before.y))
      .toBe(TAB);
  });

  test('clicking a stacked title bar shows its pane', async ({ page }) => {
    await open(page, 'stacked', 'bottom');
    await tab(page, 'console').click();
    await expect(body(page, 'console')).toBeVisible();
    await expect(body(page, 'editor')).toHaveCount(0);
    const frame = await boxOf(stack(page));
    const b = await settledBox(body(page, 'console'));
    // The band is at the bottom, so the body starts at the top.
    expect(Math.round(b.y - frame.y)).toBeLessThanOrEqual(2);
    expect((await boxOf(tab(page, 'editor'))).y).toBeGreaterThanOrEqual(b.y + b.h - 2);
  });

  test('a left strip band puts the tabs in a column and the body to its right', async ({
    page,
  }) => {
    await open(page, 'strip', 'left');
    const editor = await boxOf(tab(page, 'editor'));
    const preview = await boxOf(tab(page, 'preview'));
    expect(preview.y).toBeGreaterThan(editor.y);
    const b = await settledBox(body(page, 'editor'));
    expect(b.x).toBeGreaterThanOrEqual(editor.x + editor.w - 1);
    await tab(page, 'preview').click();
    await expect(body(page, 'preview')).toBeVisible();
  });

  test('a right strip band puts the body to its left', async ({ page }) => {
    await open(page, 'strip', 'right');
    const b = await settledBox(body(page, 'editor'));
    const editor = await boxOf(tab(page, 'editor'));
    expect(editor.x).toBeGreaterThanOrEqual(b.x + b.w - 1);
  });
});
