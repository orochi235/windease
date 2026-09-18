import { expect, type Page, test } from '@playwright/test';
import { boxOf, centerOf, dragMouse, openStory, settledBox } from './fixtures.js';

/**
 * Grid presets reproduced from real software (`src/test-utils/exotic/grid-scenarios.ts`),
 * driven through the real React layer. The drop verdict is what the user sees
 * mid-gesture, so each drop asserts the frame's accept/reject class before
 * releasing — without it a "nothing moved" assertion also passes for a gesture
 * that never reached the target.
 */

const STORY = 'exotic--grid--presets';

// The presets keep their real viewports (Pixel 412×915, Launchpad 1440×900);
// at the suite's 1200×800 their lower rows sit off-screen or under Ladle's sidebar.
test.use({ viewport: { width: 1800, height: 1300 } });

const handle = (page: Page, id: string) => page.locator(`[data-windease-drag-handle="${id}"]`);
const frame = (page: Page, id: string) => page.locator(`[data-testid="frame-${id}"]`);
const node = (page: Page, id: string) => page.locator(`[data-node="${id}"]`);
const seam = (page: Page, id: string) => page.locator(`[data-affordance-hit="${id}"]`);

async function pick(page: Page, presetId: string, anyNode: string) {
  await openStory(page, STORY);
  await page.getByTestId('preset-picker').selectOption(presetId);
  await expect(node(page, anyNode)).toBeVisible();
}

async function order(page: Page, gridId: string): Promise<string[]> {
  const text = (await page.getByTestId(`order-${gridId}`).textContent()) ?? '';
  return text === '' ? [] : text.split(',');
}

const unplaced = (page: Page, gridId: string) => page.getByTestId(`unplaced-${gridId}`);

/** Drag `sourceId` onto the center of `target` (a tile or a group frame),
 *  asserting `zoneId`'s verdict before the release. */
async function dragOnto(
  page: Page,
  sourceId: string,
  target: { node?: string; frame?: string },
  zoneId: string,
  verdict: 'accept' | 'reject',
) {
  const from = centerOf(await settledBox(handle(page, sourceId)));
  const over = target.node ? node(page, target.node) : frame(page, target.frame ?? zoneId);
  const to = centerOf(await settledBox(over));
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 14 });
  await expect(frame(page, zoneId)).toHaveClass(new RegExp(`xg-frame--${verdict}`));
  await page.mouse.up();
}

test.describe('Android home screen (Pixel Launcher 4×5)', () => {
  test('an app dropped on a page full of 20 icons is refused', async ({ page }) => {
    await pick(page, 'android-full-by-count', 'app-1');
    const before = await order(page, 'page');

    await dragOnto(page, 'new-app', { frame: 'page' }, 'page', 'reject');

    await expect.poll(() => order(page, 'page')).toEqual(before);
    await expect.poll(() => order(page, 'picker')).toContain('new-app');
  });

  test('a 4×2 widget dropped on a page full by cells is refused', async ({ page }) => {
    await pick(page, 'android-full-by-cells', 'glance');

    await dragOnto(page, 'widget-weather', { frame: 'page' }, 'page', 'reject');

    await expect.poll(() => order(page, 'picker')).toContain('widget-weather');
    await expect(unplaced(page, 'page')).toHaveText('(none)');
  });

  test('an icon dropped on a page full by cells is refused', async ({ page }) => {
    await pick(page, 'android-full-by-cells', 'glance');

    await dragOnto(page, 'new-app', { frame: 'page' }, 'page', 'reject');

    await expect(unplaced(page, 'page')).toHaveText('(none)');
  });
});

test.describe('iPhone dock (maxCols 4 × maxRows 1)', () => {
  test('shows all three docked apps', async ({ page }) => {
    test.fail(); // auto-balance picks ceil(sqrt(3)) = 2 columns and ignores maxRows: 1
    await pick(page, 'ios-dock', 'ios-app-1');
    await expect(unplaced(page, 'ios-dock')).toHaveText('(none)');
    await expect(node(page, 'ios-dock-app-3')).toBeVisible();
  });

  test('takes a fourth app dragged down from the home screen', async ({ page }) => {
    test.fail(); // canAccept caps a 4-slot dock at ceil(sqrt(4)) = 2 columns × 1 row
    await pick(page, 'ios-dock', 'ios-app-1');

    await dragOnto(page, 'ios-app-1', { frame: 'ios-dock' }, 'ios-dock', 'accept');

    await expect.poll(() => order(page, 'ios-dock')).toContain('ios-app-1');
  });
});

