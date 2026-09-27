import { expect, type Page, test } from '@playwright/test';
import { centerOf, dropAt, openStory, settledBox } from './fixtures.js';

/**
 * `collapsePolicy` decides what an empty container does with its room. The
 * part only a browser shows is the drag: a sidebar shut to nothing has no box
 * to drop on, and `dragTo` opening it under a held pointer is the way back in.
 */

const STORY = 'policies--collapse--sidebar-that-shuts';
const ROW = 720;
const GAP = 8;
const SIDE = 220;

const handle = (page: Page, id: string) => page.locator(`[data-windease-drag-handle="${id}"]`);
const group = (page: Page, id: string) => page.locator(`[data-testid="${id}"]`);

/**
 * The width of the box the row gave `id`. That box is the group's parent: the
 * group itself keeps its borders at any width and is clipped by it. Read from
 * the element rather than `boundingBox`, which a box shut to zero may not have.
 */
const widthOf = (page: Page, id: string) =>
  group(page, id).evaluate((el) =>
    Math.round((el.parentElement ?? el).getBoundingClientRect().width),
  );

const parentOf = (page: Page, pane: string) =>
  page
    .locator(`[data-node="${pane}"]`)
    .evaluate((el) => el.getAttribute('data-node-container') ?? '');

async function choose(page: Page, policy: string): Promise<void> {
  await page.getByTestId('policy').selectOption(policy);
  await expect.poll(() => widthOf(page, 'sidebar')).toBe(SIDE);
}

/**
 * Press on `pane` and carry it far enough to start a drag, leaving the button
 * down. A fixed offset rather than a named place: a pane already sitting where
 * it was told to go would never cross the drag threshold.
 */
async function pickUp(page: Page, pane: string): Promise<void> {
  const from = centerOf(await settledBox(handle(page, pane)));
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 24, from.y + 24, { steps: 12 });
  // Without this, "the sidebar stayed shut" also passes for a drag that never began.
  await expect(page.locator('[data-drop-target]')).toHaveCount(1);
}

/** Carry the held pane to the middle of `target` as it now stands, and let go. */
async function dropOn(page: Page, target: string): Promise<void> {
  const to = dropAt(centerOf(await settledBox(group(page, target))));
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await expect(group(page, target)).toHaveAttribute('data-drop-target', 'true');
  await page.mouse.up();
}

async function emptyTheSidebar(page: Page): Promise<void> {
  await pickUp(page, 'files');
  await dropOn(page, 'main');
  await expect.poll(() => parentOf(page, 'files')).toBe('main');
}

test.describe('collapsePolicy', () => {
  test('a sidebar shuts when its last pane leaves, and keeps its stored width', async ({
    page,
  }) => {
    await openStory(page, STORY);
    await choose(page, 'shut');
    expect(await widthOf(page, 'main')).toBe(ROW - SIDE - GAP);

    await emptyTheSidebar(page);

    await expect.poll(() => widthOf(page, 'sidebar')).toBe(0);
    // The whole row, with no gap held for a pane that is not in it.
    await expect.poll(() => widthOf(page, 'main')).toBe(ROW);
    await expect(page.getByTestId('stored-width')).toHaveText(String(SIDE));
  });

  test('a shut sidebar stays shut under a drag when the policy has no dragTo', async ({ page }) => {
    await openStory(page, STORY);
    await choose(page, 'shut');
    await emptyTheSidebar(page);
    await expect.poll(() => widthOf(page, 'sidebar')).toBe(0);

    await pickUp(page, 'files');
    // Long enough for a reopening to have settled, had one started.
    await page.waitForTimeout(400);
    expect(await widthOf(page, 'sidebar')).toBe(0);
    await page.mouse.up();
  });

  test('dragTo opens a shut sidebar for the drag and takes the drop', async ({ page }) => {
    await openStory(page, STORY);
    await choose(page, 'reopen');
    await emptyTheSidebar(page);
    await expect.poll(() => widthOf(page, 'sidebar')).toBe(0);

    await pickUp(page, 'files');
    await expect.poll(() => widthOf(page, 'sidebar')).toBe(SIDE);
    await dropOn(page, 'sidebar');

    await expect.poll(() => parentOf(page, 'files')).toBe('sidebar');
    await expect.poll(() => widthOf(page, 'sidebar')).toBe(SIDE);
  });

  test('a sidebar opened for a drag shuts again when the pane lands elsewhere', async ({
    page,
  }) => {
    await openStory(page, STORY);
    await choose(page, 'reopen');
    await emptyTheSidebar(page);

    await pickUp(page, 'editor');
    await expect.poll(() => widthOf(page, 'sidebar')).toBe(SIDE);
    await dropOn(page, 'main');

    await expect.poll(() => widthOf(page, 'sidebar')).toBe(0);
    await expect.poll(() => widthOf(page, 'main')).toBe(ROW);
  });

  test('a rail is wide enough to drop on', async ({ page }) => {
    await openStory(page, STORY);
    await choose(page, 'rail');
    await emptyTheSidebar(page);
    await expect.poll(() => widthOf(page, 'sidebar')).toBe(24);
    await expect.poll(() => widthOf(page, 'main')).toBe(ROW - 24 - GAP);

    await pickUp(page, 'files');
    await dropOn(page, 'sidebar');

    await expect.poll(() => parentOf(page, 'files')).toBe('sidebar');
    await expect.poll(() => widthOf(page, 'sidebar')).toBe(SIDE);
  });

  test('stay leaves an empty sidebar at its width', async ({ page }) => {
    await openStory(page, STORY);
    await choose(page, 'stay');
    await emptyTheSidebar(page);

    // Nothing is expected to move, so wait out the settle before reading.
    await page.waitForTimeout(400);
    expect(await widthOf(page, 'sidebar')).toBe(SIDE);
    expect(await widthOf(page, 'main')).toBe(ROW - SIDE - GAP);
  });
});
