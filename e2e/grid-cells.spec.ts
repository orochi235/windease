import { expect, type Page, test } from '@playwright/test';
import { boxOf, centerOf, dragMouse, openStory, settledBox } from './fixtures.js';

const TABLE = 'grid--periodic-table';

const element = (page: Page, id: string) => page.locator(`[data-node="${id}"]`);

async function place(page: Page, id: string, col: number, row: number): Promise<void> {
  await page.getByTestId('cell-target').selectOption(id);
  await page.getByTestId('cell-col').fill(String(col));
  await page.getByTestId('cell-row').fill(String(row));
  await page.getByRole('button', { name: 'Place' }).click();
}

test.describe('grid placement.cell — periodic table', () => {
  test('each element sits at its group and period, leaving the gaps open', async ({ page }) => {
    await openStory(page, TABLE);
    const h = await settledBox(element(page, 'h'));
    const he = await settledBox(element(page, 'he'));
    const ne = await settledBox(element(page, 'ne'));
    const be = await settledBox(element(page, 'be'));
    const b = await settledBox(element(page, 'b'));

    expect(Math.abs(he.y - h.y)).toBeLessThan(1);
    expect(Math.abs(he.x - ne.x)).toBeLessThan(1);
    expect(ne.y).toBeGreaterThan(he.y);
    // Ten empty groups (3–12) between Be and B.
    expect(b.x - be.x).toBeGreaterThan(10 * be.w);
  });

  test('a cell someone already holds sends the newcomer to unplaced', async ({ page }) => {
    await openStory(page, TABLE);
    await place(page, 'ne', 17, 0);
    await expect(element(page, 'ne')).toHaveCount(0);
    await expect(page.getByTestId('unplaced')).toHaveText('Unplaced: ne');
    await expect(element(page, 'he')).toBeVisible();
  });

  test('a cell past the last column sends the element to unplaced', async ({ page }) => {
    await openStory(page, TABLE);
    await place(page, 'ar', 18, 2);
    await expect(element(page, 'ar')).toHaveCount(0);
    await expect(page.getByTestId('unplaced')).toHaveText('Unplaced: ar');
  });

  test('moving an element to a free cell moves it there', async ({ page }) => {
    await openStory(page, TABLE);
    const be = await settledBox(element(page, 'be'));
    await place(page, 'mg', 5, 1);
    const mg = await settledBox(element(page, 'mg'));
    expect(Math.abs(mg.y - be.y)).toBeLessThan(1);
    expect(mg.x).toBeGreaterThan(be.x + 3 * be.w);
    await expect(page.getByTestId('unplaced')).toHaveText('Unplaced: none');
  });

  test('dragging an element clears its cell, so it drops into the first free cell', async ({
    page,
  }) => {
    await openStory(page, TABLE);
    const h = await settledBox(element(page, 'h'));
    const be = await settledBox(element(page, 'be'));
    const from = centerOf(await boxOf(element(page, 'o')));
    // An empty stretch of period 2.
    const to = { x: be.x + 6 * be.w, y: be.y + be.h / 2 };
    await dragMouse(page, from, to);

    // The one flowing element takes the first free cell: group 2, period 1.
    await expect
      .poll(async () => {
        const o = await boxOf(element(page, 'o'));
        return [Math.round(o.x - be.x), Math.round(o.y - h.y)];
      })
      .toEqual([0, 0]);
  });
});
