import { expect, type Page, test } from '@playwright/test';
import { PRESETS } from '../src/test-utils/exotic/grid-scenarios.js';
import { presetTree } from '../src/test-utils/exotic/preset.js';
import { type Box, boxOf, centerOf, dragMouse, openStory, settledBox } from './fixtures.js';

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

test.describe('iPhone dock (fixed icon cells, spaced evenly)', () => {
  /** The docked icons left to right, and the space between each pair. */
  async function dock(page: Page, ids: string[]) {
    const boxes = await Promise.all(ids.map((id) => settledBox(node(page, id))));
    boxes.sort((a, b) => a.x - b.x);
    const between = boxes.slice(1).map((b, i) => b.x - (boxes[i]!.x + boxes[i]!.w));
    const frameBox = await settledBox(frame(page, 'ios-dock'));
    const left = boxes[0]!.x - frameBox.x;
    const right = frameBox.x + frameBox.w - (boxes.at(-1)!.x + boxes.at(-1)!.w);
    return { boxes, between, left, right };
  }

  test('shows all three docked apps', async ({ page }) => {
    await pick(page, 'ios-dock', 'ios-app-1');
    await expect(unplaced(page, 'ios-dock')).toHaveText('(none)');
    await expect(node(page, 'ios-dock-app-3')).toBeVisible();
  });

  test('spaces three apps evenly at a fixed 60pt size', async ({ page }) => {
    await pick(page, 'ios-dock', 'ios-app-1');
    const { boxes, between, left, right } = await dock(page, [
      'ios-dock-app-1',
      'ios-dock-app-2',
      'ios-dock-app-3',
    ]);
    for (const b of boxes) expect({ w: b.w, h: b.h }).toEqual({ w: 60, h: 60 });
    expect(between[0]).toBeGreaterThan(40);
    expect(between[1]).toBeCloseTo(between[0]!, 0);
    expect(left).toBeCloseTo(right, 0);
  });

  test('takes a fourth app dragged down from the home screen, at the same size', async ({
    page,
  }) => {
    await pick(page, 'ios-dock', 'ios-app-1');

    await dragOnto(page, 'ios-app-1', { frame: 'ios-dock' }, 'ios-dock', 'accept');

    await expect.poll(() => order(page, 'ios-dock')).toContain('ios-app-1');
    const { boxes, between, left, right } = await dock(page, [
      'ios-dock-app-1',
      'ios-dock-app-2',
      'ios-dock-app-3',
      'ios-app-1',
    ]);
    for (const b of boxes) expect(b.w).toBe(60);
    for (const gap of between) expect(gap).toBeCloseTo(between[0]!, 0);
    expect(left).toBeCloseTo(right, 0);
  });
});

test.describe('macOS Launchpad (7×5 pages)', () => {
  test('a page of exactly 35 apps shows them all', async ({ page }) => {
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
    await pick(page, 'win8-start-screen', 'desktop');
    await expect(unplaced(page, 'start8')).toHaveText('(none)');
  });
});

test.describe('Grafana dashboard (24 columns)', () => {
  test('growing a panel a row pushes every panel under it down a row', async ({ page }) => {
    await pick(page, 'grafana-node-exporter', 'imported-w30');
    const cpu = await settledBox(node(page, 'cpu-basic'));
    const net = await settledBox(node(page, 'net-basic'));
    const wide = await settledBox(node(page, 'imported-w30'));
    const mem = await settledBox(node(page, 'mem-basic'));
    const edge = centerOf(await boxOf(seam(page, 'resize-y-cpu-basic')));

    // One 30px row and its 8px gap.
    await dragMouse(page, edge, { x: edge.x, y: edge.y + 38 });

    expect((await settledBox(node(page, 'cpu-basic'))).h).toBeCloseTo(cpu.h + 38, 0);
    expect((await settledBox(node(page, 'net-basic'))).y).toBeCloseTo(net.y + 38, 0);
    expect((await settledBox(node(page, 'imported-w30'))).y).toBeCloseTo(wide.y + 38, 0);
    expect(await settledBox(node(page, 'mem-basic'))).toEqual(mem);
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

  test('renders only elements, with no spacer nodes, each at its group and period', async ({
    page,
  }) => {
    await pick(page, 'periodic-table', 'el-H');
    const table = presetTree(PRESETS.find((p) => p.id === 'periodic-table')!).children!.find(
      (c) => c.id === 'main-table',
    )!;
    const want = new Map(
      table.children!.map((c) => [c.id, c.placement?.cell as { col: number; row: number }]),
    );
    const rendered = await frame(page, 'main-table')
      .locator('[data-node]')
      .evaluateAll((els) => els.map((el) => el.getAttribute('data-node')));
    expect(rendered.sort()).toEqual([...want.keys()].sort());

    const h = await settledBox(node(page, 'el-H'));
    const he = await settledBox(node(page, 'el-He'));
    const fr = await settledBox(node(page, 'el-Fr'));
    const cellOf = (b: Box) => ({
      col: Math.round(((b.x - h.x) / (he.x - h.x)) * 17),
      row: Math.round(((b.y - h.y) / (fr.y - h.y)) * 6),
    });
    for (const [id, cell] of want) {
      expect({ id, ...cellOf(await settledBox(node(page, id))) }).toEqual({ id, ...cell });
    }
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

  test('the row-number column is narrow, and dragging column A’s seam widens it alone', async ({
    page,
  }) => {
    await pick(page, 'excel-frozen-panes', 'cell-corner');
    expect((await settledBox(node(page, 'cell-corner'))).w).toBeCloseTo(32, 0);
    const a = await settledBox(node(page, 'cell-A'));
    const b = await settledBox(node(page, 'cell-B'));
    expect(a.w).toBeCloseTo(64, 0);
    expect(a.h).toBeCloseTo(20, 0);
    // In the header row, clear of the row seams that cross the column seam lower down.
    const seamBox = await boxOf(seam(page, 'track-x-1'));
    const edge = { x: seamBox.x + seamBox.w / 2, y: a.y + a.h * 0.4 };

    await dragMouse(page, edge, { x: edge.x + 16, y: edge.y });

    expect((await settledBox(node(page, 'cell-A'))).w).toBeCloseTo(a.w + 16, 0);
    const after = await settledBox(node(page, 'cell-B'));
    expect(after.x).toBeCloseTo(b.x + 16, 0);
    expect(after.w).toBeCloseTo(b.w, 0);
  });
});
