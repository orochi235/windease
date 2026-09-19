import { expect, type Page, test } from '@playwright/test';
import { PRESETS } from '../src/test-utils/exotic/strip-scenarios.js';
import { boxOf, centerOf, openStory, settledBox } from './fixtures.js';

/**
 * Real-software strip layouts driven by a real pointer. Each preset is one
 * pick of the story's `preset` arg, which Ladle reads from `arg-preset`.
 * `src/layout/strip.exotic.test.ts` checks the same presets headlessly.
 */

const STORY = 'exotic--strip--presets';

async function openPreset(page: Page, id: string): Promise<void> {
  const preset = PRESETS.find((p) => p.id === id);
  if (!preset) throw new Error(`no preset ${id}`);
  // Preview mode drops Ladle's sidebar, which otherwise covers the right third of wide presets.
  await openStory(page, `${STORY}&mode=preview&arg-preset=${id}`);
  // The default pick can paint before the URL arg lands; the caption says which one is up.
  await expect(page.getByTestId('preset-source')).toHaveText(preset.source);
}

const seam = (page: Page, id: string) => page.locator(`[data-affordance-hit="${id}"]`);
const pane = (page: Page, id: string) => page.locator(`[data-node="${id}"]`);

/**
 * Press a seam, move it `delta` px along its axis in steps, and release unless
 * told not to. `grab` offsets the press along the axis from the seam's center.
 * Throws unless the press lands on that seam: a wide preset can put it under
 * the frame's scroll edge, and a sliver pane puts a neighbor's hit area over it.
 */
async function dragSeam(
  page: Page,
  id: string,
  delta: number,
  axis: 'x' | 'y',
  release = true,
  grab = 0,
): Promise<{ x: number; y: number }> {
  await seam(page, id).scrollIntoViewIfNeeded();
  const c = centerOf(await boxOf(seam(page, id)));
  const from = axis === 'x' ? { x: c.x + grab, y: c.y } : { x: c.x, y: c.y + grab };
  const hit = await page.evaluate(
    ({ x, y }) =>
      document
        .elementFromPoint(x, y)
        ?.closest('[data-affordance-hit]')
        ?.getAttribute('data-affordance-hit') ?? null,
    from,
  );
  if (hit !== id) throw new Error(`press for ${id} lands on ${hit}`);
  const to = axis === 'x' ? { x: from.x + delta, y: from.y } : { x: from.x, y: from.y + delta };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: Math.max(4, Math.ceil(Math.abs(delta) / 4)) });
  if (release) await page.mouse.up();
  return to;
}

async function valueAttr(page: Page, id: string, name: string): Promise<number> {
  return Number(await seam(page, id).getAttribute(name));
}

test.describe('blender layout workspace', () => {
  test('pushing the timeline past its header floor arms it, and release joins it away', async ({
    page,
  }) => {
    await openPreset(page, 'blender-layout-workspace');
    const id = 'resize-y-bl-main';
    const travel =
      (await valueAttr(page, id, 'aria-valuemax')) - (await valueAttr(page, id, 'aria-valuenow'));
    expect(travel).toBe(70);
    const at = await dragSeam(page, id, travel, 'y', false);
    // The move that lands on the floor still reads unpinned; overshoot arrives in later moves.
    await page.mouse.move(at.x, at.y + 40, { steps: 5 });
    await expect(pane(page, 'bl-timeline')).toHaveAttribute('data-join-armed', 'true');
    await page.mouse.up();
    await expect(pane(page, 'bl-timeline')).toHaveCount(0);
    await expect(pane(page, 'bl-status')).toHaveCount(1);
  });

  test('backing off under the 24px threshold disarms, and the timeline survives', async ({
    page,
  }) => {
    await openPreset(page, 'blender-layout-workspace');
    const at = await dragSeam(page, 'resize-y-bl-main', 70, 'y', false);
    await page.mouse.move(at.x, at.y + 40, { steps: 5 });
    await expect(pane(page, 'bl-timeline')).toHaveAttribute('data-join-armed', 'true');
    await page.mouse.move(at.x, at.y + 10, { steps: 3 });
    await expect(page.locator('[data-node][data-join-armed]')).toHaveCount(0);
    await page.mouse.up();
    await expect(pane(page, 'bl-timeline')).toHaveCount(1);
    expect((await settledBox(pane(page, 'bl-timeline'))).h).toBeGreaterThanOrEqual(26 - 0.5);
  });

  test('the fixed-height top bar seam is pinned both ways and never arms', async ({ page }) => {
    await openPreset(page, 'blender-layout-workspace');
    await dragSeam(page, 'resize-y-bl-topbar', 80, 'y', false);
    await expect(page.locator('[data-node][data-join-armed]')).toHaveCount(0);
    await page.mouse.up();
    await expect(pane(page, 'bl-main')).toHaveCount(1);
  });

  test('a nested outliner seam resizes inside its own column', async ({ page }) => {
    await openPreset(page, 'blender-layout-workspace');
    const before = await boxOf(pane(page, 'bl-outliner'));
    const viewport = await boxOf(pane(page, 'bl-viewport'));
    await dragSeam(page, 'resize-y-bl-outliner', 40, 'y');
    expect((await settledBox(pane(page, 'bl-outliner'))).h).toBeCloseTo(before.h + 40, 0);
    expect(await boxOf(pane(page, 'bl-viewport'))).toEqual(viewport);
  });
});

