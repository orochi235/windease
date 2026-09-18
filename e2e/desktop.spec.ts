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

/** Where placement `(0, 0)` lands: inside the desktop's border. */
function deskOf(page: Page): Promise<{ x: number; y: number }> {
  return page.locator('[data-node-container="desktop"]').evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x + el.clientLeft, y: r.y + el.clientTop };
  });
}

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

  test("clamp: 'all' stops a dragged window at the desktop's edge", async ({ page }) => {
    await openStory(page, `${BEHAVIOR}&arg-clamp=all`);
    const desk = await deskOf(page);
    const { at } = await barOf(page, 'win-1');
    await dragMouse(page, at, { x: at.x - 200, y: at.y - 100 });
    const after = await settledBox(node(page, 'win-1'));
    expect(after.x).toBeCloseTo(desk.x, 0);
    expect(after.y).toBeCloseTo(desk.y, 0);
  });

  test("clamp: 'bar' keeps the title bar on the desktop, body hanging below", async ({ page }) => {
    await openStory(page, `${BEHAVIOR}&arg-clamp=bar`);
    const desk = await deskOf(page);
    const { at } = await barOf(page, 'win-2');
    await dragMouse(page, at, { x: at.x, y: at.y + 400 });
    const after = await settledBox(node(page, 'win-2'));
    // The story lays out against a 360px viewport, which its border-box does not shrink.
    expect(after.y).toBeCloseTo(desk.y + 360 - 26, 0);
  });

  test('a window past the left edge opens scrolled out of view and scrolls into it', async ({
    page,
  }) => {
    await openStory(page, BEHAVIOR);
    const scroller = page.getByTestId('desktop-scroller');
    const view = await boxOf(scroller);
    // The desktop's origin stays at the scroller's left edge.
    expect((await deskOf(page)).x).toBeCloseTo(view.x + 1, 0);
    expect((await boxOf(node(page, 'win-3'))).x).toBeLessThan(view.x);

    await scroller.evaluate((el) => {
      el.scrollLeft = 0;
    });
    const shown = await settledBox(node(page, 'win-3'));
    expect(shown.x).toBeCloseTo(view.x + 1, 0);
  });

  test('dragging a window past the left edge leaves the others where they are', async ({
    page,
  }) => {
    await openStory(page, BEHAVIOR);
    const two = await boxOf(node(page, 'win-2'));
    const { at } = await barOf(page, 'win-1');
    await dragMouse(page, at, { x: at.x - 150, y: at.y });
    await settledBox(node(page, 'win-1'));
    expect(await settledBox(node(page, 'win-2'))).toEqual(two);
  });

  test("overflow: 'clip' leaves nothing to scroll to", async ({ page }) => {
    await openStory(page, `${BEHAVIOR}&arg-overflow=clip`);
    const scroller = page.getByTestId('desktop-scroller');
    const extent = await scroller.evaluate((el) => ({
      over: el.scrollWidth - el.clientWidth,
      left: el.scrollLeft,
    }));
    expect(extent).toEqual({ over: 0, left: 0 });
  });

  test('the minimize box rolls a window up and back down', async ({ page }) => {
    await openStory(page, BEHAVIOR);
    const before = await boxOf(node(page, 'win-1'));
    const toggle = page.getByRole('button', { name: 'minimize win-1' });
    await toggle.click();
    expect(await settledBox(node(page, 'win-1'))).toMatchObject({ ...before, h: 28 });

    await page.getByRole('button', { name: 'restore win-1' }).press('Enter');
    expect(await settledBox(node(page, 'win-1'))).toEqual(before);
  });

  test('there is no minimize box unless minimizable is set', async ({ page }) => {
    await openStory(page, `${BEHAVIOR}&arg-minimizable=false`);
    await expect(page.getByRole('button', { name: 'minimize win-1' })).toHaveCount(0);
  });

  test("clamp brings back a window left on a monitor that's gone", async ({ page }) => {
    await openStory(page, `${BEHAVIOR}&arg-clamp=all`);
    const desk = await deskOf(page);
    expect((await settledBox(node(page, 'win-3'))).x).toBeCloseTo(desk.x, 0);
  });
});

test.describe('desktop raise policy', () => {
  const RAISE = 'desktop--raise-policy';

  for (const mode of ['click', 'focus'] as const) {
    test(`raise: '${mode}' brings a pressed window to the top`, async ({ page }) => {
      await openStory(page, `${RAISE}&arg-raise=${mode}`);
      const one = await boxOf(node(page, 'win-1'));
      const p = overlapCenter(one, await boxOf(node(page, 'win-2')));
      expect(await hitAt(page, p)).toBe('win-2');
      await page.mouse.click(one.x + 12, one.y + one.h / 2);
      await expect.poll(() => hitAt(page, p)).toBe('win-1');
    });
  }

  test("raise: 'click' still delivers the press that raised the window", async ({ page }) => {
    await openStory(page, `${RAISE}&arg-raise=click`);
    // win-2 sits under win-3, but its title bar is clear of every other window.
    await expect(node(page, 'win-2')).toHaveCSS('z-index', '2');
    const press = page.getByTestId('press-win-2');
    await press.click();
    await expect(node(page, 'win-2')).toHaveCSS('z-index', '3');
    await expect(press).toHaveText('1');
  });
});
