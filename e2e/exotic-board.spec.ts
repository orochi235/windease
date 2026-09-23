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

  test('a turned card swaps its footprint rather than growing square', async ({ page }) => {
    const before = await card(page, 'your-field-0').boundingBox();
    await card(page, 'your-field-0').click();
    await expect(card(page, 'your-field-0')).toHaveAttribute('data-tapped', 'true');

    await expect
      .poll(async () => (await card(page, 'your-field-0').boundingBox())!.width)
      .toBeGreaterThan(before!.width);
    const after = (await card(page, 'your-field-0').boundingBox())!;
    // The extents swap: the same card lying down, not a card reflowed into a
    // wide box and not the square the cross-axis stretch used to produce.
    expect(after.width).toBeCloseTo(before!.height, 0);
    expect(after.height).toBeCloseTo(before!.width, 0);
  });

  test('the card keeps its own size and is rotated to lie down', async ({ page }) => {
    await card(page, 'your-field-0').click();
    await expect(card(page, 'your-field-0')).toHaveAttribute('data-tapped', 'true');
    const drawn = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="xb-card-your-field-0"]');
      const wrapper = el?.closest('.xb-card-drag')?.parentElement as HTMLElement;
      return {
        transform: getComputedStyle(wrapper).transform,
        width: wrapper.style.width,
        height: wrapper.style.height,
      };
    });
    // Drawn at its portrait box and rotated — the library reserved the wider
    // box for it, so nothing here had to resize the card to fake the turn.
    expect(drawn.transform).not.toBe('none');
    expect(Number.parseFloat(drawn.width)).toBeLessThan(Number.parseFloat(drawn.height));
  });

  test('the band reflows around a turn as it happens', async ({ page }) => {
    const before = (await card(page, 'your-land-1').boundingBox())!;
    await card(page, 'your-land-0').click();
    // The neighbor slides over by the width the turn added, rather than being
    // overlapped by a card that grew outside its slot.
    await expect
      .poll(async () => (await card(page, 'your-land-1').boundingBox())!.x)
      .toBeGreaterThan(before.x);
  });

  test('a turn can be undone by turning it back', async ({ page }) => {
    const upright = (await card(page, 'your-field-0').boundingBox())!;
    await card(page, 'your-field-0').click();
    await expect(card(page, 'your-field-0')).toHaveAttribute('data-tapped', 'true');
    await card(page, 'your-field-0').click();
    await expect(card(page, 'your-field-0')).not.toHaveAttribute('data-tapped', 'true');
    await expect
      .poll(async () => Math.round((await card(page, 'your-field-0').boundingBox())!.width))
      .toBe(Math.round(upright.width));
  });

  test('every card on the table is drawn to the same shape', async ({ page }) => {
    const ratios = await page.evaluate(() =>
      [...document.querySelectorAll('.xb-card-drag')]
        .map((el) => {
          const r = el.getBoundingClientRect();
          return r.height > 0 ? r.width / r.height : 0;
        })
        .filter((v) => v > 0),
    );
    expect(ratios.length).toBeGreaterThan(8);
    for (const r of ratios) expect(r).toBeCloseTo(ratios[0]!, 2);
  });

  test('no band draws its cards taller than itself', async ({ page }) => {
    const overflowing = await page.evaluate(() =>
      [...document.querySelectorAll('[data-testid^="xb-band-"]')]
        .map((b) => {
          const box = b.getBoundingClientRect();
          const tallest = Math.max(
            0,
            ...[...b.querySelectorAll('.xb-card-drag')].map(
              (c) => c.getBoundingClientRect().height,
            ),
          );
          return { id: b.getAttribute('data-testid'), band: box.height, card: tallest };
        })
        .filter((r) => r.card > r.band + 1),
    );
    expect(overflowing).toEqual([]);
  });

  test('the hand parts under the pointer', async ({ page }) => {
    const still = await card(page, 'your-hand-3').boundingBox();
    const box = await card(page, 'your-hand-3').boundingBox();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await expect
      .poll(async () => (await card(page, 'your-hand-3').boundingBox())!.y)
      .toBeLessThan(still!.y);
  });

  test('a dealt hand sits side by side, whole', async ({ page }) => {
    const boxes = await handBoxes(page);
    for (let i = 1; i < boxes.length; i++) {
      // No card's right edge is under the next one's left.
      expect(boxes[i]!.x).toBeGreaterThanOrEqual(boxes[i - 1]!.x + boxes[i - 1]!.w);
    }
  });

  test('the hand fans rather than shrinking once it outgrows the band', async ({ page }) => {
    const before = await handBoxes(page);
    for (let i = 0; i < 12; i++) await page.getByTestId('xb-draw').click();
    const after = await handBoxes(page);

    expect(after.length).toBeGreaterThan(before.length);
    // Full size kept, and the next card now starts before this one ends.
    expect(after[1]!.w).toBeCloseTo(before[1]!.w, 0);
    expect(after[1]!.x).toBeLessThan(after[0]!.x + after[0]!.w);
  });

  test('the hand scrolls once fanning runs out of room', async ({ page }) => {
    const scroller = page.getByTestId('xb-hand-scroll');
    const fits = async () =>
      scroller.evaluate((el) => ({ client: el.clientWidth, scroll: el.scrollWidth }));

    // The dealt hand fans inside the band, with nothing to scroll.
    const dealt = await fits();
    expect(dealt.scroll).toBeLessThanOrEqual(dealt.client + 1);

    for (let i = 0; i < 30; i++) await page.getByTestId('xb-draw').click();

    // Past the peek floor the row reports overflow, and the wrapper grows.
    const full = await fits();
    expect(full.scroll).toBeGreaterThan(full.client);

    // And it really scrolls, rather than reporting an extent nothing reaches.
    await scroller.evaluate((el) => {
      el.scrollLeft = el.scrollWidth;
    });
    expect(await scroller.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
  });

  test('drawing never stops, because the hand is no longer capped', async ({ page }) => {
    for (let i = 0; i < 30; i++) await page.getByTestId('xb-draw').click();
    await expect(page.getByTestId('xb-draw')).toBeEnabled();
    await expect(page.getByTestId('xb-draw')).toHaveText('Draw');
  });

  test('a magnified card stays inside the band it is drawn in', async ({ page }) => {
    for (let i = 0; i < 20; i++) await page.getByTestId('xb-draw').click();
    const box = await page.getByTestId('xb-hand-scroll').boundingBox();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2, { steps: 20 });

    const out = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="xb-hand-scroll"]') as HTMLElement;
      const b = el.getBoundingClientRect();
      let over = 0;
      let tallest = 0;
      for (const c of document.querySelectorAll('[data-testid="xb-hand-scroll"] .xb-card-drag')) {
        const r = c.getBoundingClientRect();
        over = Math.max(over, b.top - r.top, r.bottom - b.bottom);
        tallest = Math.max(tallest, r.height);
      }
      return { over, tallest, rest: el.clientHeight };
    });

    // Something under the cursor really did grow, and the band still holds it:
    // a scroller cannot spill on its cross axis, so this has to fit by sizing.
    expect(out.tallest).toBeGreaterThan(out.rest * 0.55);
    expect(out.over).toBeLessThanOrEqual(1);
  });

  test('turning a land pays mana, and turning it back takes it away', async ({ page }) => {
    const total = page.getByTestId('xb-mana-total');
    await expect(total).toHaveText('0');
    await card(page, 'your-land-0').click();
    await expect(total).toHaveText('1');
    await card(page, 'your-land-1').click();
    await expect(total).toHaveText('2');
    await card(page, 'your-land-0').click();
    await expect(total).toHaveText('1');
  });

  test('playing a card from hand spends its cost', async ({ page }) => {
    for (const id of ['your-land-0', 'your-land-1', 'your-land-2', 'your-land-3']) {
      await card(page, id).click();
    }
    const before = Number(await page.getByTestId('xb-mana-total').innerText());
    const cost = Number(
      await card(page, 'your-hand-1')
        .locator('.xb-card__pips')
        .innerText()
        .catch(() => '0'),
    );
    await dragOnto(page, 'your-hand-1', 'your-field');
    await expect.poll(() => bandUnder(page, 'your-hand-1')).toBe('your-field');
    await expect
      .poll(async () => Number(await page.getByTestId('xb-mana-total').innerText()))
      .toBe(before - cost);
  });

  test('an aura is played onto a unit, not into a row', async ({ page }) => {
    // The stacked opening hand puts the aura third.
    const aura = card(page, 'your-hand-2');
    await expect(aura).toHaveAttribute('data-kind', 'aura');

    const host = await card(page, 'your-field-0').boundingBox();
    const src = await aura.boundingBox();
    await page.mouse.move(src!.x + src!.width / 2, src!.y + src!.height / 2);
    await page.mouse.down();
    await page.mouse.move(host!.x + host!.width / 2, host!.y + host!.height / 2, { steps: 24 });
    await page.mouse.up();

    // It now belongs to the creature, and is drawn as a tab rather than a card.
    await expect(page.getByTestId('xb-aura-your-hand-2')).toBeVisible();
    // It is inside the creature's own box, not the row's.
    const onHost = await page.evaluate(() => {
      const tab = document.querySelector('[data-testid="xb-aura-your-hand-2"]');
      const host = document.querySelector('[data-node="your-field-0"]');
      return !!tab && !!host && host.contains(tab);
    });
    expect(onHost).toBe(true);

    // And it is no longer a card in the hand.
    await expect(page.getByTestId('xb-card-your-hand-2')).toHaveCount(0);
  });

  test('a unit does not swallow a drop meant for the row it stands in', async ({ page }) => {
    // The aura slot is only a target while an aura is in the air; a unit
    // dropped onto an occupied row must still reach the row.
    await dragOnto(page, 'your-hand-1', 'your-field');
    await expect.poll(() => bandUnder(page, 'your-hand-1')).toBe('your-field');
  });

  test('right-clicking a card opens it in the lightbox', async ({ page }) => {
    await expect(page.getByTestId('xb-lightbox')).toHaveCount(0);
    await card(page, 'your-hand-0').click({ button: 'right' });
    await expect(page.getByTestId('xb-lightbox-card')).toBeVisible();

    // The big card is the same card.
    const name = await page.getByTestId('xb-lightbox-card').locator('.xb-card__name').innerText();
    const onTable = await card(page, 'your-hand-0').locator('.xb-card__name').innerText();
    expect(name).toBe(onTable);

    await page.keyboard.press('Escape');
    await expect(page.getByTestId('xb-lightbox')).toHaveCount(0);
  });

  test('every card is drawn to Magic proportions, turned or not', async ({ page }) => {
    await card(page, 'your-land-0').click();
    const ratios = await page.evaluate(() =>
      [...document.querySelectorAll('.xb-card')]
        .filter((el) => (el as HTMLElement).offsetHeight > 0)
        .map((el) => (el as HTMLElement).offsetWidth / (el as HTMLElement).offsetHeight),
    );
    expect(ratios.length).toBeGreaterThan(10);
    for (const r of ratios) expect(r).toBeCloseTo(63 / 88, 1);
  });
});

/** The hand's placement boxes, not the cards': `bow` rotates each card, and a
 *  rotated card's bounding box is wider than the box it was placed in. */
async function handBoxes(page: Page): Promise<Array<{ x: number; w: number }>> {
  return page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="xb-hand-scroll"] [data-node]')].map((el) => ({
      x: (el as HTMLElement).offsetLeft,
      w: (el as HTMLElement).offsetWidth,
    })),
  );
}