test.describe('blender recursive split', () => {
  test('the outermost seam moves, and the innermost overflowing one is disabled', async ({
    page,
  }) => {
    await openPreset(page, 'blender-recursive-split');
    await expect(seam(page, 'resize-y-area-9')).toHaveAttribute('aria-disabled', 'true');
    const before = await boxOf(pane(page, 'area-0'));
    await dragSeam(page, 'resize-x-area-0', 40, 'x');
    expect((await settledBox(pane(page, 'area-0'))).w).toBeCloseTo(before.w + 40, 0);
  });
});

test.describe('bloomberg four-panel', () => {
  test('floors past the container disable every seam, and pushing one changes nothing', async ({
    page,
  }) => {
    await openPreset(page, 'bloomberg-four-panel');
    for (const id of ['resize-y-bbg-row-1', 'resize-x-bbg-1', 'resize-x-bbg-3']) {
      await expect(seam(page, id)).toHaveAttribute('aria-disabled', 'true');
    }
    const before = await boxOf(pane(page, 'bbg-1'));
    await dragSeam(page, 'resize-x-bbg-1', 120, 'x', false);
    await expect(page.locator('[data-node][data-join-armed]')).toHaveCount(0);
    await page.mouse.up();
    expect(await settledBox(pane(page, 'bbg-1'))).toEqual(before);
  });
});

test.describe('tmux even-horizontal, 40 panes', () => {
  test('forty panes and thirty-nine borders end at the right edge', async ({ page }) => {
    await openPreset(page, 'tmux-even-horizontal-40');
    const zone = await boxOf(page.locator('[data-node-container="tmux"]'));
    const last = await boxOf(pane(page, 'pane-39'));
    expect(last.x + last.w).toBeCloseTo(zone.x + zone.w, 0);
  });

  test('dragging the first border moves only its two panes', async ({ page }) => {
    await openPreset(page, 'tmux-even-horizontal-40');
    const zone = page.locator('[data-node-container="tmux"]');
    // Pressing the seam scrolls it into view, so compare offsets within the zone, not page boxes.
    const relative = async (id: string) => {
      const [p, z] = [await settledBox(pane(page, id)), await boxOf(zone)];
      return { x: p.x - z.x, w: p.w };
    };
    const [a, b, c] = [
      await relative('pane-0'),
      await relative('pane-1'),
      await relative('pane-2'),
    ];
    await dragSeam(page, 'resize-x-pane-0', 10, 'x');
    expect((await relative('pane-0')).w).toBeCloseTo(a.w + 10, 0);
    expect((await relative('pane-1')).w).toBeCloseTo(b.w - 10, 0);
    expect(await relative('pane-2')).toEqual(c);
  });
});

test.describe('vscode at its minimum width with every sidebar open', () => {
  test('every seam in the overflowing row is disabled, and arrowing one changes nothing', async ({
    page,
  }) => {
    await openPreset(page, 'vscode-every-sidebar');
    await expect(seam(page, 'resize-x-vs-sidebar')).toHaveAttribute('aria-disabled', 'true');
    const before = await boxOf(pane(page, 'vs-sidebar'));
    await seam(page, 'resize-x-vs-sidebar').focus();
    await page.keyboard.press('ArrowLeft');
    expect(await settledBox(pane(page, 'vs-sidebar'))).toEqual(before);
  });
});

