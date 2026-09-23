import { expect, type Page, test } from '@playwright/test';
import { openStory } from './fixtures.js';

const STORY = 'exotic--pack--scenarios';
/** `preset` runs the strategy the preset names. */
const STRATEGIES = ['preset', 'shelf', 'skyline', 'column'] as const;
type Strategy = (typeof STRATEGIES)[number];

/** Preset id → how many boxes render: those with a size, less any a bounded bin leaves out. */
const SCENARIOS: [string, number | Record<Strategy, number>][] = [
  ['pinterest-home-feed', 49],
  ['newspaper-front-on-phone', 13],
  ['flickr-justified-rows', 40],
  ['google-photos-panoramas', 38],
  ['masonry-images-loading', 20],
  ['texturepacker-pow2-sheet', 320],
  ['kenney-sprite-sheet', 300],
  ['flat-pack-van-floor', { preset: 5, shelf: 5, skyline: 5, column: 6 }],
  ['explorer-icons-125pct', 40],
];

interface Placed {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

async function open(page: Page, scenario: string, strategy: string, width = 0): Promise<void> {
  const args = `&arg-scenario=${scenario}&arg-strategy=${strategy}${width ? `&arg-width=${width}` : ''}`;
  await openStory(page, `${STORY}${args}`);
}

/** Every rendered box of the scenario's root, relative to the container's corner. */
async function placed(page: Page, scenario: string): Promise<Placed[]> {
  return page.evaluate((root) => {
    const container = document.querySelector(`[data-node-container="${root}"]`);
    if (!container) return [];
    const origin = container.getBoundingClientRect();
    return [...container.querySelectorAll(':scope > [data-node]')].map((el) => {
      const r = el.getBoundingClientRect();
      return {
        id: el.getAttribute('data-node') ?? '',
        x: r.left - origin.left - container.clientLeft,
        y: r.top - origin.top - container.clientTop,
        w: r.width,
        h: r.height,
      };
    });
  }, `${scenario}:root`);
}

/** Pairs of boxes that overlap by more than subpixel rounding. */
function overlapping(boxes: Placed[]): string[] {
  const found: string[] = [];
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]!;
      const b = boxes[j]!;
      const apart =
        a.x + a.w <= b.x + 0.5 ||
        b.x + b.w <= a.x + 0.5 ||
        a.y + a.h <= b.y + 0.5 ||
        b.y + b.h <= a.y + 0.5;
      if (!apart) found.push(`${a.id}/${b.id}`);
    }
  }
  return found;
}

test.describe('exotic pack scenarios render without overlap through the React layer', () => {
  for (const [scenario, counts] of SCENARIOS) {
    test(`${scenario}: every packer renders its boxes, none overlapping`, async ({ page }) => {
      for (const strategy of STRATEGIES) {
        await open(page, scenario, strategy);
        await expect(
          page.locator(`[data-node-container="${scenario}:root"] > [data-node]`),
          strategy,
        ).toHaveCount(typeof counts === 'number' ? counts : counts[strategy]);
        const boxes = await placed(page, scenario);
        expect(overlapping(boxes), strategy).toEqual([]);
      }
    });
  }
});

/** Distinct left edges of every box but `except`, rounded and sorted. */
const lefts = (boxes: Placed[], except?: string): number[] =>
  [...new Set(boxes.filter((b) => b.id !== except).map((b) => Math.round(b.x)))].sort(
    (a, b) => a - b,
  );

test.describe('Pinterest’s centered masonry', () => {
  const wideId = 'pinterest-home-feed#9';

  test('centers four columns in the 28px they leave, the full-bleed module at the left edge', async ({
    page,
  }) => {
    await open(page, 'pinterest-home-feed', 'preset');
    const boxes = await placed(page, 'pinterest-home-feed');
    const wide = boxes.find((b) => b.id === wideId)!;
    expect(wide.x).toBeCloseTo(0, 0);
    expect(wide.w).toBeCloseTo(1200, 0);
    expect(lefts(boxes, wideId)).toEqual([14, 266, 518, 770]);
  });

  test('centers two columns when the feed narrows to 600px', async ({ page }) => {
    await open(page, 'pinterest-home-feed', 'preset', 600);
    const boxes = await placed(page, 'pinterest-home-feed');
    expect(boxes.find((b) => b.id === wideId)!.x).toBeCloseTo(0, 0);
    expect(lefts(boxes, wideId)).toEqual([56, 308]);
    expect(overlapping(boxes)).toEqual([]);
  });
});