test.describe('macOS Launchpad (7×5 pages)', () => {
  test('a page of exactly 35 apps shows them all', async ({ page }) => {
    test.fail(); // auto-balance picks 6 columns for 26–36 apps, so a full page holds 30
    await pick(page, 'launchpad-full', 'lp-app-1');
    await expect(unplaced(page, 'lp-page')).toHaveText('(none)');
  });

  test('40 apps: the last five are reported for the next page, and a 36th is refused', async ({
    page,
  }) => {
    await pick(page, 'launchpad-overflow', 'lp-app-1');
    await expect(unplaced(page, 'lp-page')).toHaveText(
      'lp-app-36,lp-app-37,lp-app-38,lp-app-39,lp-app-40',
    );

    await dragOnto(page, 'dock-app-1', { frame: 'lp-page' }, 'lp-page', 'reject');

    await expect.poll(() => order(page, 'mac-dock')).toContain('dock-app-1');
  });

  test('reordering an app within a page moves it', async ({ page }) => {
    await pick(page, 'launchpad-thirty', 'lp-app-1');
    expect((await order(page, 'lp-page'))[0]).toBe('lp-app-1');

    await dragOnto(page, 'lp-app-1', { node: 'lp-app-10' }, 'lp-page', 'accept');

    await expect
      .poll(async () => (await order(page, 'lp-page')).indexOf('lp-app-1'))
      .toBeGreaterThan(0);
    await expect.poll(async () => (await order(page, 'lp-page')).length).toBe(30);
  });

  test('a page over capacity still reorders its own apps', async ({ page }) => {
    await pick(page, 'launchpad-overflow', 'lp-app-1');

    await dragOnto(page, 'lp-app-1', { node: 'lp-app-10' }, 'lp-page', 'accept');

    await expect
      .poll(async () => (await order(page, 'lp-page')).indexOf('lp-app-1'))
      .toBeGreaterThan(0);
    await expect.poll(async () => (await order(page, 'lp-page')).length).toBe(40);
  });

  test('a page holding 30 of 35 takes an app from the Dock', async ({ page }) => {
    test.fail(); // canAccept ignores fill: false and caps 31 apps at ceil(sqrt(31)) = 6 columns
    await pick(page, 'launchpad-thirty', 'lp-app-1');

    await dragOnto(page, 'dock-app-1', { frame: 'lp-page' }, 'lp-page', 'accept');

    await expect.poll(() => order(page, 'lp-page')).toContain('dock-app-1');
    await expect(unplaced(page, 'lp-page')).toHaveText('(none)');
  });
});

test.describe('Windows 10 Start tiles', () => {
  test('dragging a small tile’s right seam widens it by a cell', async ({ page }) => {
    await pick(page, 'win10-start-6', 'calc');
    const before = await settledBox(node(page, 'calc'));
    const edge = centerOf(await boxOf(seam(page, 'resize-x-calc')));

    await dragMouse(page, edge, { x: edge.x + before.w + 4, y: edge.y });

    const after = await settledBox(node(page, 'calc'));
    expect(after.w).toBeGreaterThan(before.w * 1.5);
  });

  test('a tile dragged into another group lands there', async ({ page }) => {
    await pick(page, 'win10-start-6', 'groove');

    await dragOnto(page, 'groove', { frame: 'productivity' }, 'productivity', 'accept');

    await expect.poll(() => order(page, 'productivity')).toContain('groove');
    await expect.poll(() => order(page, 'explore')).not.toContain('groove');
  });
});

test.describe('Windows 8.1 Start screen (fixed rows)', () => {
  test('places every tile, growing sideways', async ({ page }) => {
    test.fail(); // cols = ceil(n / rows) ignores spans, so six tiles land in `unplaced`
    await pick(page, 'win8-start-screen', 'desktop');
    await expect(unplaced(page, 'start8')).toHaveText('(none)');
  });
});

test.describe('Grafana dashboard (24 columns)', () => {
  test('dragging a stat panel’s bottom seam makes it taller', async ({ page }) => {
    await pick(page, 'grafana-node-exporter', 'cpu-cores');
    const before = await settledBox(node(page, 'cpu-cores'));
    const edge = centerOf(await boxOf(seam(page, 'resize-y-cpu-cores')));

    await dragMouse(page, edge, { x: edge.x, y: edge.y + before.h });

    const after = await settledBox(node(page, 'cpu-cores'));
    expect(after.h).toBeGreaterThan(before.h * 1.3);
  });

  test('a w:30 panel is clamped to the dashboard width, and the right-edge panel sits flush', async ({
    page,
  }) => {
    await pick(page, 'grafana-node-exporter', 'imported-w30');
    const header = await settledBox(node(page, 'row-quick'));
    const wide = await settledBox(node(page, 'imported-w30'));
    const edge = await settledBox(node(page, 'edge-panel'));
    expect(wide.w).toBeCloseTo(header.w, 0);
    expect(edge.x + edge.w).toBeCloseTo(header.x + header.w, 0);
  });
});

test.describe('periodic table and keyboard', () => {
  test('the f-block lines up under group 3 of the main table', async ({ page }) => {
    await pick(page, 'periodic-table', 'el-La');
    const ref = await settledBox(node(page, 'lanthanides-ref'));
    const la = await settledBox(node(page, 'el-La'));
    const he = await settledBox(node(page, 'el-He'));
    const ne = await settledBox(node(page, 'el-Ne'));
    expect(la.x).toBeCloseTo(ref.x, 0);
    expect(he.x).toBeCloseTo(ne.x, 0);
  });

  test('Backspace is two keys and a gap wide', async ({ page }) => {
    await pick(page, 'keyboard-ansi-60', 'key-backspace');
    const one = await settledBox(node(page, 'key-1'));
    const bksp = await settledBox(node(page, 'key-backspace'));
    expect(bksp.w).toBeCloseTo(2 * one.w + 2, 0);
  });
});

test.describe('Excel frozen panes', () => {
  test('the pinned header row survives the capacity trim', async ({ page }) => {
    await pick(page, 'excel-frozen-panes', 'cell-corner');
    for (const id of ['cell-corner', 'cell-A', 'cell-E', 'cell-row5']) {
      await expect(node(page, id)).toBeVisible();
    }
    await expect(unplaced(page, 'sheet')).toContainText('cell-E8');
  });
});
