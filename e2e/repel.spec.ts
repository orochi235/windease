import { expect, type Page, test } from '@playwright/test';
import { type Box, settledBox } from './fixtures.js';

/** `repelStrategy` with spots from `anchorOrigin`: windows asking for one spot are pushed apart. */

const win = (page: Page, n: number) => page.locator(`[data-node="win-${n}"]`);

async function add(page: Page, anchor: string, n: number) {
  await page.locator('[data-testid="anchor"]').selectOption(anchor);
  await page.locator('[data-testid="add"]').click();
  await expect(win(page, n)).toBeVisible();
}

const near = (a: number, b: number) => Math.abs(a - b) <= 1;
const apart = (a: Box, b: Box, gap: number) =>
  a.x + a.w + gap <= b.x + 1 ||
  b.x + b.w + gap <= a.x + 1 ||
  a.y + a.h + gap <= b.y + 1 ||
  b.y + b.h + gap <= a.y + 1;

// The story opens with no windows, so `openStory`'s wait for a placed node would never end.
async function open(page: Page, story: string) {
  await page.goto(`/?story=${story}`);
  await expect(page.locator('[data-testid="add"]')).toBeVisible({ timeout: 30_000 });
}

async function stage(page: Page): Promise<Box> {
  return settledBox(page.locator('.repel-stage'));
}

test.describe('repel', () => {
  test('a center window sits centered, and the next is pushed clear by the gap', async ({
    page,
  }) => {
    await open(page, 'repel--repel');
    await add(page, 'center', 1);
    const s = await stage(page);
    const first = await settledBox(win(page, 1));
    expect(near(first.x + first.w / 2, s.x + s.w / 2)).toBe(true);
    expect(near(first.y + first.h / 2, s.y + s.h / 2)).toBe(true);

    await add(page, 'center', 2);
    expect(apart(first, await settledBox(win(page, 2)), 8)).toBe(true);
    // Placing the second never moves the first.
    expect(await settledBox(win(page, 1))).toEqual(first);
  });

  test('a corner anchor asks for the corner, inset', async ({ page }) => {
    await open(page, 'repel--repel');
    await add(page, 'bottom-right', 1);
    const s = await stage(page);
    const w = await settledBox(win(page, 1));
    expect(near(w.x + w.w, s.x + s.w - 12)).toBe(true);
    expect(near(w.y + w.h, s.y + s.h - 12)).toBe(true);
  });

  test('with no drift, a second window stacks on the first', async ({ page }) => {
    await open(page, 'repel--no-drift');
    await add(page, 'top-left', 1);
    await add(page, 'top-left', 2);
    expect(await settledBox(win(page, 2))).toEqual(await settledBox(win(page, 1)));
  });
});
