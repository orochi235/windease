import { expect, test } from '@playwright/test';
import { boxOf, centerOf, dragMouse, openStory } from './fixtures.js';

const BAND_STORY = 'floating--handle-band';
const WHOLE_STORY = 'floating--whole-panel-handle';

const LEGEND = '[data-node="legend"]';
const HANDLE = '[data-affordance-hit="floating:drag:legend"]';
const ZONE = '.windease-zone';

/**
 * The legend's offset inside the zone's content box — the container the
 * strategy lays out against. The zone has a 1px border, so the bounding box
 * alone is a pixel off on every edge.
 */
async function offsetInZone(page: import('@playwright/test').Page) {
  const zone = await boxOf(page.locator(ZONE));
  const legend = await boxOf(page.locator(LEGEND));
  const border = await page.locator(ZONE).evaluate((el) => {
    const s = getComputedStyle(el);
    return { left: Number.parseFloat(s.borderLeftWidth), top: Number.parseFloat(s.borderTopWidth) };
  });
  const inner = {
    x: zone.x + border.left,
    y: zone.y + border.top,
    w: zone.w - border.left * 2,
    h: zone.h - border.top * 2,
  };
  return {
    left: Math.round(legend.x - inner.x),
    top: Math.round(legend.y - inner.y),
    right: Math.round(inner.x + inner.w - (legend.x + legend.w)),
    bottom: Math.round(inner.y + inner.h - (legend.y + legend.h)),
  };
}

test.describe('floating panel', () => {
  test('seeds at the default anchor, 12px in from the bottom left', async ({ page }) => {
    await openStory(page, BAND_STORY);
    expect(await offsetInZone(page)).toMatchObject({ left: 12, bottom: 12 });
  });

  test('a drag toward the bottom-right corner snaps it to a 12px inset', async ({ page }) => {
    await openStory(page, BAND_STORY);
    const zone = await boxOf(page.locator(ZONE));
    const handle = await boxOf(page.locator(HANDLE));

    // Aim past the corner: the clamp stops the panel at the edge and the
    // per-axis threshold captures it from there.
    await dragMouse(page, centerOf(handle), { x: zone.x + zone.w + 40, y: zone.y + zone.h + 40 });

    expect(await offsetInZone(page)).toMatchObject({ right: 12, bottom: 12 });
  });

  test('dragging back off the corner leaves it free', async ({ page }) => {
    await openStory(page, BAND_STORY);
    const zone = await boxOf(page.locator(ZONE));
    let handle = await boxOf(page.locator(HANDLE));
    await dragMouse(page, centerOf(handle), { x: zone.x + zone.w + 40, y: zone.y + zone.h + 40 });
    expect(await offsetInZone(page)).toMatchObject({ right: 12, bottom: 12 });

    handle = await boxOf(page.locator(HANDLE));
    const from = centerOf(handle);
    await dragMouse(page, from, { x: from.x - 80, y: from.y - 80 });

    const after = await offsetInZone(page);
    expect(after.right).toBeGreaterThan(60);
    expect(after.bottom).toBeGreaterThan(60);
  });

  test('never snaps to top-left, which the item excludes', async ({ page }) => {
    await openStory(page, BAND_STORY);
    const zone = await boxOf(page.locator(ZONE));
    const handle = await boxOf(page.locator(HANDLE));

    await dragMouse(page, centerOf(handle), { x: zone.x - 40, y: zone.y - 40 });

    // Clamped into the corner, but resting at 0 rather than the 12px inset a
    // snap would give it.
    expect(await offsetInZone(page)).toMatchObject({ left: 0, top: 0 });
  });

  test('the band leaves the rest of the panel clickable', async ({ page }) => {
    await openStory(page, BAND_STORY);
    await page.locator('[data-testid="legend-button"]').click();
    await expect(page.locator('[data-testid="legend-clicks"]')).toHaveText('1');
  });

  test('a whole-panel handle swallows the click', async ({ page }) => {
    await openStory(page, WHOLE_STORY);
    const button = await boxOf(page.locator('[data-testid="legend-button"]'));
    const at = centerOf(button);
    await page.mouse.click(at.x, at.y);
    await expect(page.locator('[data-testid="legend-clicks"]')).toHaveText('0');
  });
});
