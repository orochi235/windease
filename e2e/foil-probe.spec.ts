import { type Page, test } from '@playwright/test';
import { centerOf, openStory, settledBox } from './fixtures.js';

// A probe, not a check: run through the `E2E probe` workflow with
// spec=foil-probe.spec.ts. Each test reports one variant's input latency and
// frame rate on the duel board as annotations, which land in probe.json.

const STORY = 'exotic--board--duel-board';

test.skip(!process.env.WINDEASE_PROBE, 'a probe: runs only under the E2E probe workflow');

const VARIANTS: Record<string, string> = {
  current: '',
  'no-blend': 'body .xb-card--foil::after { mix-blend-mode: normal; }',
  'no-will-change': 'body .xb-card--foil::after { will-change: auto; }',
  'no-animation': 'body .xb-card--foil::after { animation: none; }',
  'no-foil': 'body .xb-card--foil::after { display: none; }',
};

/** Frames drawn over `ms`, counted by requestAnimationFrame. */
function framesOver(page: Page, ms: number): Promise<number> {
  return page.evaluate(
    (span) =>
      new Promise<number>((resolve) => {
        let n = 0;
        const end = performance.now() + span;
        const tick = (t: number) => {
          n++;
          if (t < end) requestAnimationFrame(tick);
          else resolve(n);
        };
        requestAnimationFrame(tick);
      }),
    ms,
  );
}

for (const [name, css] of Object.entries(VARIANTS)) {
  test(`foil probe: ${name}`, async ({ page }, info) => {
    test.setTimeout(120_000);
    await openStory(page, STORY);
    if (css) await page.addStyleTag({ content: css });
    const foils = await page.locator('.xb-card--foil').count();
    // The first seconds after open draw almost nothing in WebKit, foil or not.
    await page.waitForTimeout(6000);
    const board = await settledBox(page.locator('[data-testid^="xb-band-"]').first());
    const from = centerOf(board);
    const moves: number[] = [];
    for (let i = 0; i < 20; i++) {
      const t0 = Date.now();
      await page.mouse.move(from.x + (i % 2 ? 40 : -40), from.y);
      moves.push(Date.now() - t0);
    }
    const fps = (await framesOver(page, 2000)) / 2;
    moves.sort((a, b) => a - b);
    const median = moves[Math.floor(moves.length / 2)];
    const worst = moves[moves.length - 1];
    const line = `${name}: foils=${foils} move median=${median}ms worst=${worst}ms fps=${fps.toFixed(1)}`;
    console.log(line);
    info.annotations.push({ type: 'foil-probe', description: line });
    info.annotations.push({ type: 'foil-probe-moves', description: JSON.stringify(moves) });
  });
}
