import { expect, type Page, test } from '@playwright/test';
import { boxOf, centerOf, openStory, settledBox } from './fixtures.js';

/**
 * Drop-on-edge is a drop *intent* gesture: where inside a pane the cursor lands
 * decides whether the drop inserts or restructures. jsdom has no layout to
 * hit-test against, so the band geometry only means anything here.
 */

const STORY = 'drop-on-edge--split-on-drop';

const readout = (page: Page) => page.locator('[data-testid="doe-readout"]');
const handle = (page: Page, id: string) => page.locator(`[data-windease-drag-handle="${id}"]`);
const pane = (page: Page, id: string) =>
  page.locator(`[data-testid="pane-${id}"]`).locator('xpath=ancestor::*[@data-node][1]');

/** Press on `sourceId`'s header and hold the cursor at `(fx, fy)` inside
 *  `ontoId`, without releasing. */
async function dragOver(
  page: Page,
  sourceId: string,
  ontoId: string,
  fx: number,
  fy: number,
): Promise<void> {
  const from = centerOf(await boxOf(handle(page, sourceId)));
  const box = await boxOf(pane(page, ontoId));
  const to = { x: box.x + box.w * fx, y: box.y + box.h * fy };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.move(to.x, to.y, { steps: 2 });
}

async function dropOn(
  page: Page,
  sourceId: string,
  ontoId: string,
  fx: number,
  fy: number,
): Promise<void> {
  await dragOver(page, sourceId, ontoId, fx, fy);
  await page.mouse.up();
}

test.describe('drop on edge', () => {
  test('a drop in the top band splits the pane, source first', async ({ page }) => {
    await openStory(page, STORY);
    await dropOn(page, 'a', 'b', 0.5, 0.08);
    await expect(readout(page)).toContainText('split-1:a,b');
  });

  test('a drop in the bottom band puts the source second', async ({ page }) => {
    await openStory(page, STORY);
    await dropOn(page, 'a', 'b', 0.5, 0.92);
    await expect(readout(page)).toContainText('split-1:b,a');
  });

  test('the split pane keeps the slot it had', async ({ page }) => {
    await openStory(page, STORY);
    await dropOn(page, 'a', 'c', 0.5, 0.08);
    // `a` left the row, so `b` heads it and the group takes `c`'s slot.
    await expect(readout(page)).toContainText('workbench:b,split-1');
  });

  test('a drop in a main-axis band still plain-inserts', async ({ page }) => {
    await openStory(page, STORY);
    await dropOn(page, 'c', 'a', 0.06, 0.5);
    await expect(readout(page)).not.toContainText('split-1');
    await expect(readout(page)).toContainText('workbench:c,a,b');
  });

  test('the preview covers the half the drop would take', async ({ page }) => {
    await openStory(page, STORY);
    const box = await boxOf(pane(page, 'b'));
    await dragOver(page, 'a', 'b', 0.5, 0.08);

    const preview = page.locator('.windease-split-preview');
    await expect(preview).toBeVisible();
    const pb = await boxOf(preview);
    // The top half of `b`, not the whole pane and not the other half.
    expect(pb.h).toBeLessThan(box.h * 0.75);
    expect(pb.y).toBeLessThan(box.y + box.h * 0.5);
    await page.mouse.up();
  });

  test('no preview is drawn for a main-axis insert', async ({ page }) => {
    await openStory(page, STORY);
    await dragOver(page, 'c', 'a', 0.06, 0.5);
    await expect(page.locator('.windease-split-preview')).toHaveCount(0);
    await page.mouse.up();
  });

  test('the new seam drags', async ({ page }) => {
    await openStory(page, STORY);
    await dropOn(page, 'a', 'b', 0.5, 0.08);
    await expect(readout(page)).toContainText('split-1:a,b');

    const before = await boxOf(pane(page, 'a'));
    const seam = page.locator('[data-affordance]').first();
    await expect(seam).toBeVisible();
    const s = centerOf(await boxOf(seam));
    await page.mouse.move(s.x, s.y);
    await page.mouse.down();
    await page.mouse.move(s.x, s.y + 40, { steps: 10 });
    await page.mouse.up();

    const after = await boxOf(pane(page, 'a'));
    expect(after.h).toBeGreaterThan(before.h + 10);
  });

  test('dragging a pane back out dissolves the group', async ({ page }) => {
    await openStory(page, STORY);
    await dropOn(page, 'a', 'b', 0.5, 0.08);
    await expect(readout(page)).toContainText('split-1:a,b');

    await dropOn(page, 'a', 'c', 0.94, 0.5);
    await expect(readout(page)).not.toContainText('split-1');
  });
});

test.describe("splitPreview 'layout'", () => {
  const near = (a: number, b: number) => Math.abs(a - b) <= 2;

  test('the hovered pane shrinks to the half it will actually get', async ({ page }) => {
    await openStory(page, STORY);
    const before = await settledBox(pane(page, 'b'));
    await dragOver(page, 'a', 'b', 0.5, 0.08);

    const during = await settledBox(pane(page, 'b'));
    expect(during.h).toBeLessThan(before.h * 0.6);
    // Bottom half, because the drop lands on the start edge.
    expect(during.y).toBeGreaterThan(before.y + before.h * 0.4);
    await page.mouse.up();
  });

  test('what the preview showed is what the drop produces', async ({ page }) => {
    await openStory(page, STORY);
    await dragOver(page, 'a', 'b', 0.5, 0.08);
    const previewed = await settledBox(pane(page, 'b'));
    await page.mouse.up();
    await expect(readout(page)).toContainText('split-1:a,b');

    const committed = await settledBox(pane(page, 'b'));
    expect(near(committed.x, previewed.x)).toBe(true);
    expect(near(committed.y, previewed.y)).toBe(true);
    expect(near(committed.w, previewed.w)).toBe(true);
    expect(near(committed.h, previewed.h)).toBe(true);
  });

  test('escaping the drag restores the pane', async ({ page }) => {
    await openStory(page, STORY);
    const before = await settledBox(pane(page, 'b'));
    await dragOver(page, 'a', 'b', 0.5, 0.08);
    expect((await settledBox(pane(page, 'b'))).h).toBeLessThan(before.h * 0.6);

    await page.keyboard.press('Escape');
    await page.mouse.up();

    await expect(readout(page)).not.toContainText('split-1');
    expect(near((await settledBox(pane(page, 'b'))).h, before.h)).toBe(true);
  });

  test("'element' leaves the hovered pane at full size", async ({ page }) => {
    await openStory(page, STORY);
    await page.locator('[data-testid="mode-element"]').check();
    const before = await settledBox(pane(page, 'b'));
    await dragOver(page, 'a', 'b', 0.5, 0.08);

    await expect(page.locator('.windease-split-preview')).toBeVisible();
    expect(near((await settledBox(pane(page, 'b'))).h, before.h)).toBe(true);
    await page.mouse.up();
  });

  test("'none' neither relayouts nor draws", async ({ page }) => {
    await openStory(page, STORY);
    await page.locator('[data-testid="mode-none"]').check();
    const before = await settledBox(pane(page, 'b'));
    await dragOver(page, 'a', 'b', 0.5, 0.08);

    await expect(page.locator('.windease-split-preview')).toHaveCount(0);
    expect(near((await settledBox(pane(page, 'b'))).h, before.h)).toBe(true);
    await page.mouse.up();
    // The intent still commits — 'none' suppresses the drawing, not the drop.
    await expect(readout(page)).toContainText('split-1:a,b');
  });
});
