import { expect, type Page, test } from '@playwright/test';
import { type Box, boxOf, centerOf, dragMouse, openStory, settledBox } from './fixtures.js';

const STORY = 'exotic--desktop--presets';

const node = (page: Page, id: string) => page.locator(`[data-node="${id}"]`);
const root = (page: Page, id: string) => page.locator(`[data-node-container="${id}"]`);
const handle = (page: Page, id: string) =>
  page.locator(`[data-affordance-hit="floating:drag:${id}"]`);
/** The desktop's own minimize box over a window's title bar, or over its icon. */
const toggle = (page: Page, id: string) =>
  page.locator(`[data-affordance-hit="desktop:minimize:${id}"]`);

async function pick(page: Page, presetId: string, rootId: string) {
  await openStory(page, STORY);
  await page.getByTestId('xd-preset').selectOption(presetId);
  await expect(root(page, rootId)).toBeVisible();
  await expect(root(page, rootId).locator('[data-node]').first()).toBeVisible();
}

/** The node a real pointer would land on at this point, counting a window's title band as the window. */
function hitAt(page: Page, p: { x: number; y: number }) {
  return page.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y);
    const band = el?.closest('[data-affordance-hit]')?.getAttribute('data-affordance-hit');
    if (band) return band.replace(/^\w+:\w+:/, '');
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
    await toggle(page, 'mac-finder').click();
    expect(await settledBox(node(page, 'mac-finder'))).toMatchObject({
      x: before.x,
      y: before.y,
      w: before.w,
      h: 20,
    });
    await toggle(page, 'mac-finder').click();
    expect(await settledBox(node(page, 'mac-finder'))).toEqual(before);
  });

  test('dragging the title bar moves the window', async ({ page }) => {
    await pick(page, 'macos9-windowshade', 'mac-desktop');
    const before = await boxOf(node(page, 'mac-finder'));
    const bar = await boxOf(page.getByTestId('bar-mac-finder'));
    const from = { x: bar.x + 40, y: bar.y + bar.h / 2 };
    await dragMouse(page, from, { x: from.x + 60, y: from.y + 30 });
    const after = await settledBox(node(page, 'mac-finder'));
    expect(after.x - before.x).toBeCloseTo(60, 0);
    expect(after.y - before.y).toBeCloseTo(30, 0);
  });

  test('clicking a window under another brings it to the front', async ({ page }) => {
    await pick(page, 'macos9-windowshade', 'mac-desktop');
    const finder = await boxOf(node(page, 'mac-finder'));
    const p = overlapCenter(finder, await boxOf(node(page, 'mac-notepad')));
    expect(await hitAt(page, p)).toBe('mac-notepad');
    // Its body's left edge, clear of Note Pad.
    await page.mouse.click(finder.x + 20, finder.y + 60);
    await expect(page.getByTestId('xd-top')).toHaveText('mac-finder');
    await expect.poll(() => hitAt(page, p)).toBe('mac-finder');
  });
});

test.describe('Windows 3.1 minimized icons', () => {
  test('restoring an icon brings the window back at its saved size, on top', async ({ page }) => {
    await pick(page, 'win31-minimized-icons', 'win31-desktop');
    expect(await boxOf(node(page, 'win31-app-3'))).toMatchObject({ w: 72, h: 56 });
    await toggle(page, 'win31-app-3').click();
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

    // Its body, clear of every window above it: a press on the title bar does not raise.
    await page.mouse.click(photo.x + 10, photo.y + 60);
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

  test('a screen slides only vertically, and stops with its title bar at the bottom', async ({
    page,
  }) => {
    await pick(page, 'amiga-workbench-screens', 'amiga-display');
    const display = await boxOf(root(page, 'amiga-display'));
    const term = await boxOf(node(page, 'amiga-term'));
    const bar = await boxOf(page.getByTestId('bar-amiga-term'));
    const from = { x: bar.x + 40, y: bar.y + bar.h / 2 };
    await dragMouse(page, from, { x: from.x + 120, y: from.y + 400 });

    const after = await settledBox(node(page, 'amiga-term'));
    expect(after.x).toBeCloseTo(term.x, 0);
    expect(after.y).toBeCloseTo(display.y + display.h - 20, 0);
  });

  test('what hangs below the display is clipped, with nothing to scroll to', async ({ page }) => {
    await pick(page, 'amiga-workbench-screens', 'amiga-display');
    const frame = page.getByTestId('xd-frame');
    const extent = await frame.evaluate((el) => ({
      w: el.scrollWidth - el.clientWidth,
      h: el.scrollHeight - el.clientHeight,
    }));
    expect(extent).toEqual({ w: 0, h: 0 });
    const display = await boxOf(root(page, 'amiga-display'));
    const term = await boxOf(node(page, 'amiga-term'));
    expect(term.y + term.h).toBeGreaterThan(display.y + display.h);
    expect(await hitAt(page, { x: term.x + 40, y: display.y + display.h + 10 })).toBeNull();
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
  test('windows saved on the lost displays are pulled back onto the laptop screen', async ({
    page,
  }) => {
    await pick(page, 'unplugged-second-monitor', 'laptop-display');
    const screen = await boxOf(root(page, 'laptop-display'));
    const xcode = await boxOf(node(page, 'mon-xcode'));
    expect(xcode.x).toBeCloseTo(screen.x, 0);
    expect(xcode.y).toBeCloseTo(screen.y, 0);
    // The root's box grows to reach Xcode, which is bigger than the screen; the screen is 1280 wide.
    const slack = await boxOf(node(page, 'mon-slack'));
    expect(slack.x + slack.w).toBeCloseTo(screen.x + 1280, 0);
  });

  test('a window dragged past the edge stops there', async ({ page }) => {
    await pick(page, 'unplugged-second-monitor', 'laptop-display');
    const screen = await boxOf(root(page, 'laptop-display'));
    // Terminal is the front window, pulled back to the bottom-right corner.
    const bar = await boxOf(page.getByTestId('bar-mon-terminal'));
    const from = { x: bar.x + 40, y: bar.y + bar.h / 2 };
    await dragMouse(page, from, { x: from.x - 620, y: from.y - 400 });
    const terminal = await settledBox(node(page, 'mon-terminal'));
    expect(terminal.x).toBeCloseTo(screen.x, 0);
    expect(terminal.y).toBeCloseTo(screen.y, 0);
  });
});

test.describe('Figma canvas', () => {
  test('opens at the origin, and scrolls to the frames above and left of it', async ({ page }) => {
    await pick(page, 'figma-canvas', 'figma-canvas');
    const frame = page.getByTestId('xd-frame');
    const view = await boxOf(frame);
    const mobile = await boxOf(node(page, 'figma-mobile'));
    expect(mobile.x).toBeCloseTo(view.x + 1 + 120, 0);
    expect((await boxOf(node(page, 'figma-cover'))).x).toBeLessThan(view.x);

    await frame.evaluate((el) => {
      el.scrollLeft = 0;
      el.scrollTop = 0;
    });
    const cover = await settledBox(node(page, 'figma-cover'));
    expect(cover.x).toBeCloseTo(view.x + 1, 0);
    expect(cover.y).toBeCloseTo(view.y + 1, 0);
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