test.describe('firefox with 100 tabs', () => {
  test('the tab run overflows into a scrolling frame, and the last tab scrolls into view', async ({
    page,
  }) => {
    await openPreset(page, 'firefox-100-tabs');
    const frame = page.locator('.xs-frame');
    const [scrollW, clientW] = await frame.evaluate((el) => [el.scrollWidth, el.clientWidth]);
    expect(scrollW).toBeGreaterThan(clientW);
    await frame.evaluate((el) => {
      el.scrollLeft = el.scrollWidth;
    });
    await expect(pane(page, 'tab-97')).toBeInViewport();
    expect((await boxOf(pane(page, 'tab-97'))).w).toBeCloseTo(76, 0);
  });
});

test.describe('leftover space placed by justify', () => {
  test('firefox: three tabs take their 225px cap from the left and leave the rest empty', async ({
    page,
  }) => {
    await openPreset(page, 'firefox-3-tabs');
    const zone = await boxOf(page.locator('[data-node-container="firefox-few"]'));
    for (const [i, id] of ['tab-1', 'tab-2', 'tab-3'].entries()) {
      const tab = await boxOf(pane(page, id));
      expect(tab.w).toBeCloseTo(225, 0);
      expect(tab.x - zone.x).toBeCloseTo(i * 225, 0);
    }
  });

  test('obsidian: the capped note sits centered between the sidebars', async ({ page }) => {
    await openPreset(page, 'obsidian-readable-line');
    const zone = await boxOf(page.locator('[data-node-container="obsidian"]'));
    const files = await boxOf(pane(page, 'ob-files'));
    const note = await boxOf(pane(page, 'ob-note'));
    const outline = await boxOf(pane(page, 'ob-outline'));
    expect(files.x - zone.x).toBeCloseTo(0, 0);
    expect(outline.x + outline.w - zone.x).toBeCloseTo(1920, 0);
    expect(note.x - (files.x + files.w)).toBeCloseTo(outline.x - (note.x + note.w), 0);
  });
});

test.describe('panes stored below their floor, capped, hinted or squeezed', () => {
  test('acme: dragging down from a tag-line window never shrinks it', async ({ page }) => {
    await openPreset(page, 'acme-column');
    const before = await boxOf(pane(page, 'mkfile'));
    // dat.h and fns.h are 2px slivers, so their seams' hit areas cover the lower
    // part of this one; only its top 3px is reachable.
    await dragSeam(page, 'resize-y-mkfile', 16, 'y', true, -4.5);
    expect((await settledBox(pane(page, 'mkfile'))).h).toBeGreaterThanOrEqual(before.h - 0.5);
  });

  test('vscode: dragging the explorer seam leaves the activity bar at 48px', async ({ page }) => {
    await openPreset(page, 'vscode-hinted-sidebars');
    await dragSeam(page, 'resize-x-vh-sidebar', 16, 'x');
    expect((await settledBox(pane(page, 'vh-activity'))).w).toBeCloseTo(48, 0);
  });

  test('xcode: dragging the navigator seam leaves the inspector alone', async ({ page }) => {
    await openPreset(page, 'xcode-restored-on-laptop');
    const inspector = await boxOf(pane(page, 'xc-inspector'));
    await dragSeam(page, 'resize-x-xc-navigator', 40, 'x');
    expect((await settledBox(pane(page, 'xc-inspector'))).w).toBeCloseTo(inspector.w, 0);
  });

  test('obsidian: the note stops at its 700px cap, and pushing into it never jumps the seam', async ({
    page,
  }) => {
    await openPreset(page, 'obsidian-readable-line');
    expect((await boxOf(pane(page, 'ob-note'))).w).toBeLessThanOrEqual(700.5);
    const files = await boxOf(pane(page, 'ob-files'));
    await dragSeam(page, 'resize-x-ob-files', -16, 'x');
    expect((await settledBox(pane(page, 'ob-files'))).w).toBeLessThanOrEqual(files.w);
  });

  test('photoshop: dragging a minimized group smaller never grows it', async ({ page }) => {
    await openPreset(page, 'photoshop-minimized-group');
    const before = await boxOf(pane(page, 'ps-properties'));
    await dragSeam(page, 'resize-y-ps-properties', -16, 'y');
    expect((await settledBox(pane(page, 'ps-properties'))).h).toBeLessThanOrEqual(before.h + 0.5);
  });

  test('slack: channel and thread both fit inside the window', async ({ page }) => {
    await openPreset(page, 'slack-thread-open');
    // The zone widens itself by any reported overflow, so measure against the window.
    const zone = await boxOf(page.locator('[data-node-container="slack"]'));
    const thread = await boxOf(pane(page, 'sl-thread'));
    expect(thread.x + thread.w).toBeLessThanOrEqual(zone.x + 1100 + 0.5);
  });
});
