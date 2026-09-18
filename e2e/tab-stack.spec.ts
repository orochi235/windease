import { expect, type Page, test } from '@playwright/test';
import { boxOf, centerOf, openStory } from './fixtures.js';

/**
 * Tab-stacking is a drop *intent* gesture: where in a pane the cursor lands
 * decides whether the drop inserts or restructures. jsdom has no layout to
 * hit-test against, so the band geometry only means anything here.
 */

const STORY = 'tab-stack--stack-on-drop';

const readout = (page: Page) => page.locator('[data-testid="ts-readout"]');
const handle = (page: Page, id: string) => page.locator(`[data-windease-drag-handle="${id}"]`);
const pane = (page: Page, id: string) => page.locator(`[data-testid="pane-${id}"]`);

/** Drag `sourceId` to a point inside `ontoId`, at `frac` across its width. */
async function dragOnto(page: Page, sourceId: string, ontoId: string, frac: number) {
  const from = centerOf(await boxOf(handle(page, sourceId)));
  const box = await boxOf(pane(page, ontoId).locator('xpath=ancestor::*[@data-node][1]'));
  const to = { x: box.x + box.w * frac, y: box.y + box.h / 2 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.move(to.x, to.y, { steps: 2 });
  await page.mouse.up();
}

test.describe('tab stacking', () => {
  test('a drop in the middle of a pane stacks the two', async ({ page }) => {
    await openStory(page, STORY);
    await expect(readout(page)).toHaveText('editor preview console');

    await dragOnto(page, 'editor', 'preview', 0.5);

    await expect(readout(page)).toHaveText(/\[preview editor\] console/);
    await expect(page.locator('[data-testid^="stack-"]')).toBeVisible();
    await expect(page.locator('[data-testid="tab-preview"]')).toBeVisible();
    await expect(page.locator('[data-testid="tab-editor"]')).toBeVisible();
  });

  test('only the active tab renders a body', async ({ page }) => {
    await openStory(page, STORY);
    await dragOnto(page, 'editor', 'preview', 0.5);

    // The drop activates what was dropped.
    await expect(page.locator('[data-testid="tab-editor"]')).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(pane(page, 'editor')).toBeVisible();
    await expect(pane(page, 'preview')).toHaveCount(0);

    await page.locator('[data-testid="tab-preview"]').click();
    await expect(pane(page, 'preview')).toBeVisible();
    await expect(pane(page, 'editor')).toHaveCount(0);
  });

  test('arrow keys move between tabs', async ({ page }) => {
    await openStory(page, STORY);
    await dragOnto(page, 'editor', 'preview', 0.5);

    await page.locator('[data-testid="tab-editor"]').focus();
    await page.keyboard.press('ArrowLeft');
    await expect(page.locator('[data-testid="tab-preview"]')).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  test('dragging the last tab out dissolves the stack', async ({ page }) => {
    await openStory(page, STORY);
    await dragOnto(page, 'editor', 'preview', 0.5);
    await expect(readout(page)).toHaveText(/\[preview editor\] console/);

    // Out of the stack and onto the far edge of console.
    await dragOnto(page, 'editor', 'console', 0.95);

    await expect(page.locator('[data-testid^="stack-"]')).toHaveCount(0);
    await expect(readout(page)).toHaveText('preview console editor');
  });

  test('a drop near a pane edge still inserts, and stacks nothing', async ({ page }) => {
    await openStory(page, STORY);

    await dragOnto(page, 'console', 'editor', 0.05);

    await expect(page.locator('[data-testid^="stack-"]')).toHaveCount(0);
    await expect(readout(page)).toHaveText('console editor preview');
  });
});

test.describe("stack config show: 'dropped'", () => {
  const SHOW = 'tab-stack--show-dropped';
  const active = (page: Page) => page.locator('[data-testid="ts-active"]');

  /** Drag `sourceId` by its header into the middle of the stack's body. */
  async function dragIntoStack(page: Page, sourceId: string) {
    const from = centerOf(await boxOf(handle(page, sourceId)));
    const to = centerOf(await boxOf(page.locator('[data-testid="stack-docs"]')));
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 12 });
    await page.mouse.move(to.x, to.y, { steps: 2 });
    await page.mouse.up();
  }

  test('a pane dropped into the stack becomes the tab on show', async ({ page }) => {
    await openStory(page, SHOW);
    await expect(active(page)).toHaveText('readme');

    await dragIntoStack(page, 'notes');

    await expect(page.locator('[data-testid="tab-notes"]')).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(active(page)).toHaveText('notes');
    await expect(pane(page, 'notes')).toBeVisible();
    await expect(pane(page, 'readme')).toHaveCount(0);
  });
});
