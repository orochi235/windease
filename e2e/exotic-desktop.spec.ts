import { expect, type Page, test } from '@playwright/test';
import { type Box, boxOf, centerOf, dragMouse, openStory, settledBox } from './fixtures.js';

const STORY = 'exotic--desktop--presets';

const node = (page: Page, id: string) => page.locator(`[data-node="${id}"]`);
const root = (page: Page, id: string) => page.locator(`[data-node-container="${id}"]`);
const handle = (page: Page, id: string) =>
  page.locator(`[data-affordance-hit="floating:drag:${id}"]`);

async function pick(page: Page, presetId: string, rootId: string) {
  await openStory(page, STORY);
  await page.getByTestId('xd-preset').selectOption(presetId);
  await expect(root(page, rootId)).toBeVisible();
  await expect(root(page, rootId).locator('[data-node]').first()).toBeVisible();
}

/** The node a real pointer would land on at this point. */
function hitAt(page: Page, p: { x: number; y: number }) {
  return page.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y);
    return el?.closest('[data-node]')?.getAttribute('data-node') ?? null;
  }, p);
}

function overlapCenter(a: Box, b: Box): { x: number; y: number } {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.w, b.x + b.w);
  const bottom = Math.min(a.y + a.h, b.y + b.h);
  expect(right).toBeGreaterThan(left);
  expect(bottom).toBeGreaterThan(top);
  return { x: (left + right) / 2, y: (top + bottom) / 2 };
}

test.describe('Mac OS 9 WindowShade', () => {
  test('shading rolls the Finder window up to its 20px bar in place', async ({ page }) => {
    await pick(page, 'macos9-windowshade', 'mac-desktop');
    const before = await boxOf(node(page, 'mac-finder'));
    await page.getByTestId('minimize-mac-finder').click();
    expect(await settledBox(node(page, 'mac-finder'))).toMatchObject({
      x: before.x,
      y: before.y,
      w: before.w,
      h: 20,
    });
  });
});

test.describe('Windows 3.1 minimized icons', () => {
  test('restoring an icon brings the window back at its saved size, on top', async ({ page }) => {
    await pick(page, 'win31-minimized-icons', 'win31-desktop');
    expect(await boxOf(node(page, 'win31-app-3'))).toMatchObject({ w: 72, h: 56 });
    await page.getByTestId('restore-win31-app-3').click();
    const restored = await settledBox(node(page, 'win31-app-3'));
    expect(restored).toMatchObject({ w: 300, h: 200 });
    const progman = await boxOf(node(page, 'win31-progman'));
    expect(await hitAt(page, overlapCenter(restored, progman))).toBe('win31-app-3');
  });
});

test.describe('GIMP multi-window', () => {
  test('clicking an image window raises it over the Layers dock', async ({ page }) => {
    await pick(page, 'gimp-2.8-multi-window', 'gimp-desktop');
    const photo = await boxOf(node(page, 'gimp-img-2'));
    const p = overlapCenter(photo, await boxOf(node(page, 'gimp-layers')));
    expect(await hitAt(page, p)).toBe('gimp-layers');

    await page.getByTestId('bar-gimp-img-2').click({ position: { x: 8, y: 8 } });
    await expect(page.getByTestId('xd-top')).toHaveText('gimp-img-2');
    await expect.poll(() => hitAt(page, p)).toBe('gimp-img-2');
  });
});

test.describe('Amiga screens', () => {
  test('dragging the front screen down reveals the one behind it', async ({ page }) => {
    await pick(page, 'amiga-workbench-screens', 'amiga-display');
    const term = await boxOf(node(page, 'amiga-term'));
    const probe = { x: term.x + term.w / 2, y: term.y + 20 };
    expect(await hitAt(page, probe)).toBe('amiga-term');

    const bar = await boxOf(page.getByTestId('bar-amiga-term'));
    await dragMouse(
      page,
      { x: bar.x + 40, y: bar.y + bar.h / 2 },
      { x: bar.x + 40, y: bar.y + bar.h / 2 + 50 },
    );

    expect((await settledBox(node(page, 'amiga-term'))).y).toBeCloseTo(term.y + 50, 0);
    expect(await hitAt(page, probe)).toBe('amiga-dpaint');
  });
});

