import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { boxOf, centerOf, dragMouse, openStory, settledBox } from './fixtures.js';

const FIT = 'desktop--fit';

const node = (page: Page, id: string) => page.locator(`[data-node="${id}"]`);

/** Rendered child order inside a container, left to right on screen. */
function orderOnScreen(page: Page, containerId: string) {
  return page.evaluate((id) => {
    const box = document.querySelector(`[data-node-container="${id}"]`);
    const kids = [...(box?.children ?? [])].filter((e) => e.hasAttribute('data-node'));
    return kids
      .map((e) => ({ id: e.getAttribute('data-node'), x: e.getBoundingClientRect().x }))
      .sort((a, b) => a.x - b.x)
      .map((e) => e.id);
  }, containerId);
}

test.describe('a desktop fitted into a smaller frame', () => {
  test('the 1024px design is drawn at the frame width', async ({ page }) => {
    await openStory(page, FIT);
    const desk = await boxOf(page.locator('[data-node-container="fit-desktop"]'));
    const frame = await boxOf(page.getByTestId('fit-frame'));
    // The frame's 1px border sits outside the fitted area.
    expect(desk.w).toBeCloseTo(frame.w - 2, 0);
    expect((await boxOf(node(page, 'fit-notes'))).w).toBeCloseTo(160, 0);
  });

  test('dragging a window 100 screen px moves it 100 screen px', async ({ page }) => {
    await openStory(page, FIT);
    const before = await boxOf(node(page, 'fit-notes'));
    const from = { x: before.x + 40, y: before.y + 6 };
    await dragMouse(page, from, { x: from.x + 100, y: from.y + 60 });
    const after = await settledBox(node(page, 'fit-notes'));
    expect(after.x - before.x).toBeCloseTo(100, 0);
    expect(after.y - before.y).toBeCloseTo(60, 0);
  });

  test('a strip seam inside the scaled desktop follows the pointer', async ({ page }) => {
    await openStory(page, FIT);
    const seam = page.locator('[data-affordance-hit="resize-x-pane-1"]');
    const before = centerOf(await boxOf(seam));
    const pane = await boxOf(node(page, 'pane-1'));
    await dragMouse(page, before, { x: before.x + 60, y: before.y });
    const after = centerOf(await settledBox(seam));
    expect(after.x - before.x).toBeCloseTo(60, 0);
    expect((await settledBox(node(page, 'pane-1'))).w - pane.w).toBeCloseTo(60, 0);
  });

  test('a pane dropped past the last one lands last', async ({ page }) => {
    await openStory(page, FIT);
    expect(await orderOnScreen(page, 'fit-strip')).toEqual(['pane-1', 'pane-2', 'pane-3']);
    const handle = centerOf(await boxOf(page.locator('[data-windease-drag-handle="pane-1"]')));
    const last = await boxOf(node(page, 'pane-3'));
    // The right quarter of the last pane: past its midpoint on screen.
    const target = { x: last.x + last.w * 0.85, y: last.y + last.h / 2 };
    await page.mouse.move(handle.x, handle.y);
    await page.mouse.down();
    await page.mouse.move(target.x, target.y, { steps: 15 });
    await page.mouse.up();
    await expect
      .poll(() => orderOnScreen(page, 'fit-strip'))
      .toEqual(['pane-2', 'pane-3', 'pane-1']);
  });

  test('a pane dropped short of the last midpoint lands before it', async ({ page }) => {
    await openStory(page, FIT);
    const handle = centerOf(await boxOf(page.locator('[data-windease-drag-handle="pane-1"]')));
    const last = await boxOf(node(page, 'pane-3'));
    const target = { x: last.x + last.w * 0.2, y: last.y + last.h / 2 };
    await page.mouse.move(handle.x, handle.y);
    await page.mouse.down();
    await page.mouse.move(target.x, target.y, { steps: 15 });
    await page.mouse.up();
    await expect
      .poll(() => orderOnScreen(page, 'fit-strip'))
      .toEqual(['pane-2', 'pane-1', 'pane-3']);
  });
});
