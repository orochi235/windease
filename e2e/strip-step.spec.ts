import { expect, type Page, test } from '@playwright/test';
import { centerOf, openStory, settledBox } from './fixtures.js';

const STORY = 'strip--steps';
const CELL = 12;
const ROW = 60 * CELL + 5;

const pane = (page: Page, name: string) => page.locator(`[data-node="step-${name}"]`);
const seam = (page: Page, after: string) =>
  page.locator(`[data-affordance-hit="resize-x-step-${after}"]`);

async function widths(page: Page): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const name of ['shell', 'editor', 'logs']) {
    out[name] = Math.round((await settledBox(pane(page, name))).w);
  }
  return out;
}

test.describe('strip step', () => {
  test('sizes panes in whole cells and gives the last fill pane the remainder', async ({
    page,
  }) => {
    await openStory(page, STORY);
    expect(await widths(page)).toEqual({ shell: 240, editor: 240, logs: 245 });
  });

  test('a seam drag lands on a whole cell near the pointer', async ({ page }) => {
    await openStory(page, STORY);
    const grip = centerOf(await settledBox(seam(page, 'shell')));
    await page.mouse.move(grip.x, grip.y);
    await page.mouse.down();
    await page.mouse.move(grip.x + 41, grip.y, { steps: 20 });
    await page.mouse.up();

    const w = await widths(page);
    expect(w.shell! % CELL).toBe(0);
    expect(Math.abs(w.shell! - 281)).toBeLessThanOrEqual(CELL / 2);
    expect(w.shell! + w.editor!).toBe(480);
    expect(w.logs).toBe(245);
    expect(w.shell! + w.editor! + w.logs!).toBe(ROW);
  });

  test('an arrow press moves the seam one cell', async ({ page }) => {
    await openStory(page, STORY);
    await seam(page, 'shell').focus();
    await page.keyboard.press('ArrowRight');
    await expect.poll(async () => (await widths(page)).shell).toBe(252);
    await expect(seam(page, 'shell')).toHaveAttribute('aria-valuenow', '252');
    await expect(pane(page, 'shell').locator('[data-cols]')).toHaveAttribute('data-cols', '21');
  });
});
