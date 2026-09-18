import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { type Box, boxOf, dragMouse, openStory, settledBox } from './fixtures.js';

const SHADE = 'desktop--shade';
const ICON = 'desktop--icon-minimize';
const BEHAVIOR = 'desktop--behavior&mode=preview';

const node = (page: Page, id: string) => page.locator(`[data-node="${id}"]`);

/** The node a real pointer would land on at this point. */
function hitAt(page: Page, p: { x: number; y: number }) {
  return page.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y);
    return el?.closest('[data-node]')?.getAttribute('data-node') ?? null;
  }, p);
}

function overlapCenter(a: Box, b: Box): { x: number; y: number } {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.w, b.x + b.w);
  const bottom = Math.min(a.y + a.h, b.y + b.h);
  expect(right).toBeGreaterThan(left);
  expect(bottom).toBeGreaterThan(top);
  return { x: (left + right) / 2, y: (top + bottom) / 2 };
}

test.describe('desktop stacking', () => {
  test('a window draws over the icon beneath it', async ({ page }) => {
    await openStory(page, SHADE);
    const p = overlapCenter(await boxOf(node(page, 'icon-2')), await boxOf(node(page, 'win-3')));
    expect(await hitAt(page, p)).toBe('win-3');
  });

  test('the later window is on top where two overlap', async ({ page }) => {
    await openStory(page, SHADE);
    const p = overlapCenter(await boxOf(node(page, 'win-1')), await boxOf(node(page, 'win-2')));
    expect(await hitAt(page, p)).toBe('win-2');
  });

  test('pressing a window raises it', async ({ page }) => {
    await openStory(page, SHADE);
    const one = await boxOf(node(page, 'win-1'));
    const p = overlapCenter(one, await boxOf(node(page, 'win-2')));
    // Its left edge, clear of both other windows.
    await page.mouse.click(one.x + 12, one.y + one.h / 2);
    await expect.poll(() => hitAt(page, p)).toBe('win-1');
  });
});

test.describe('desktop minimize', () => {
  test('shade rolls a window up where it stands', async ({ page }) => {
    await openStory(page, SHADE);
    const before = await boxOf(node(page, 'win-2'));
    await page.getByTestId('minimize-win-2').click();
    const after = await settledBox(node(page, 'win-2'));
    expect(after).toMatchObject({ x: before.x, y: before.y, w: before.w, h: 28 });
  });

  test('icon mode sends a window to the icon row, and pressing it restores it', async ({
    page,
  }) => {
    await openStory(page, ICON);
    const before = await boxOf(node(page, 'win-2'));
    const lastIcon = await boxOf(node(page, 'icon-3'));

    await page.getByTestId('minimize-win-2').click();
    const iconified = await settledBox(node(page, 'win-2'));
    expect(iconified).toMatchObject({ y: lastIcon.y, w: 72, h: 64 });
    expect(iconified.x).toBeGreaterThan(lastIcon.x);

    await page.getByTestId('restore-win-2').click();
    expect(await settledBox(node(page, 'win-2'))).toEqual(before);
  });
});

/** A point on `id`'s title bar, clear of its right-hand corner. */
async function barOf(page: Page, id: string) {
  const b = await boxOf(node(page, id));
  return { box: b, at: { x: b.x + 40, y: b.y + 12 } };
}

test.describe('desktop behavior keys', () => {
  test('drag moves a window by its title bar', async ({ page }) => {
    await openStory(page, BEHAVIOR);
    const { box, at } = await barOf(page, 'win-1');
    await dragMouse(page, at, { x: at.x + 60, y: at.y + 40 });
    const after = await settledBox(node(page, 'win-1'));
    expect(after.x - box.x).toBeCloseTo(60, 0);
    expect(after.y - box.y).toBeCloseTo(40, 0);
  });

  test("drag: 'y' moves a window vertically only", async ({ page }) => {
    await openStory(page, `${BEHAVIOR}&arg-drag=y`);
    const { box, at } = await barOf(page, 'win-1');
    await dragMouse(page, at, { x: at.x + 60, y: at.y + 40 });
    const after = await settledBox(node(page, 'win-1'));
    expect(after.x).toBeCloseTo(box.x, 0);
    expect(after.y - box.y).toBeCloseTo(40, 0);
  });
});
