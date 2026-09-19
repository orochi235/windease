import { expect, type Page, test } from '@playwright/test';
import { openStory } from './fixtures.js';

const STORY = 'justified--photos';

interface Photo {
  left: number;
  top: number;
  w: number;
  h: number;
  aspect: number;
}

/** Every photo's rect relative to the zone's padding box, plus the zone's inner width. */
async function measure(page: Page): Promise<{ width: number; photos: Photo[] }> {
  return page.evaluate(() => {
    const zone = document.querySelector('.windease-zone') as HTMLElement;
    const origin = zone.getBoundingClientRect();
    const photos = [...zone.querySelectorAll<HTMLElement>('[data-node]')].map((el) => {
      const r = el.getBoundingClientRect();
      const aspect = Number(el.querySelector('[data-aspect]')?.getAttribute('data-aspect'));
      return {
        left: r.left - origin.left - zone.clientLeft,
        top: r.top - origin.top - zone.clientTop,
        w: r.width,
        h: r.height,
        aspect,
      };
    });
    return { width: zone.clientWidth, photos };
  });
}

/** Every way the layout breaks the justified contract; empty when it holds. */
async function faults(page: Page): Promise<string[]> {
  const { width, photos } = await measure(page);
  const out: string[] = [];
  if (photos.length !== 40) out.push(`${photos.length} photos`);
  const rows = new Map<number, Photo[]>();
  for (const p of photos) {
    const key = Math.round(p.top);
    rows.set(key, [...(rows.get(key) ?? []), p]);
  }
  const ordered = [...rows.entries()].sort(([a], [b]) => a - b).map(([, row]) => row);
  if (ordered.length < 2) out.push(`${ordered.length} rows`);
  ordered.forEach((row, i) => {
    row.sort((a, b) => a.left - b.left);
    for (const p of row) {
      if (Math.abs(p.w - p.aspect * p.h) > 1) {
        out.push(`row ${i}: ${p.w.toFixed(1)}×${p.h.toFixed(1)} is not aspect ${p.aspect}`);
      }
    }
    if (i === ordered.length - 1) return;
    const first = row[0]!;
    const last = row[row.length - 1]!;
    if (Math.abs(first.left) > 1) out.push(`row ${i} starts at ${first.left.toFixed(1)}`);
    const right = last.left + last.w;
    if (Math.abs(right - width) > 1) out.push(`row ${i} ends at ${right.toFixed(1)} of ${width}`);
  });
  return out;
}

async function slide(page: Page, testId: string, value: number): Promise<void> {
  await page.getByTestId(testId).fill(String(value));
}

test.describe('justified rows', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openStory(page, STORY);
  });

  test('fill the width on every row but the last, at each photo’s own aspect', async ({ page }) => {
    await expect.poll(() => faults(page)).toEqual([]);

    for (const [width, rowHeight] of [
      [520, 120],
      [1300, 220],
      [700, 80],
    ] as const) {
      await slide(page, 'justified-width', width);
      await slide(page, 'justified-row-height', rowHeight);
      await expect
        .poll(() => page.evaluate(() => document.querySelector('.windease-zone')!.clientWidth))
        .toBe(width);
      await expect.poll(() => faults(page)).toEqual([]);
    }
  });

  test('a taller target makes fewer rows', async ({ page }) => {
    const rowCount = async () =>
      new Set((await measure(page)).photos.map((p) => Math.round(p.top))).size;
    await slide(page, 'justified-row-height', 80);
    await expect.poll(() => faults(page)).toEqual([]);
    const short = await rowCount();
    await slide(page, 'justified-row-height', 300);
    await expect.poll(rowCount).toBeLessThan(short);
  });
});
