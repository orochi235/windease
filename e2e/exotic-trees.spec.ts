import { expect, type Page, test } from '@playwright/test';
import { type Box, boxOf, centerOf, openStory, settledBox } from './fixtures.js';

/**
 * A pane saved with a pixel `placement.size` in one kind of container, dragged
 * into another kind. The size travels with it; these check the box it lands in
 * is still one a user can see and grab.
 */

const SWAY = 'exotic--trees--sway-workspace';
const GOLDEN = 'exotic--trees--golden-layout';

const node = (page: Page, id: string) => page.locator(`[data-node="${id}"]`);
const handle = (page: Page, id: string) => page.locator(`[data-windease-drag-handle="${id}"]`);
const group = (page: Page, id: string) => page.getByTestId(`xt-group-${id}`);
const lastMove = (page: Page) => page.getByTestId('xt-last-move');

async function drag(page: Page, sourceId: string, to: { x: number; y: number }) {
  const from = centerOf(await boxOf(handle(page, sourceId)));
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.move(to.x, to.y, { steps: 2 });
  await page.mouse.up();
}

function expectFinite(box: Box) {
  for (const v of [box.x, box.y, box.w, box.h]) expect(Number.isFinite(v)).toBe(true);
  expect(box.w).toBeGreaterThanOrEqual(0);
  expect(box.h).toBeGreaterThanOrEqual(0);
}

/** `inner` sits inside `outer`, give or take a border. */
function expectInside(inner: Box, outer: Box, slack = 2) {
  expect(inner.x).toBeGreaterThanOrEqual(outer.x - slack);
  expect(inner.y).toBeGreaterThanOrEqual(outer.y - slack);
  expect(inner.x + inner.w).toBeLessThanOrEqual(outer.x + outer.w + slack);
  expect(inner.y + inner.h).toBeLessThanOrEqual(outer.y + outer.h + slack);
}

test.describe('exotic trees', () => {
  test('a sized pane from a horizontal split fills a tabbed container', async ({ page }) => {
    await openStory(page, SWAY);
    const tabs = await settledBox(group(page, 'tabbed-0-2'));

    // nvim carries placement.size.w from the splith it was saved in.
    await drag(page, 'nvim', { x: tabs.x + tabs.w / 2, y: tabs.y + tabs.h * 0.6 });

    await expect(lastMove(page)).toHaveText('nvim → tabbed-0-2');
    await expect(page.getByTestId('xt-tab-nvim')).toHaveAttribute('aria-selected', 'true');
    const pane = await settledBox(node(page, 'nvim'));
    expectFinite(pane);
    expectInside(pane, tabs);
    // The whole body under the 20px tab band, less the 1px border each side.
    expect(pane.w).toBeGreaterThan(tabs.w - 4);
    expect(pane.h).toBeGreaterThan(tabs.h - 20 - 4);
  });

  test('a sized pane from a horizontal split lands inside a vertical one', async ({ page }) => {
    await openStory(page, SWAY);
    const column = await settledBox(group(page, 'splitv-0-0'));
    const htop = await settledBox(node(page, 'htop'));

    // Over htop, whose innermost container is the vertical split itself.
    await drag(page, 'nvim', { x: htop.x + htop.w / 2, y: htop.y + htop.h * 0.75 });

    await expect(lastMove(page)).toHaveText('nvim → splitv-0-0');
    const pane = await settledBox(node(page, 'nvim'));
    expectFinite(pane);
    expectInside(pane, column);
    // Its stale width is the cross axis here, so it spans the column.
    expect(pane.w).toBeGreaterThan(column.w - 4);
    // htop and the stacked group still share the column between them.
    const after = await settledBox(node(page, 'htop'));
    expectInside(after, column);
    expect(after.h).toBeGreaterThan(0);
  });

  test('a Golden Layout tab dragged into another stack takes its body', async ({ page }) => {
    await openStory(page, GOLDEN);
    const chat = await settledBox(group(page, 'stack-chat'));

    await drag(page, 'terminal', { x: chat.x + chat.w / 2, y: chat.y + chat.h / 2 });

    await expect(lastMove(page)).toHaveText('terminal → stack-chat');
    const pane = await settledBox(node(page, 'terminal'));
    expectFinite(pane);
    expectInside(pane, chat);
    expect(pane.w).toBeGreaterThan(chat.w - 4);
  });
});

test.describe('a seam drag resizing a group of nested panes', () => {
  test('moves the panes inside with the group, not eased behind it', async ({ page }) => {
    await page.goto('/?story=exotic--trees--presets&mode=preview');
    await expect(page.locator('[data-node]').first()).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('preset-picker').selectOption('emacs-side-windows');
    const seam = page.locator('[data-affordance-hit="resize-x-init-el"]');
    const from = centerOf(await boxOf(seam));

    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x - 90, from.y, { steps: 6 });

    // Mid-drag: nothing inside the resized group animates, and its panes
    // already fill it.
    const durations = await page.evaluate(() =>
      ['help', 'messages'].flatMap((id) =>
        getComputedStyle(document.querySelector(`[data-node="${id}"]`) as Element)
          .transitionDuration.split(',')
          .map((s) => Number.parseFloat(s)),
      ),
    );
    expect(durations.every((d) => d === 0)).toBe(true);
    const outer = await boxOf(node(page, 'main-right'));
    const inner = await boxOf(node(page, 'help'));
    expect(Math.abs(outer.w - inner.w)).toBeLessThanOrEqual(4);

    await page.mouse.up();
  });
});