test('a TexturePacker sheet marks every sprite it turned, over that sprite’s box', async ({
  page,
}) => {
  await open(page, 'texturepacker-pow2-sheet', 'preset');
  await expect(page.getByTestId('exotic-stats')).toContainText(
    '320 placed, 0 unplaced, 128 turned',
  );
  const marks = page.locator('[data-turned]');
  await expect(marks).toHaveCount(128);
  const boxes = await placed(page, 'texturepacker-pow2-sheet');
  const byId = new Map(boxes.map((b) => [b.id, b]));
  const marked = await marks.evaluateAll((els) => {
    const container = document.querySelector(
      '[data-node-container="texturepacker-pow2-sheet:root"]',
    )!;
    const origin = container.getBoundingClientRect();
    return els.map((el) => {
      const r = el.getBoundingClientRect();
      return {
        id: el.getAttribute('data-turned') ?? '',
        x: r.left - origin.left - container.clientLeft,
        y: r.top - origin.top - container.clientTop,
        w: r.width,
        h: r.height,
      };
    });
  });
  const off = marked.filter((m) => {
    const box = byId.get(m.id);
    return (
      !box ||
      Math.abs(box.x - m.x) > 0.5 ||
      Math.abs(box.y - m.y) > 0.5 ||
      Math.abs(box.w - m.w) > 0.5 ||
      Math.abs(box.h - m.h) > 0.5
    );
  });
  expect(off.map((m) => m.id)).toEqual([]);
});

test.describe('a 20ft container floor as a bin', () => {
  test('shelf loads 9 EUR pallets inside the floor and leaves 2 on the dock', async ({ page }) => {
    await open(page, 'iso-20ft-eur-pallets', 'shelf');
    await expect(page.getByTestId('exotic-stats')).toContainText('9 placed, 2 unplaced, 1 turned');
    const boxes = await placed(page, 'iso-20ft-eur-pallets');
    expect(boxes).toHaveLength(9);
    const outside = boxes.filter(
      (b) => b.x < -0.5 || b.y < -0.5 || b.x + b.w > 235.5 || b.y + b.h > 590.5,
    );
    expect(outside).toEqual([]);
    await expect(page.locator('[data-turned]')).toHaveCount(1);
  });

  test('the preset’s own skyline turns 7 pallets and loads all 11', async ({ page }) => {
    await open(page, 'iso-20ft-eur-pallets', 'preset');
    await expect(page.getByTestId('exotic-stats')).toContainText('11 placed, 0 unplaced, 7 turned');
    await expect(page.locator('[data-turned]')).toHaveCount(7);
  });
});

test('Flickr’s justified rows each run the full 1060px width, but the last', async ({ page }) => {
  await open(page, 'flickr-justified-rows', 'preset');
  const boxes = await placed(page, 'flickr-justified-rows');
  expect(boxes).toHaveLength(40);
  const rows = new Map<number, Placed[]>();
  for (const b of boxes) {
    const y = Math.round(b.y);
    rows.set(y, [...(rows.get(y) ?? []), b]);
  }
  const ordered = [...rows.entries()].sort((a, b) => a[0] - b[0]).map(([, r]) => r);
  expect(ordered.length).toBeGreaterThan(1);
  for (const row of ordered.slice(0, -1)) {
    expect(Math.min(...row.map((b) => b.x))).toBeCloseTo(0, 0);
    expect(Math.max(...row.map((b) => b.x + b.w))).toBeCloseTo(1060, 0);
  }
  const last = ordered.at(-1)!;
  expect(Math.max(...last.map((b) => b.x + b.w))).toBeLessThan(1059);
  expect(overlapping(boxes)).toEqual([]);
});

test('the story reports the packing it shows', async ({ page }) => {
  await open(page, 'masonry-images-loading', 'column');
  await expect(page.getByTestId('exotic-stats')).toContainText(
    '20 placed, 10 unplaced, 0 turned, 800px wide',
  );
});

test('picking another preset from the dropdown packs it', async ({ page }) => {
  await open(page, 'pinterest-home-feed', 'preset');
  await expect(
    page.locator('[data-node-container="pinterest-home-feed:root"] > [data-node]'),
  ).toHaveCount(49);

  await page.getByTestId('preset-picker').selectOption('flickr-justified-rows');
  await expect(
    page.locator('[data-node-container="flickr-justified-rows:root"] > [data-node]'),
  ).toHaveCount(40);

  await page.getByTestId('preset-picker').selectOption('google-keep-notes');
  await expect(
    page.locator('[data-node-container="google-keep-notes:root"] > [data-node]'),
  ).not.toHaveCount(0);
});
