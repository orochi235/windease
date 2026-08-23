import { expect, type Page, test } from '@playwright/test';
import { boxOf, centerOf, openStory } from './fixtures.js';

/**
 * Seam-join drives a real pointer past a clamp, which is the one thing jsdom
 * cannot do: the clamp flags only settle after a layout pass, and the armed
 * treatment is pure CSS.
 */

const STORY = 'seam-join--join-on-overshoot';
const KEY_STEP = 8;

const seam = (page: Page, after: string) =>
  page.locator(`[data-affordance-hit="resize-x-${after}"]`);
const pane = (page: Page, id: string) => page.locator(`[data-node="${id}"]`);
const readout = (page: Page) => page.locator('[data-testid="sj-readout"]');

async function attr(page: Page, after: string, name: string): Promise<number> {
  return Number(await seam(page, after).getAttribute(name));
}

/** Press the seam and push it to its clamp, then `past` pixels further, leaving
 *  the button down. The move that *reaches* the clamp still reads unpinned, so
 *  the overshoot has to arrive in its own moves. */
async function pushPast(
  page: Page,
  after: string,
  past: number,
): Promise<{ x: number; y: number }> {
  const travel =
    (await attr(page, after, 'aria-valuemax')) - (await attr(page, after, 'aria-valuenow'));
  const from = centerOf(await boxOf(seam(page, after)));
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + travel, from.y, { steps: 8 });
  await page.mouse.move(from.x + travel + past, from.y, { steps: 4 });
  return from;
}

function armedPanes(page: Page) {
  return page.locator('[data-node][data-join-armed]');
}

function afterStyle(page: Page, selector: string, prop: string) {
  return page
    .locator(selector)
    .evaluate((el, p) => getComputedStyle(el, '::after').getPropertyValue(p), prop);
}

test('the fixture starts wider than its floors', async ({ page }) => {
  await openStory(page, STORY);
  const editor = seam(page, 'editor');
  await expect(editor).toHaveAttribute('aria-valuenow', '240');
  await expect(editor).toHaveAttribute('aria-valuemax', '400');
  await expect(editor).toHaveAttribute('aria-valuemin', '80');
  await expect(readout(page)).toHaveText('Editor, Preview, Console');
});

test('overshooting arms the victim, and release destroys it', async ({ page }) => {
  await openStory(page, STORY);
  await pushPast(page, 'editor', 40);
  await expect(pane(page, 'preview')).toHaveAttribute('data-join-armed', 'true');
  await page.mouse.up();
  await expect(readout(page)).toHaveText('Editor, Console');
  await expect(pane(page, 'preview')).toHaveCount(0);
});

test('Escape mid-gesture clears the marking and destroys nothing', async ({ page }) => {
  await openStory(page, STORY);
  await pushPast(page, 'editor', 40);
  await expect(pane(page, 'preview')).toHaveAttribute('data-join-armed', 'true');
  await page.keyboard.press('Escape');
  await expect(armedPanes(page)).toHaveCount(0);
  await page.mouse.up();
  await expect(readout(page)).toHaveText('Editor, Preview, Console');
});

test('backing off under the threshold disarms, and the pane survives', async ({ page }) => {
  await openStory(page, STORY);
  const from = await pushPast(page, 'editor', 40);
  await expect(pane(page, 'preview')).toHaveAttribute('data-join-armed', 'true');
  const travel = 400 - 240;
  await page.mouse.move(from.x + travel + 10, from.y, { steps: 3 });
  await expect(armedPanes(page)).toHaveCount(0);
  await page.mouse.up();
  await expect(readout(page)).toHaveText('Editor, Preview, Console');
});

test('a destroy-locked pane never arms, however far the seam is pushed', async ({ page }) => {
  await openStory(page, STORY);
  await pushPast(page, 'preview', 200);
  await expect(armedPanes(page)).toHaveCount(0);
  await expect(seam(page, 'preview')).toHaveAttribute('aria-valuenow', '400');
  await page.mouse.up();
  await expect(readout(page)).toHaveText('Editor, Preview, Console');
});

test('arrowing past the floor arms, and Enter commits', async ({ page }) => {
  await openStory(page, STORY);
  const travel = (await attr(page, 'editor', 'aria-valuemax')) - 240;
  await seam(page, 'editor').focus();

  for (let i = 0; i < travel / KEY_STEP; i++) await page.keyboard.press('ArrowRight');
  await expect(seam(page, 'editor')).toHaveAttribute('aria-valuenow', '400');
  await expect(armedPanes(page)).toHaveCount(0);

  // The press that lands on the clamp still reads unpinned, so accumulation
  // starts on the next one — three of them reach the 24px threshold, not past it.
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
  await expect(armedPanes(page)).toHaveCount(0);

  await page.keyboard.press('ArrowRight');
  await expect(pane(page, 'preview')).toHaveAttribute('data-join-armed', 'true');

  await page.keyboard.press('Enter');
  await expect(readout(page)).toHaveText('Editor, Console');
});

test('the armed treatment actually renders', async ({ page }) => {
  await openStory(page, STORY);
  expect(await afterStyle(page, '[data-node="preview"]', 'background-image')).not.toContain(
    'repeating-linear-gradient',
  );

  await pushPast(page, 'editor', 40);
  await expect(pane(page, 'preview')).toHaveAttribute('data-join-armed', 'true');

  expect(await afterStyle(page, '[data-node="preview"]', 'background-image')).toContain(
    'repeating-linear-gradient',
  );
  // The seam is the signal that survives a victim squeezed to a sliver.
  expect(await afterStyle(page, '[data-affordance="resize-x-editor"]', 'background-color')).toBe(
    'rgb(220, 38, 38)',
  );
  await page.mouse.up();
});
