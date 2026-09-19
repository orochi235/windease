import { expect, type Page, test } from '@playwright/test';
import { boxOf, centerOf, dragMouse, openStory, settledBox } from './fixtures.js';

const BOARD = 'grid--dashboard';
/** One 30px row plus the 8px gap. */
const ROW = 38;

const panel = (page: Page, id: string) => page.locator(`[data-node="${id}"]`);
const seam = (page: Page, id: string) => page.locator(`[data-affordance-hit="${id}"]`);

test.describe("grid compact: 'up' — dashboard", () => {
  test('panels stated lower float up under the panels above them', async ({ page }) => {
    await openStory(page, BOARD);
    const cpu = await settledBox(panel(page, 'cpu'));
    const net = await settledBox(panel(page, 'net'));
    const load = await settledBox(panel(page, 'load'));
    const uptime = await settledBox(panel(page, 'uptime'));
    expect(load.y).toBeCloseTo(cpu.y + cpu.h + 8, 0);
    expect(uptime.y).toBeCloseTo(net.y + net.h + 8, 0);
  });

  test('without compact the panels keep the rows their cells state', async ({ page }) => {
    await openStory(page, BOARD);
    const cpu = await settledBox(panel(page, 'cpu'));
    const before = await settledBox(panel(page, 'load'));

    await page.getByTestId('compact-toggle').uncheck();

    await expect
      .poll(async () => (await boxOf(panel(page, 'load'))).y)
      .toBeCloseTo(cpu.y + 5 * ROW, 0);
    expect(before.y).toBeCloseTo(cpu.y + 3 * ROW, 0);
  });

  test('growing a panel pushes the panels below it down', async ({ page }) => {
    await openStory(page, BOARD);
    const disk = await settledBox(panel(page, 'disk'));
    const net = await settledBox(panel(page, 'net'));
    const uptime = await settledBox(panel(page, 'uptime'));
    const edge = centerOf(await boxOf(seam(page, 'resize-y-disk')));

    await dragMouse(page, edge, { x: edge.x, y: edge.y + ROW });

    expect((await settledBox(panel(page, 'disk'))).h).toBeCloseTo(disk.h + ROW, 0);
    expect((await settledBox(panel(page, 'net'))).y).toBeCloseTo(net.y + ROW, 0);
    expect((await settledBox(panel(page, 'uptime'))).y).toBeCloseTo(uptime.y + ROW, 0);
  });

  test('without compact the panel below stops the growth', async ({ page }) => {
    await openStory(page, BOARD);
    await page.getByTestId('compact-toggle').uncheck();
    // Disk's seam can still shrink it, but reaches no further than its two rows.
    await expect(seam(page, 'resize-y-disk')).toHaveAttribute('aria-valuemax', '2');
    await page.getByTestId('compact-toggle').check();
    await expect(seam(page, 'resize-y-disk')).not.toHaveAttribute('aria-valuemax', '2');
  });
});
