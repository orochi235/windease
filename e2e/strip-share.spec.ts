import { expect, type Page, test } from '@playwright/test';
import { centerOf, dragMouse, openStory, settledBox } from './fixtures.js';

const STORY = 'strip--shares';
// gap 6 between three panes, padding 6 either side.
const CHROME = 2 * 6 + 2 * 6;

const pane = (page: Page, id: string) => page.locator(`[data-node="${id}"]`);
const seam = (page: Page, after: string) =>
  page.locator(`[data-affordance-hit="resize-x-${after}"]`);

/** A range input can't be `fill`ed; set it the way React hears it. */
async function setWidth(page: Page, w: number): Promise<void> {
  await page.getByTestId('share-width').evaluate((el, value) => {
    const input = el as HTMLInputElement;
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    set?.call(input, String(value));
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, w);
}

async function fractions(page: Page, width: number): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const id of ['nav', 'editor', 'inspector']) {
    out[id] = (await settledBox(pane(page, id))).w / (width - CHROME);
  }
  return out;
}

test.describe('strip placement.share', () => {
  test('the panes keep their shares when the container narrows', async ({ page }) => {
    await openStory(page, STORY);
    const wide = await fractions(page, 720);
    expect(wide.nav).toBeCloseTo(0.2, 2);
    expect(wide.editor).toBeCloseTo(0.5, 2);
    await setWidth(page, 400);
    await expect.poll(async () => Math.round((await settledBox(pane(page, 'nav'))).w)).toBe(75);
    const narrow = await fractions(page, 400);
    for (const id of ['nav', 'editor', 'inspector']) expect(narrow[id]).toBeCloseTo(wide[id]!, 2);
  });

  test('a seam drag moves by the drag and writes shares the row keeps', async ({ page }) => {
    await openStory(page, STORY);
    const before = await settledBox(pane(page, 'nav'));
    const grip = centerOf(await settledBox(seam(page, 'nav')));
    await dragMouse(page, grip, { x: grip.x + 60, y: grip.y });

    const after = await settledBox(pane(page, 'nav'));
    expect(Math.abs(after.w - (before.w + 60))).toBeLessThan(2);
    await expect(pane(page, 'nav').locator('[data-share]')).not.toHaveAttribute(
      'data-share',
      '0.2',
    );

    const dragged = await fractions(page, 720);
    await setWidth(page, 480);
    await expect
      .poll(async () => (await settledBox(pane(page, 'nav'))).w / (480 - CHROME))
      .toBeCloseTo(dragged.nav!, 2);
    const narrow = await fractions(page, 480);
    for (const id of ['editor', 'inspector']) expect(narrow[id]).toBeCloseTo(dragged[id]!, 2);
  });

  test("under resizeMode 'neighbor' only the two panes at the seam change", async ({ page }) => {
    await openStory(page, STORY);
    await page.getByTestId('share-mode').selectOption('neighbor');
    const nav = await settledBox(pane(page, 'nav'));
    const inspector = await settledBox(pane(page, 'inspector'));
    const grip = centerOf(await settledBox(seam(page, 'editor')));
    await dragMouse(page, grip, { x: grip.x + 50, y: grip.y });

    const inspectorAfter = await settledBox(pane(page, 'inspector'));
    expect(Math.abs(inspectorAfter.w - (inspector.w - 50))).toBeLessThan(2);
    expect(Math.abs((await settledBox(pane(page, 'nav'))).w - nav.w)).toBeLessThan(0.5);
  });
});
