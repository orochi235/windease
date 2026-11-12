import { type CDPSession, expect, type Page, test } from '@playwright/test';
import { centerOf, openStory, settledBox } from './fixtures.js';

const STORY = 'reorder--touch-hold';

// Real touch input, through the browser's own gesture handling, exists only
// as a Chromium DevTools command; Playwright's touchscreen can only tap.
test.skip(({ browserName }) => browserName !== 'chromium', 'touch input needs CDP');
test.use({ hasTouch: true });

type Pt = { x: number; y: number };

async function touch(
  cdp: CDPSession,
  type: 'touchStart' | 'touchMove' | 'touchEnd',
  p?: Pt,
): Promise<void> {
  await cdp.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: p ? [{ x: p.x, y: p.y, id: 1 }] : [],
  });
}

/** Press at `from`, wait `holdMs`, and slide to `to` in steps, leaving the
 *  finger down. Returns the lift. */
async function press(page: Page, from: Pt, to: Pt, holdMs: number): Promise<() => Promise<void>> {
  const cdp = await page.context().newCDPSession(page);
  await touch(cdp, 'touchStart', from);
  await page.waitForTimeout(holdMs);
  const steps = 12;
  for (let i = 1; i <= steps; i++) {
    await touch(cdp, 'touchMove', {
      x: from.x + ((to.x - from.x) * i) / steps,
      y: from.y + ((to.y - from.y) * i) / steps,
    });
    await page.waitForTimeout(16);
  }
  return async () => {
    await touch(cdp, 'touchEnd');
    await cdp.detach();
  };
}

/** Press at `from`, wait `holdMs`, slide to `to` in steps, lift. */
async function finger(page: Page, from: Pt, to: Pt, holdMs: number): Promise<void> {
  await (await press(page, from, to, holdMs))();
}

/** Every row, top to bottom. */
function rows(page: Page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('[data-node-container="phone-list"] > [data-node]')]
      .map((el) => ({ id: el.getAttribute('data-node'), y: el.getBoundingClientRect().y }))
      .sort((a, b) => a.y - b.y)
      .map((k) => k.id),
  );
}

async function order(page: Page) {
  return (await rows(page)).slice(0, 4);
}

const scrollTop = (page: Page) => page.getByTestId('phone').evaluate((el) => el.scrollTop);

test.describe("touchScroll: 'hold' — a phone list", () => {
  test('a swipe scrolls the list and moves no row', async ({ page }) => {
    await openStory(page, STORY);
    await expect.poll(() => order(page)).toEqual(['alpha', 'bravo', 'charlie', 'delta']);
    const charlie = centerOf(await settledBox(page.getByTestId('song-charlie')));
    await finger(page, charlie, { x: charlie.x, y: charlie.y - 150 }, 0);
    await expect.poll(() => scrollTop(page)).toBeGreaterThan(50);
    await expect.poll(() => order(page)).toEqual(['alpha', 'bravo', 'charlie', 'delta']);
  });

  test('a press held still picks the row up, and the slide reorders it', async ({ page }) => {
    await openStory(page, STORY);
    await expect.poll(() => order(page)).toEqual(['alpha', 'bravo', 'charlie', 'delta']);
    const alpha = centerOf(await settledBox(page.getByTestId('song-alpha')));
    const charlie = await settledBox(page.getByTestId('song-charlie'));
    await finger(page, alpha, { x: alpha.x, y: charlie.y + charlie.h * 0.75 }, 700);
    await expect.poll(() => order(page)).toEqual(['bravo', 'charlie', 'alpha', 'delta']);
    expect(await scrollTop(page)).toBe(0);
  });

  test('a held row carried to the bottom edge scrolls the list and lands lower', async ({
    page,
  }) => {
    await openStory(page, STORY);
    await expect.poll(() => order(page)).toEqual(['alpha', 'bravo', 'charlie', 'delta']);
    const phone = await settledBox(page.getByTestId('phone'));
    const alpha = centerOf(await settledBox(page.getByTestId('song-alpha')));
    // Inside the default 48px edge margin; the finger then stays put, so the
    // scroll has to keep going without further touch input.
    const lift = await press(page, alpha, { x: alpha.x, y: phone.y + phone.h - 20 }, 700);
    await expect.poll(() => scrollTop(page)).toBeGreaterThan(100);
    await lift();
    await expect.poll(async () => (await rows(page)).indexOf('alpha')).toBeGreaterThan(5);
  });

  test('under touchScroll: true the same hold scrolls instead', async ({ page }) => {
    await openStory(page, STORY);
    await page.getByTestId('touch-mode').selectOption('true');
    const charlie = centerOf(await settledBox(page.getByTestId('song-charlie')));
    await finger(page, charlie, { x: charlie.x, y: charlie.y - 150 }, 700);
    await expect.poll(() => scrollTop(page)).toBeGreaterThan(50);
    await expect.poll(() => order(page)).toEqual(['alpha', 'bravo', 'charlie', 'delta']);
  });
});
