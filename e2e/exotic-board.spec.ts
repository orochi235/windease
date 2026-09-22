import { expect, type Page, test } from '@playwright/test';
import { openStory } from './fixtures.js';

const STORY = 'exotic--board--duel-board';

const card = (page: Page, id: string) => page.getByTestId(`xb-card-${id}`);
const band = (page: Page, id: string) => page.getByTestId(`xb-band-${id}`);

/** Which band a card's center currently sits inside, by geometry rather than
 *  by the DOM — the point being that the two agree under the projection. */
async function bandUnder(page: Page, cardId: string): Promise<string | null> {
  return page.evaluate((id) => {
    const el = document.querySelector(`[data-testid="xb-card-${id}"]`);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const cx = r.x + r.width / 2;
    const cy = r.y + r.height / 2;
    for (const b of document.querySelectorAll('[data-testid^="xb-band-"]')) {
      const box = b.getBoundingClientRect();
      if (cx >= box.x && cx <= box.x + box.width && cy >= box.y && cy <= box.y + box.height) {
        return (b.getAttribute('data-testid') ?? '').replace('xb-band-', '');
      }
    }
    return null;
  }, cardId);
}

/** Drag `from` onto the middle of `to`, in steps so the hit-test samples. */
async function dragOnto(page: Page, cardId: string, bandId: string): Promise<void> {
  const src = await card(page, cardId).boundingBox();
  const dst = await band(page, bandId).boundingBox();
  if (!src || !dst) throw new Error(`missing geometry for ${cardId} → ${bandId}`);
  await page.mouse.move(src.x + src.width / 2, src.y + src.height / 2);
  await page.mouse.down();
  await page.mouse.move(dst.x + dst.width / 2, dst.y + dst.height / 2, { steps: 24 });
  await page.mouse.up();
}

test.describe('duel board', () => {
  test.beforeEach(async ({ page }) => {
    await openStory(page, STORY);
  });

  test('renders both halves of the table', async ({ page }) => {
    await expect(band(page, 'your-hand')).toBeVisible();
    await expect(band(page, 'opp-field')).toBeVisible();
    await expect(page.getByTestId('xb-pile-graveyard')).toBeVisible();
  });

  test('the table recedes: a far band draws its cards smaller than a near one', async ({
    page,
  }) => {
    const far = await card(page, 'opp-field-0').boundingBox();
    const near = await card(page, 'your-field-0').boundingBox();
    expect(far!.width).toBeLessThan(near!.width);
  });

  // The test the CSS approach fails: under a transformed parent the drop
  // resolves against an inflated bounding box and lands in the wrong band.
  test('a card dropped on a band lands in the band under the cursor', async ({ page }) => {
    await dragOnto(page, 'your-hand-0', 'your-field');
    await expect.poll(() => bandUnder(page, 'your-hand-0')).toBe('your-field');
  });

  test('a card can be dragged back to the hand', async ({ page }) => {
    await dragOnto(page, 'your-hand-1', 'your-land');
    await expect.poll(() => bandUnder(page, 'your-hand-1')).toBe('your-land');
    await dragOnto(page, 'your-hand-1', 'your-hand');
    await expect.poll(() => bandUnder(page, 'your-hand-1')).toBe('your-hand');
  });

  test("the opponent's half refuses your cards", async ({ page }) => {
    await dragOnto(page, 'your-hand-2', 'opp-field');
    await expect.poll(() => bandUnder(page, 'your-hand-2')).toBe('your-hand');
  });

  test('the pile rail refuses cards; they belong in bands', async ({ page }) => {
    const rail = await page.getByTestId('xb-pile-graveyard').boundingBox();
    const src = await card(page, 'your-hand-2').boundingBox();
    await page.mouse.move(src!.x + src!.width / 2, src!.y + src!.height / 2);
    await page.mouse.down();
    await page.mouse.move(rail!.x + rail!.width / 2, rail!.y + rail!.height / 2, { steps: 24 });
    await page.mouse.up();
    await expect.poll(() => bandUnder(page, 'your-hand-2')).toBe('your-hand');
  });

  test('a turned card is rotated, not just widened', async ({ page }) => {
    const before = await card(page, 'your-field-0').boundingBox();
    await card(page, 'your-field-0').click();
    await expect(card(page, 'your-field-0')).toHaveAttribute('data-tapped', 'true');
    // The face is the same portrait card on its side: its own width is now
    // the box's height. A card merely reflowed into a wide box would not
    // carry a rotation at all.
    const turn = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="xb-card-your-field-0"]') as HTMLElement;
      return getComputedStyle(el).transform;
    });
    expect(turn).not.toBe('none');
    // The footprint widens; it does not also shorten, because a strip fills
    // its cross axis and the row's height is the band's.
    const after = await card(page, 'your-field-0').boundingBox();
    expect(after!.width).toBeGreaterThan(before!.width);
  });

  test('clicking a card turns it a quarter and the band reflows', async ({ page }) => {
    const before = await card(page, 'your-field-0').boundingBox();
    await card(page, 'your-field-0').click();
    await expect(card(page, 'your-field-0')).toHaveAttribute('data-tapped', 'true');
    await expect
      .poll(async () => (await card(page, 'your-field-0').boundingBox())!.width)
      .toBeGreaterThan(before!.width);
  });

  test('the hand parts under the pointer', async ({ page }) => {
    const still = await card(page, 'your-hand-3').boundingBox();
    const box = await card(page, 'your-hand-3').boundingBox();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await expect
      .poll(async () => (await card(page, 'your-hand-3').boundingBox())!.y)
      .toBeLessThan(still!.y);
  });

  test('the hand overlaps rather than shrinking its cards', async ({ page }) => {
    // The placement boxes, not the cards': `bow` rotates each card, and a
    // rotated card's bounding box is wider than the box it was placed in.
    const boxes = await page.evaluate(() =>
      ['your-hand-0', 'your-hand-1'].map((id) => {
        const el = document.querySelector(`[data-node="${id}"]`) as HTMLElement;
        return { x: el.offsetLeft, w: el.offsetWidth };
      }),
    );
    const [a, b] = boxes;
    // Full size kept, and the next card starts before this one ends.
    expect(b!.w).toBeCloseTo(a!.w, 0);
    expect(b!.x).toBeLessThan(a!.x + a!.w);
  });
});
