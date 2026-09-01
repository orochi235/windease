import { expect, test } from '@playwright/test';
import { boxOf, openStory, settledBox } from './fixtures.js';

/**
 * Browser coverage for the capability stories. Each of these is a gesture the
 * unit tests can only approximate: jsdom has no ResizeObserver, no scrolling
 * box and no real pointer, which is most of what these features are made of.
 */

const orders = (page: import('@playwright/test').Page) =>
  page.locator('.cap-readout').allInnerTexts();

test.describe('keyboard move', () => {
  const STORY = 'keyboard-move--move-with-shift-arrow';

  test('shift+arrow reorders within a group', async ({ page }) => {
    await openStory(page, STORY);
    const before = await orders(page);
    await page.locator('[data-node="alpha"]').click();
    await page.keyboard.press('Shift+ArrowDown');
    await expect.poll(async () => (await orders(page))[0]).not.toBe(before[0]);
  });

  test('shift+arrow reparents across groups', async ({ page }) => {
    await openStory(page, STORY);
    await page.locator('[data-node="bravo"]').click();
    await page.keyboard.press('Shift+ArrowRight');
    await expect.poll(async () => (await orders(page))[1]).toContain('bravo');
  });

  test('a move-locked pane refuses without throwing', async ({ page }) => {
    await openStory(page, STORY);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.locator('[data-node="charlie"]').click();
    const before = await orders(page);
    await page.keyboard.press('Shift+ArrowUp');
    await page.waitForTimeout(200);
    expect(await orders(page)).toEqual(before);
    expect(errors).toEqual([]);
  });
});

test.describe('flow mode', () => {
  const STORY = 'flow-mode--flow-versus-placed';

  test('CSS arranges the panes, and the strategy takes back over when untoggled', async ({
    page,
  }) => {
    await openStory(page, STORY);
    const pane = page.locator('[data-node="alpha"]');
    const inFlow = await boxOf(pane);
    await page.locator('[data-testid="flow-toggle"]').uncheck();
    await expect.poll(async () => Math.round((await boxOf(pane)).h)).not.toBe(Math.round(inFlow.h));
  });

  test('a flow pane carries no inline positioning', async ({ page }) => {
    await openStory(page, STORY);
    const style = await page.locator('[data-node="alpha"]').getAttribute('style');
    expect(style ?? '').not.toContain('position: absolute');
  });
});

test.describe('flow mode on a preset', () => {
  const STORY = 'flow-mode--preset-flow-column';

  const focused = (page: import('@playwright/test').Page) =>
    page.evaluate(
      () => document.activeElement?.closest('[data-node]')?.getAttribute('data-node') ?? null,
    );

  // The column is a <Panel> that both hosts a container and renders in flow, so
  // it has no placements to publish and has to measure its children instead.
  // Without that they carry no geometry and the resolver cannot score them.
  test('an arrow key moves down a flow preset column', async ({ page }) => {
    await openStory(page, STORY);
    await page.locator('[data-node="fp-a"]').click();
    await expect.poll(() => focused(page)).toBe('fp-a');

    await page.keyboard.press('ArrowDown');

    await expect.poll(() => focused(page)).toBe('fp-b');
  });

  test('an arrow key crosses from the flow column to the placed sibling', async ({ page }) => {
    await openStory(page, STORY);
    await page.locator('[data-node="fp-a"]').click();
    await expect.poll(() => focused(page)).toBe('fp-a');

    await page.keyboard.press('ArrowRight');

    await expect.poll(() => focused(page)).toBe('fp-right');
  });
});

test.describe('grid overflowMode', () => {
  const STORY = 'scrolling--grid-overflow-modes';
  const gridBox = (page: import('@playwright/test').Page) =>
    boxOf(page.locator('[data-node-container="grid"]'));

  test('scroll grows the box past its viewport', async ({ page }) => {
    await openStory(page, STORY);
    const squeezed = (await gridBox(page)).h;
    await page.locator('[data-testid="mode-scroll"]').check();
    await expect.poll(async () => (await gridBox(page)).h).toBeGreaterThan(squeezed);
  });

  test('unplace drops the cells that do not fit', async ({ page }) => {
    await openStory(page, STORY);
    const all = await page.locator('.cap-pane').count();
    await page.locator('[data-testid="mode-unplace"]').check();
    await expect.poll(() => page.locator('.cap-pane').count()).toBeLessThan(all);
  });
});

test.describe('scrolling containers', () => {
  const SCROLLER = '.cap-scroller';

  /** Press a pane and hold the cursor `inset` px above the scroller's bottom
   *  edge, then wait for the overlay that proves the drag is live. Never hold
   *  nearer than ~10px: on Chromium the browser's own selection autoscroll takes
   *  over there and runs the box to the bottom whatever the library did.
   *  Firefox and WebKit do not, so a test written at the edge is green on one
   *  engine for a reason that has nothing to do with the library. */
  async function holdAbove(page: import('@playwright/test').Page, inset: number) {
    const box = await settledBox(page.locator(SCROLLER));
    const grip = await settledBox(page.locator('[data-node="pane-1"]'));
    await page.mouse.move(grip.x + grip.w / 2, grip.y + 12);
    await page.mouse.down();
    await page.mouse.move(grip.x + grip.w / 2, box.y + box.h - inset, { steps: 12 });
    // Without this a starved drag that never begins is indistinguishable from a
    // ramp that correctly declined to scroll.
    await expect(page.locator('[data-testid="windease-drag-overlay"]')).toBeVisible();
  }

  const scrollTop = (page: import('@playwright/test').Page) =>
    page.locator(SCROLLER).evaluate((el) => el.scrollTop);

  test('dragging to the edge scrolls the container', async ({ page }) => {
    await openStory(page, 'scrolling--drag-to-the-edge-to-scroll');
    // Inside the default 48px margin: the scroll has to continue without
    // further pointer input, which is the half a single dragMouse cannot
    // exercise.
    await holdAbove(page, 36);
    await expect.poll(() => scrollTop(page)).toBeGreaterThan(20);
    await page.mouse.up();
  });

  test('maxRate 0 refuses to scroll where the default ramp does', async ({ page }) => {
    await openStory(page, 'scrolling--drag-to-the-edge-to-scroll');
    await page.locator('[data-testid="ramp-off"]').check();

    await holdAbove(page, 36);
    await page.waitForTimeout(1000);

    expect(await scrollTop(page)).toBe(0);
    await page.mouse.up();
  });

  test('a wide margin scrolls from a cursor the default ramp ignores', async ({ page }) => {
    await openStory(page, 'scrolling--drag-to-the-edge-to-scroll');
    // 144px above the edge, three times the default margin.
    await holdAbove(page, 144);
    await page.waitForTimeout(1000);
    expect(await scrollTop(page)).toBe(0);
    await page.keyboard.press('Escape');
    await page.mouse.up();

    await page.locator('[data-testid="ramp-eager"]').check();
    await holdAbove(page, 144);
    await expect.poll(() => scrollTop(page)).toBeGreaterThan(20);
    await page.mouse.up();
  });

  test('a scrolled pane reports where it is, not where it was placed', async ({ page }) => {
    await openStory(page, 'scrolling--scroll-aware-navigation');
    const pane = page.locator('[data-node="pane-1"]');
    const before = await boxOf(pane);
    await page.locator('.cap-scroller').evaluate((el) => {
      el.scrollTop = 200;
    });
    await expect
      .poll(async () => Math.round((await boxOf(pane)).y))
      .toBeLessThan(Math.round(before.y));
  });
});