test.describe('cascade after 200 windows', () => {
  test('renders all 200, each cascaded window over the one before', async ({ page }) => {
    await pick(page, 'cascade-200-windows', 'cascade-desktop');
    await expect(root(page, 'cascade-desktop').locator('[data-node^="cascade-"]')).toHaveCount(200);
    // Each window's top-left corner is clear of every later one, which starts 24px further in.
    for (const id of ['cascade-4', 'cascade-5']) {
      const box = await boxOf(node(page, id));
      expect(await hitAt(page, { x: box.x + 10, y: box.y + 10 })).toBe(id);
    }
  });
});

test.describe('unplugged second monitor', () => {
  test('a window saved on the left-hand display renders wholly outside the laptop screen', async ({
    page,
  }) => {
    await pick(page, 'unplugged-second-monitor', 'laptop-display');
    const screen = await boxOf(root(page, 'laptop-display'));
    const xcode = await boxOf(node(page, 'mon-xcode'));
    expect(xcode.x + xcode.w).toBeLessThan(screen.x);
  });
});

test.describe('Chrome with 150 tabs', () => {
  test('closing the active last tab falls back to the first tab', async ({ page }) => {
    await pick(page, 'chrome-150-tabs', 'chrome-window');
    await expect(page.getByTestId('tab-chrome-tab-150')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('page-chrome-tab-150')).toBeVisible();

    await page.getByTestId('close-chrome-tab-150').click();

    await expect(page.getByTestId('tab-chrome-tab-150')).toHaveCount(0);
    await expect(page.getByTestId('tab-chrome-tab-1')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('page-chrome-tab-1')).toBeVisible();
    await expect(page.locator('[data-testid^="page-"]')).toHaveCount(1);
  });
});

test.describe('Photoshop panel groups', () => {
  test('tearing the Layers tab out floats it and the group falls back to Channels', async ({
    page,
  }) => {
    await pick(page, 'photoshop-panel-dock', 'ps-workspace');
    await page.getByTestId('float-ps-layers').click();

    await expect(page.getByTestId('xd-floating')).toHaveText(/ps-layers/);
    await expect(page.getByTestId('tab-ps-layers')).toHaveCount(0);
    await expect(page.getByTestId('tab-ps-channels')).toHaveAttribute('aria-selected', 'true');
    expect(await settledBox(node(page, 'ps-layers'))).toMatchObject({ w: 240, h: 260 });
  });

  test('a torn-out palette snaps to the bottom-left corner and docks back', async ({ page }) => {
    await pick(page, 'photoshop-panel-dock', 'ps-workspace');
    await page.getByTestId('float-ps-layers').click();
    const workspace = await boxOf(root(page, 'ps-workspace'));
    const from = centerOf(await boxOf(handle(page, 'ps-layers')));

    // Aim just inside the corner: the clamp stops the palette at the edges and the threshold captures it.
    await dragMouse(page, from, { x: workspace.x + 2, y: workspace.y + workspace.h - 2 });

    const palette = await settledBox(node(page, 'ps-layers'));
    expect(Math.round(palette.x - workspace.x)).toBe(12);
    expect(Math.round(workspace.y + workspace.h - (palette.y + palette.h))).toBe(12);

    await page.getByTestId('dock-ps-layers').click();
    await expect(page.getByTestId('xd-floating')).not.toHaveText(/ps-layers/);
    await expect(page.getByTestId('tab-ps-layers')).toHaveAttribute('aria-selected', 'true');
  });
});

test.describe('FancyZones', () => {
  test('a window dropped near a zone corner snaps inside that zone', async ({ page }) => {
    await pick(page, 'fancyzones-priority-grid', 'fz-desktop');
    const zone = await boxOf(node(page, 'fz-zone-center'));
    const win = await boxOf(node(page, 'fz-edge'));
    const from = centerOf(await boxOf(handle(page, 'fz-edge')));

    // Aim the window's origin 10px past the zone's inset top-left; the 24px threshold captures it.
    await dragMouse(page, from, {
      x: from.x + (zone.x + 12 - win.x) + 10,
      y: from.y + (zone.y + 12 - win.y) + 10,
    });

    const after = await settledBox(node(page, 'fz-edge'));
    expect(Math.round(after.x - zone.x)).toBe(12);
    expect(Math.round(after.y - zone.y)).toBe(12);
  });
});
