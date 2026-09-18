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

const DOCK = 'grid--dock';

function zoneOf(page: Page, nodeId: string) {
  return page.evaluate(
    (id) =>
      document
        .querySelector(`[data-node="${id}"]`)
        ?.closest('[data-node-container]')
        ?.getAttribute('data-node-container') ?? null,
    nodeId,
  );
}

async function dragInto(page: Page, id: string, zone: string): Promise<void> {
  const from = centerOf(await boxOf(element(page, id)));
  const to = await boxOf(page.locator(`[data-node-container="${zone}"]`));
  await dragMouse(page, from, { x: to.x + to.w - 20, y: to.y + to.h / 2 });
}

test.describe('grid fixed cells — dock', () => {
  test('icons keep their cell size instead of filling the grid', async ({ page }) => {
    await openStory(page, DOCK);
    for (const id of ['phone', 'mail']) {
      const b = await settledBox(element(page, id));
      expect([Math.round(b.w), Math.round(b.h)]).toEqual([56, 56]);
    }
  });

  test('the library wraps after as many icons as fit across', async ({ page }) => {
    await openStory(page, DOCK);
    // (456 + 12) / (56 + 12) → 6 columns, so the seventh app starts row two.
    const mail = await settledBox(element(page, 'mail'));
    const clock = await settledBox(element(page, 'clock'));
    const news = await settledBox(element(page, 'news'));
    expect(Math.round(clock.y - mail.y)).toBe(0);
    expect(Math.round(news.x - mail.x)).toBe(0);
    expect(Math.round(news.y - mail.y)).toBe(68);
  });

  test('an icon dropped on the dock joins it, and a sixth is refused', async ({ page }) => {
    await openStory(page, DOCK);
    await dragInto(page, 'mail', 'dock');
    await expect.poll(() => zoneOf(page, 'mail')).toBe('dock');
    await expect(element(page, 'mail')).toHaveCSS('width', '56px');

    await dragInto(page, 'maps', 'dock');
    await page.waitForTimeout(200);
    expect(await zoneOf(page, 'maps')).toBe('app-library');
  });
});
