import { expect, type Page, test } from '@playwright/test';

const STORY = 'pack-lab--lab';

/** The lab renders no `[data-node]`, so `openStory` would wait forever; a packed canvas is its ready signal. */
async function openLab(page: Page): Promise<void> {
  await page.goto(`/?story=${STORY}`);
  // 30s for the same cold-start reason `openStory` gives in fixtures.ts.
  await expect(page.locator('canvas[role="img"]').first()).toBeVisible({ timeout: 30_000 });
}

test.describe('the pack lab compares packers on a dataset', () => {
  test('a packer turned off drops its canvas and its row', async ({ page }) => {
    await openLab(page);
    const runs = page.getByRole('table', { name: 'Runs' });
    await expect(page.getByRole('combobox', { name: 'Dataset' })).toHaveValue(/story-boxes/);
    const tiles = page.getByRole('img', { name: / packed by / });
    await expect(tiles).toHaveCount(3);
    await expect(page.getByRole('img', { name: /^Pack story boxes packed by / })).toHaveCount(3);
    await expect(runs.locator('tbody tr')).toHaveCount(3);

    await page.getByRole('checkbox', { name: 'column', exact: true }).uncheck();
    await expect(tiles).toHaveCount(2);
    await expect(runs.locator('tbody tr')).toHaveCount(2);
    await expect(runs.getByRole('rowheader', { name: 'Pack story boxes · column' })).toHaveCount(0);
  });

  test('a capture plate packs with its own gap', async ({ page }) => {
    await openLab(page);
    const plate = 'dir:docs/superpowers/plans';
    await page.getByRole('combobox', { name: 'Dataset' }).selectOption({ label: plate });
    await expect(page.getByRole('combobox', { name: 'Dataset' })).toHaveValue(`windease:${plate}`);
    const tiles = page.getByRole('img', { name: new RegExp(`^${plate} packed by `) });
    await expect(tiles).toHaveCount(3);

    const runs = page.getByRole('table', { name: 'Runs' });
    const headers = await runs.getByRole('columnheader').allTextContents();
    const gap = headers.indexOf('gap');
    expect(gap).toBeGreaterThan(0);
    const shelf = runs.getByRole('row', { name: new RegExp(`^${plate} · shelf `) });
    // The row header is the first column, so data cells sit one index left of their header.
    await expect(shelf.getByRole('cell').nth(gap - 1)).toHaveText('1.0');
  });

  test('an engine recipe turned on packs beside the shipped packers', async ({ page }) => {
    await openLab(page);
    const tiles = page.getByRole('img', { name: / packed by / });
    await expect(tiles).toHaveCount(3);

    await page.getByRole('checkbox', { name: 'engine:maxrects-bssf' }).check();
    await expect(tiles).toHaveCount(4);
    const runs = page.getByRole('table', { name: 'Runs' });
    const row = runs.getByRole('row', { name: /· engine:maxrects-bssf / });
    await expect(row).toHaveCount(1);

    const headers = await runs.getByRole('columnheader').allTextContents();
    const unplaced = headers.indexOf('unplaced');
    expect(unplaced).toBeGreaterThan(0);
    await expect(row.getByRole('cell').nth(unplaced - 1)).toHaveText('0');
  });
});
