import { expect, type Page, test } from '@playwright/test';
import { boxOf, centerOf, dragMouse, openStory, settledBox } from './fixtures.js';

const SHEET = 'grid--spreadsheet';

const cell = (page: Page, id: string) => page.locator(`[data-node="${id}"]`);
const seam = (page: Page, id: string) => page.locator(`[data-affordance-hit="${id}"]`);
const tracks = async (page: Page) =>
  JSON.parse((await page.getByTestId('tracks').textContent()) ?? 'null');

test.describe('grid tracks — spreadsheet', () => {
  test('pixel columns hold their width and the share columns split the rest', async ({ page }) => {
    await openStory(page, SHEET);
    const a = await settledBox(cell(page, 'cell-A1'));
    const c = await settledBox(cell(page, 'cell-C1'));
    const d = await settledBox(cell(page, 'cell-D1'));
    const header = await settledBox(cell(page, 'cell-A'));
    expect(a.w).toBeCloseTo(96, 0);
    expect(c.w).toBeCloseTo(d.w, 0);
    expect(header.h).toBeCloseTo(28, 0);
    expect(a.h).toBeCloseTo(26, 0);
  });

  test('dragging the seam after a pixel column widens it and writes tracks', async ({ page }) => {
    await openStory(page, SHEET);
    const before = await settledBox(cell(page, 'cell-B1'));
    const c = await settledBox(cell(page, 'cell-C1'));
    const edge = centerOf(await boxOf(seam(page, 'track-x-2')));

    await dragMouse(page, edge, { x: edge.x + 40, y: edge.y });

    const after = await settledBox(cell(page, 'cell-B1'));
    expect(after.w).toBeCloseTo(before.w + 40, 0);
    // The shares give up the width B took.
    expect((await settledBox(cell(page, 'cell-C1'))).w).toBeCloseTo(c.w - 20, 0);
    expect((await tracks(page)).cols[2]).toBe(136);
  });

  test('dragging the seam between two share columns trades width between them', async ({
    page,
  }) => {
    await openStory(page, SHEET);
    const c = await settledBox(cell(page, 'cell-C1'));
    const d = await settledBox(cell(page, 'cell-D1'));
    const edge = centerOf(await boxOf(seam(page, 'track-x-3')));

    await dragMouse(page, edge, { x: edge.x - 30, y: edge.y });

    const c2 = await settledBox(cell(page, 'cell-C1'));
    const d2 = await settledBox(cell(page, 'cell-D1'));
    expect(c2.w).toBeCloseTo(c.w - 30, 0);
    expect(d2.w).toBeCloseTo(d.w + 30, 0);
    const [shareC, shareD] = (await tracks(page)).cols.slice(3, 5);
    expect(shareC.share + shareD.share).toBeCloseTo(2, 3);
    expect(shareC.share).toBeLessThan(1);
  });

  test('dragging a row seam writes that row, spelling out the implicit rows before it', async ({
    page,
  }) => {
    await openStory(page, SHEET);
    const before = await settledBox(cell(page, 'cell-A2'));
    const edge = centerOf(await boxOf(seam(page, 'track-y-2')));

    await dragMouse(page, edge, { x: edge.x, y: edge.y + 14 });

    expect((await settledBox(cell(page, 'cell-A2'))).h).toBeCloseTo(before.h + 14, 0);
    expect((await tracks(page)).rows).toEqual([28, 26, 40]);
  });

  test('a seam is a named separator an arrow key steps', async ({ page }) => {
    await openStory(page, SHEET);
    const handle = seam(page, 'track-x-1');
    await expect(handle).toHaveAttribute('role', 'separator');
    await expect(handle).toHaveAttribute('aria-label', 'resize column 2');
    await expect(handle).toHaveAttribute('aria-valuenow', '96');

    await handle.focus();
    await page.keyboard.press('ArrowRight');

    await expect(handle).toHaveAttribute('aria-valuenow', '104');
    expect((await tracks(page)).cols[1]).toBe(104);
  });
});
