import { expect, test } from '@playwright/test';
import { boxOf, openStory, settledBox } from './fixtures.js';

const STORY = 'content-sizing--content-sized-dock';

test.describe('content-driven sizing', () => {
  test('a pane is as tall as its contents, not an equal share', async ({ page }) => {
    await openStory(page, STORY);
    // Three panes with 2, 3 and 1 rows. An equal share would make them equal;
    // jsdom cannot tell the difference because it measures nothing.
    // Sizing is two-pass, and the first pass is the equal share.
    const tallestFirst = async () => {
      const ids = ['palette-1', 'palette-2', 'palette-3'];
      const hs = await Promise.all(
        ids.map(async (id) => (await boxOf(page.locator(`[data-node="${id}"]`))).h),
      );
      return ids
        .map((id, i) => ({ id, h: hs[i] ?? 0 }))
        .sort((a, b) => b.h - a.h)
        .map((p, i, all) => (i > 0 && all[i - 1]?.h === p.h ? `${p.id} (tied)` : p.id));
    };
    await expect.poll(tallestFirst).toEqual(['palette-2', 'palette-1', 'palette-3']);
  });

  test('adding content grows the pane with no size written', async ({ page }) => {
    await openStory(page, STORY);
    const pane = page.locator('[data-node="palette-1"]');
    const before = (await settledBox(pane)).h;
    await page.getByTestId('add-row').click();
    await expect.poll(async () => (await boxOf(pane)).h).toBeGreaterThan(before);
  });

  test('the layout settles instead of oscillating', async ({ page }) => {
    await openStory(page, STORY);
    const pane = page.locator('[data-node="palette-1"]');
    const before = (await settledBox(pane)).h;
    await page.getByTestId('add-row').click();

    // Sizing is deliberately two-pass — the pane is laid out, measured, then
    // laid out again — so wait for the change to arrive, then for it to hold.
    // A box that holds before it has moved has not settled, it has not started.
    await expect.poll(async () => (await boxOf(pane)).h).toBeGreaterThan(before);
    const settled = (await settledBox(pane)).h;

    // And it stays there: a cycle that re-triggered itself would move again.
    await page.waitForTimeout(400);
    expect((await boxOf(pane)).h).toBe(settled);
  });

  test('dragging a gutter pins the pane against further measurement', async ({ page }) => {
    await openStory(page, STORY);
    const pane = page.locator('[data-node="palette-1"]');
    const gutter = page.locator('[role="separator"]').first();
    const g = await settledBox(gutter);
    await page.mouse.move(g.x + g.w / 2, g.y + g.h / 2);
    await page.mouse.down();
    await page.mouse.move(g.x + g.w / 2, g.y + g.h / 2 + 60, { steps: 10 });
    await page.mouse.up();
    const pinned = (await settledBox(pane)).h;
    await page.getByTestId('add-row').click();
    await page.waitForTimeout(300);
    expect((await boxOf(pane)).h).toBe(pinned);
  });

  test('releasing the size hands the pane back to measurement', async ({ page }) => {
    await openStory(page, STORY);
    const pane = page.locator('[data-node="palette-1"]');
    const content = (await settledBox(pane)).h;

    const gutter = page.locator('[role="separator"]').first();
    const g = await settledBox(gutter);
    await page.mouse.move(g.x + g.w / 2, g.y + g.h / 2);
    await page.mouse.down();
    await page.mouse.move(g.x + g.w / 2, g.y + g.h / 2 + 60, { steps: 10 });
    await page.mouse.up();
    const pinned = (await settledBox(pane)).h;
    expect(pinned).toBeGreaterThan(content);

    await page.getByTestId('add-row').click();
    await page.waitForTimeout(300);
    expect((await boxOf(pane)).h).toBe(pinned);

    // Back on measurement, and measuring what it holds now — the row added
    // while pinned counts, so this is taller than the height it started at.
    await page.getByTestId('release-size').click();
    await expect.poll(async () => (await boxOf(pane)).h).toBeGreaterThan(content);
    await expect.poll(async () => (await boxOf(pane)).h).toBeLessThan(pinned);
  });
});

test.describe('gutter keyboard operation', () => {
  test('a gutter is reachable by Tab and resizes on an arrow key', async ({ page }) => {
    await openStory(page, STORY);
    const pane = page.locator('[data-node="palette-1"]');
    const before = (await settledBox(pane)).h;
    await page.locator('[role="separator"]').first().focus();
    await expect(page.locator('[role="separator"]').first()).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect.poll(async () => (await boxOf(pane)).h).toBeGreaterThan(before);
  });

  test('aria-valuenow tracks what the pane actually became', async ({ page }) => {
    await openStory(page, STORY);
    const gutter = page.locator('[role="separator"]').first();
    await gutter.focus();
    await page.keyboard.press('ArrowDown');
    await expect
      .poll(async () => {
        const now = Number(await gutter.getAttribute('aria-valuenow'));
        const h = (await boxOf(page.locator('[data-node="palette-1"]'))).h;
        return Math.abs(now - h);
      })
      .toBeLessThanOrEqual(1);
  });
});
