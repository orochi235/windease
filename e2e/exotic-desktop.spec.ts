import { expect, type Page, test } from '@playwright/test';
import { type Box, boxOf, centerOf, dragMouse, openStory, settledBox } from './fixtures.js';

const STORY = 'exotic--desktop--presets';

const node = (page: Page, id: string) => page.locator(`[data-node="${id}"]`);
const root = (page: Page, id: string) => page.locator(`[data-node-container="${id}"]`);
const hit = (page: Page, id: string) => page.locator(`[data-affordance-hit="${id}"]`);
const handle = (page: Page, id: string) => hit(page, `floating:drag:${id}`);
/** The desktop's own minimize box over a window's title bar, or over its icon. */
const toggle = (page: Page, id: string) => hit(page, `desktop:minimize:${id}`);

/** Opens `presetId` and returns the scale its desktop is drawn at: screen px per layout px. */
async function pick(page: Page, presetId: string, rootId: string): Promise<number> {
  await openStory(page, STORY);
  await page.getByTestId('xd-preset').selectOption(presetId);
  await expect(root(page, rootId)).toBeVisible();
  await expect(root(page, rootId).locator('[data-node]').first()).toBeVisible();
  return root(page, rootId).evaluate(
    (el) => el.getBoundingClientRect().width / (el as HTMLElement).offsetWidth,
  );
}

/** The node a real pointer would land on at this point, counting a window's title band as the window. */
function hitAt(page: Page, p: { x: number; y: number }) {
  return page.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y);
    const band = el?.closest('[data-affordance-hit]')?.getAttribute('data-affordance-hit');
    if (band) return band.replace(/^\w+:\w+:(\w+:)?/, '');
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

function expectBox(actual: Box, want: Partial<Box>) {
  for (const [k, v] of Object.entries(want)) expect(actual[k as keyof Box], k).toBeCloseTo(v, 0);
}

test.describe('a desktop fitted to the story frame', () => {
  test('scales the 1024px twm screen to the frame width', async ({ page }) => {
    const scale = await pick(page, 'twm-icon-manager', 'twm-root');
    const frame = await boxOf(page.getByTestId('xd-frame'));
    const screen = await boxOf(root(page, 'twm-root'));
    expect(scale).not.toBeCloseTo(1, 2);
    // The frame's 1px border sits outside the fitted area.
    expect(screen.w).toBeCloseTo(frame.w - 2, 0);
    expect(screen.h).toBeCloseTo(768 * scale, 0);
  });

  test('a window dragged 100 screen px moves 100 screen px', async ({ page }) => {
    await pick(page, 'twm-icon-manager', 'twm-root');
    const before = await boxOf(node(page, 'twm-xterm-10'));
    const bar = await boxOf(page.getByTestId('bar-twm-xterm-10'));
    const from = { x: bar.x + 60, y: bar.y + bar.h / 2 };
    await dragMouse(page, from, { x: from.x + 100, y: from.y + 60 });
    const after = await settledBox(node(page, 'twm-xterm-10'));
    expect(after.x - before.x).toBeCloseTo(100, 0);
    expect(after.y - before.y).toBeCloseTo(60, 0);
  });
});

