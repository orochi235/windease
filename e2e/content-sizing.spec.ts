import { expect, test } from '@playwright/test';
import { boxOf, openStory } from './fixtures.js';

const STORY = 'content-sizing--content-sized-dock';

test.describe('content-driven sizing', () => {
  test('a pane is as tall as its contents, not an equal share', async ({ page }) => {
    await openStory(page, STORY);
    // Three panes with 2, 3 and 1 rows. An equal share would make them equal;
    // jsdom cannot tell the difference because it measures nothing.
    const h = async (id: string) => (await boxOf(page.locator(`[data-node="${id}"]`))).h;
    const [one, two, three] = [await h('palette-1'), await h('palette-2'), await h('palette-3')];
    expect(two).toBeGreaterThan(one);
    expect(one).toBeGreaterThan(three);
  });

  test('adding content grows the pane with no size written', async ({ page }) => {
    await openStory(page, STORY);
    const pane = page.locator('[data-node="palette-1"]');
    const before = (await boxOf(pane)).h;
    await page.getByTestId('add-row').click();
    await expect.poll(async () => (await boxOf(pane)).h).toBeGreaterThan(before);
  });

  test('the layout settles instead of oscillating', async ({ page }) => {
    await openStory(page, STORY);
    const pane = page.locator('[data-node="palette-1"]');
    await page.getByTestId('add-row').click();

    // Sizing is deliberately two-pass — the pane is laid out, measured, then
    // laid out again — so the first reading after a content change is the
    // intermediate one. Wait for it to hold before claiming it settled.
    let last = -1;
    let holds = 0;
    for (let i = 0; i < 40 && holds < 3; i++) {
      const h = (await boxOf(pane)).h;
      holds = h === last ? holds + 1 : 0;
      last = h;
      await page.waitForTimeout(50);
    }
    expect(holds).toBeGreaterThanOrEqual(3);

    // And it stays there: a cycle that re-triggered itself would move again.
    await page.waitForTimeout(400);
    expect((await boxOf(pane)).h).toBe(last);
  });

  test('dragging a gutter pins the pane against further measurement', async ({ page }) => {
    await openStory(page, STORY);
    const pane = page.locator('[data-node="palette-1"]');
    const gutter = page.locator('[role="separator"]').first();
    const g = await boxOf(gutter);
    await page.mouse.move(g.x + g.w / 2, g.y + g.h / 2);
    await page.mouse.down();
    await page.mouse.move(g.x + g.w / 2, g.y + g.h / 2 + 60, { steps: 10 });
    await page.mouse.up();
    const pinned = (await boxOf(pane)).h;
    await page.getByTestId('add-row').click();
    await page.waitForTimeout(300);
    expect((await boxOf(pane)).h).toBe(pinned);
  });

  test('releasing the size hands the pane back to measurement', async ({ page }) => {
    await openStory(page, STORY);
    const pane = page.locator('[data-node="palette-1"]');
    const content = (await boxOf(pane)).h;

    const gutter = page.locator('[role="separator"]').first();
    const g = await boxOf(gutter);
    await page.mouse.move(g.x + g.w / 2, g.y + g.h / 2);
    await page.mouse.down();
    await page.mouse.move(g.x + g.w / 2, g.y + g.h / 2 + 60, { steps: 10 });
    await page.mouse.up();
    const pinned = (await boxOf(pane)).h;
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
    const before = (await boxOf(pane)).h;
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
