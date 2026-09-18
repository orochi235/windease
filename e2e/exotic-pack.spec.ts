import { expect, type Page, test } from '@playwright/test';
import { openStory } from './fixtures.js';

const STORY = 'exotic--pack--scenarios';
const PACKERS = ['shelf', 'skyline', 'column'] as const;

/** Preset id → how many of its items have a size and so render. */
const SCENARIOS: [string, number][] = [
  ['pinterest-home-feed', 49],
  ['newspaper-front-on-phone', 13],
  ['google-photos-panoramas', 38],
  ['masonry-images-loading', 20],
  ['texturepacker-pow2-sheet', 320],
  ['kenney-sprite-sheet', 300],
  ['flat-pack-van-floor', 14],
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
  for (const [scenario, count] of SCENARIOS) {
    test(`${scenario}: every packer renders ${count} boxes, none overlapping`, async ({ page }) => {
      for (const strategy of PACKERS) {
        await open(page, scenario, strategy);
        await expect(
          page.locator(`[data-node-container="${scenario}:root"] > [data-node]`),
        ).toHaveCount(count);
        const boxes = await placed(page, scenario);
        expect(overlapping(boxes), strategy).toEqual([]);
      }
    });
  }
});

test.describe('the full-bleed Pinterest module in masonry', () => {
  const wideId = 'pinterest-home-feed#9';

  test('sits at the container’s left edge across all four columns', async ({ page }) => {
    await open(page, 'pinterest-home-feed', 'column');
    const boxes = await placed(page, 'pinterest-home-feed');
    const wide = boxes.find((b) => b.id === wideId)!;
    expect(wide.x).toBeCloseTo(0, 0);
    expect(wide.w).toBeCloseTo(1200, 0);
    const lefts = [...new Set(boxes.filter((b) => b.id !== wideId).map((b) => Math.round(b.x)))];
    expect(lefts.sort((a, b) => a - b)).toEqual([0, 252, 504, 756]);
  });

  test('stays at the left edge when the feed narrows to two columns', async ({ page }) => {
    await open(page, 'pinterest-home-feed', 'column', 600);
    const boxes = await placed(page, 'pinterest-home-feed');
    expect(boxes.find((b) => b.id === wideId)!.x).toBeCloseTo(0, 0);
    const lefts = [...new Set(boxes.filter((b) => b.id !== wideId).map((b) => Math.round(b.x)))];
    expect(lefts.sort((a, b) => a - b)).toEqual([0, 252]);
    expect(overlapping(boxes)).toEqual([]);
  });
});

test('the story reports the packing it shows', async ({ page }) => {
  await open(page, 'masonry-images-loading', 'column');
  await expect(page.getByTestId('exotic-stats')).toContainText(
    '20 placed, 10 unplaced, 800px wide',
  );
});