test.describe('Mac OS 9 WindowShade', () => {
  test('shading rolls the Finder window up to its 20px bar in place', async ({ page }) => {
    const scale = await pick(page, 'macos9-windowshade', 'mac-desktop');
    const before = await boxOf(node(page, 'mac-finder'));
    await toggle(page, 'mac-finder').click();
    expectBox(await settledBox(node(page, 'mac-finder')), {
      x: before.x,
      y: before.y,
      w: before.w,
      h: 20 * scale,
    });
    await toggle(page, 'mac-finder').click();
    expectBox(await settledBox(node(page, 'mac-finder')), before);
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

  test('dragging the bottom-right corner resizes the window, its top-left staying put', async ({
    page,
  }) => {
    await pick(page, 'macos9-windowshade', 'mac-desktop');
    const before = await boxOf(node(page, 'mac-finder'));
    const corner = centerOf(await boxOf(hit(page, 'desktop:resize:se:mac-finder')));
    await dragMouse(page, corner, { x: corner.x + 50, y: corner.y + 40 });
    const after = await settledBox(node(page, 'mac-finder'));
    expectBox(after, { x: before.x, y: before.y, w: before.w + 50, h: before.h + 40 });
  });

  test('the disk and Trash icons line up down the right edge', async ({ page }) => {
    await pick(page, 'macos9-windowshade', 'mac-desktop');
    const desk = await boxOf(root(page, 'mac-desktop'));
    const hd = await boxOf(node(page, 'mac-hd'));
    const trash = await boxOf(node(page, 'mac-trash'));
    expect(hd.x).toBeCloseTo(trash.x, 0);
    expect(trash.y).toBeGreaterThan(hd.y + hd.h);
    expect(desk.x + desk.w - (hd.x + hd.w)).toBeLessThan(hd.w);
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
  test('icons line up along the bottom of the screen', async ({ page }) => {
    await pick(page, 'win31-minimized-icons', 'win31-desktop');
    const screen = await boxOf(root(page, 'win31-desktop'));
    const first = await boxOf(node(page, 'win31-recycle'));
    expect(first.x).toBeCloseTo(screen.x, 0);
    expect(first.y + first.h).toBeCloseTo(screen.y + screen.h, 0);
  });

  test('restoring an icon brings the window back at its saved size, on top', async ({ page }) => {
    const scale = await pick(page, 'win31-minimized-icons', 'win31-desktop');
    const icon = await boxOf(node(page, 'win31-app-7'));
    expectBox(icon, { w: 72 * scale, h: 56 * scale });
    // Its right end, past File Manager, which covers the rest of the row.
    await page.mouse.click(icon.x + icon.w - 4, icon.y + icon.h / 2);
    const restored = await settledBox(node(page, 'win31-app-7'));
    expectBox(restored, { w: 300 * scale, h: 200 * scale });
    const progman = await boxOf(node(page, 'win31-progman'));
    expect(await hitAt(page, overlapCenter(restored, progman))).toBe('win31-app-7');
  });
});

test.describe('GIMP multi-window', () => {
  test('clicking an image window raises it over the other images but not over the Layers dock', async ({
    page,
  }) => {
    await pick(page, 'gimp-2.8-multi-window', 'gimp-desktop');
    const photo = await boxOf(node(page, 'gimp-img-2'));
    const underDock = overlapCenter(photo, await boxOf(node(page, 'gimp-layers')));
    const underImage = overlapCenter(photo, await boxOf(node(page, 'gimp-img-3')));
    expect(await hitAt(page, underDock)).toBe('gimp-layers');
    expect(await hitAt(page, underImage)).toBe('gimp-img-3');

    // Its body, clear of every window above it: a press on the title bar does not raise.
    await page.mouse.click(photo.x + 10, photo.y + 60);
    await expect(page.getByTestId('xd-top')).toHaveText('gimp-img-2');
    await expect.poll(() => hitAt(page, underImage)).toBe('gimp-img-2');
    expect(await hitAt(page, underDock)).toBe('gimp-layers');
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
    const scale = await pick(page, 'amiga-workbench-screens', 'amiga-display');
    const display = await boxOf(root(page, 'amiga-display'));
    const term = await boxOf(node(page, 'amiga-term'));
    const bar = await boxOf(page.getByTestId('bar-amiga-term'));
    const from = { x: bar.x + 40, y: bar.y + bar.h / 2 };
    await dragMouse(page, from, { x: from.x + 120, y: from.y + 400 });

    const after = await settledBox(node(page, 'amiga-term'));
    expect(after.x).toBeCloseTo(term.x, 0);
    expect(after.y).toBeCloseTo(display.y + display.h - 20 * scale, 0);
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
  test('renders all 200 on the screen, the cascade starting again at the top left', async ({
    page,
  }) => {
    await pick(page, 'cascade-200-windows', 'cascade-desktop');
    await expect(root(page, 'cascade-desktop').locator('[data-node^="cascade-"]')).toHaveCount(200);
    const screen = await boxOf(root(page, 'cascade-desktop'));
    const first = await boxOf(node(page, 'cascade-1'));
    expectBox(await boxOf(node(page, 'cascade-19')), { x: first.x, y: first.y });
    const last = await boxOf(node(page, 'cascade-200'));
    expect(last.x + last.w).toBeLessThanOrEqual(screen.x + screen.w + 1);
    expect(last.y + last.h).toBeLessThanOrEqual(screen.y + screen.h + 1);
    expect(await hitAt(page, { x: last.x + 10, y: last.y + 10 })).toBe('cascade-200');
  });
});

test.describe('unplugged second monitor', () => {
  test('windows saved on the lost displays are pulled back onto the laptop screen', async ({
    page,
  }) => {
    const scale = await pick(page, 'unplugged-second-monitor', 'laptop-display');
    const screen = await boxOf(root(page, 'laptop-display'));
    const xcode = await boxOf(node(page, 'mon-xcode'));
    expect(xcode.x).toBeCloseTo(screen.x, 0);
    expect(xcode.y).toBeCloseTo(screen.y, 0);
    const slack = await boxOf(node(page, 'mon-slack'));
    expect(slack.x + slack.w).toBeCloseTo(screen.x + 1280 * scale, 0);
  });

  test('a window dragged past the edge stops there', async ({ page }) => {
    await pick(page, 'unplugged-second-monitor', 'laptop-display');
    const screen = await boxOf(root(page, 'laptop-display'));
    // Terminal is the front window, pulled back to the bottom-right corner.
    const bar = await boxOf(page.getByTestId('bar-mon-terminal'));
    const from = { x: bar.x + 40, y: bar.y + bar.h / 2 };
    await dragMouse(page, from, { x: from.x - 1200, y: from.y - 800 });
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
  /** Drag `id`'s tab out of its group and let go over the canvas, at `frac` of its box. */
  async function tearOut(page: Page, id: string, frac = { x: 0.2, y: 0.1 }) {
    const canvas = await boxOf(node(page, 'ps-canvas'));
    const to = { x: canvas.x + canvas.w * frac.x, y: canvas.y + canvas.h * frac.y };
    await dragMouse(page, centerOf(await boxOf(page.getByTestId(`tab-${id}`))), to, 16);
    return to;
  }

  test('a tab dragged onto the canvas floats there at the group tearSize', async ({ page }) => {
    const scale = await pick(page, 'photoshop-panel-dock', 'ps-workspace');
    const to = await tearOut(page, 'ps-layers');

    await expect(page.getByTestId('xd-floating')).toHaveText(/ps-layers/);
    await expect(page.getByTestId('tab-ps-layers')).toHaveCount(0);
    await expect(page.getByTestId('tab-ps-channels')).toHaveAttribute('aria-selected', 'true');
    expectBox(await settledBox(node(page, 'ps-layers')), {
      x: to.x,
      y: to.y,
      w: 240 * scale,
      h: 260 * scale,
    });
  });

  test('a floating panel dragged by its tab onto a group docks there', async ({ page }) => {
    await pick(page, 'photoshop-panel-dock', 'ps-workspace');
    await tearOut(page, 'ps-layers');
    await expect(page.getByTestId('xd-floating')).toHaveText(/ps-layers/);

    const props = page.getByTestId('stack-ps-group-props');
    const strip = await boxOf(page.getByTestId('tab-ps-properties'));
    await dragMouse(
      page,
      centerOf(await boxOf(page.getByTestId('chip-ps-layers'))),
      { x: strip.x + strip.w / 2, y: strip.y + strip.h / 2 },
      16,
    );

    await expect(page.getByTestId('xd-floating')).not.toHaveText(/ps-layers/);
    await expect(props.getByTestId('tab-ps-layers')).toHaveCount(1);
  });

  test('a torn-out panel snaps to the bottom-left corner of the workspace', async ({ page }) => {
    const scale = await pick(page, 'photoshop-panel-dock', 'ps-workspace');
    await tearOut(page, 'ps-layers');
    const workspace = await boxOf(root(page, 'ps-workspace'));
    const from = centerOf(await boxOf(handle(page, 'ps-layers')));

    // Aim just inside the corner: the clamp stops the palette at the edges and the threshold captures it.
    await dragMouse(page, from, { x: workspace.x + 2, y: workspace.y + workspace.h - 2 });

    const palette = await settledBox(node(page, 'ps-layers'));
    expect(palette.x - workspace.x).toBeCloseTo(12 * scale, 0);
    expect(workspace.y + workspace.h - (palette.y + palette.h)).toBeCloseTo(12 * scale, 0);
  });
});

test.describe('FancyZones', () => {
  test('a window dropped near a zone corner snaps inside that zone', async ({ page }) => {
    const scale = await pick(page, 'fancyzones-priority-grid', 'fz-desktop');
    const zone = await boxOf(node(page, 'fz-zone-center'));
    const win = await boxOf(node(page, 'fz-edge'));
    const from = centerOf(await boxOf(handle(page, 'fz-edge')));
    const inset = 12 * scale;

    // Aim the window's origin 10px past the zone's inset top-left; the 24px threshold captures it.
    await dragMouse(page, from, {
      x: from.x + (zone.x + inset - win.x) + 10,
      y: from.y + (zone.y + inset - win.y) + 10,
    });

    const after = await settledBox(node(page, 'fz-edge'));
    expect(after.x - zone.x).toBeCloseTo(inset, 0);
    expect(after.y - zone.y).toBeCloseTo(inset, 0);
  });
});
