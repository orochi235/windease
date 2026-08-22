import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { boxOf, centerOf, openStory } from './fixtures.js';

const SPLIT = 'recursive-zones--split-resize';
const PLAYGROUND = 'playground--playground';
const ROOT_GUTTER = '[data-affordance-hit="resize-x-a"]';
const MID_GUTTER = '[data-affordance-hit="resize-y-b"]';

/** What a real pointer would land on at this point, described the way the
 *  test cares about it: the affordance id, or the node whose content it is. */
function hitAt(page: Page, x: number, y: number) {
  return page.evaluate(
    ({ px, py }) => {
      const el = document.elementFromPoint(px, py);
      if (!el) return null;
      const aff = el.closest('[data-affordance-hit]');
      if (aff) return `affordance:${aff.getAttribute('data-affordance-hit')}`;
      const node = el.closest('[data-node]');
      return node ? `node:${node.getAttribute('data-node')}` : `other:${el.tagName}`;
    },
    { px: x, py: y },
  );
}

/**
 * Every container renders its own affordance layer, and nested containers
 * stack theirs inside the parent's. A hit area that over-claims eats the
 * pane's own content; one that loses to a sibling layer cannot be grabbed.
 * Neither shows up in a layout assertion — only a hit test sees it.
 */
test.describe('affordance hit areas and what is under them', () => {
  test('a gutter wins at its own center', async ({ page }) => {
    await openStory(page, SPLIT);
    const c = centerOf(await boxOf(page.locator(ROOT_GUTTER)));
    expect(await hitAt(page, c.x, c.y)).toBe('affordance:resize-x-a');
  });

  test('a nested gutter is not covered by its parent layer', async ({ page }) => {
    await openStory(page, SPLIT);
    const c = centerOf(await boxOf(page.locator(MID_GUTTER)));
    expect(await hitAt(page, c.x, c.y)).toBe('affordance:resize-y-b');
  });

  test('pane content is reachable just past the hit area', async ({ page }) => {
    await openStory(page, SPLIT);
    const g = await boxOf(page.locator(ROOT_GUTTER));
    const y = g.y + g.h / 2;

    expect(await hitAt(page, g.x - 6, y)).toBe('node:a');
    expect(await hitAt(page, g.x + g.w + 6, y)).not.toBe('affordance:resize-x-a');
  });

  test('the hit area is wider than the painted seam, and bounded', async ({ page }) => {
    await openStory(page, SPLIT);
    const g = await boxOf(page.locator(ROOT_GUTTER));
    // Wide enough to be grabbable by an imprecise pointer...
    expect(g.w).toBeGreaterThanOrEqual(8);
    // ...and not so wide it swallows a pane edge a user means to click.
    expect(g.w).toBeLessThanOrEqual(20);
  });

  test('consumer chrome inside a pane stays clickable', async ({ page }) => {
    await openStory(page, PLAYGROUND);
    const btn = page.locator('[data-node="panel-1"] .pg-panel-btn--close');
    const c = centerOf(await boxOf(btn));

    expect(await hitAt(page, c.x, c.y)).toBe('node:panel-1');

    await btn.click();
    await expect(page.locator('[data-node="panel-1"]')).toHaveCount(0);
  });

  test('a drag handle is not shadowed by the zone gutter beside it', async ({ page }) => {
    await openStory(page, PLAYGROUND);
    const handle = await boxOf(page.locator('[data-windease-drag-handle="tool-2"]'));
    // The right edge of the last dock tool, where the zone gutter runs.
    const probe = { x: handle.x + handle.w - 3, y: handle.y + handle.h / 2 };
    const hit = await hitAt(page, probe.x, probe.y);
    expect(hit).toBe('node:tool-2');
  });
});
