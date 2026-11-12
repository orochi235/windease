import { type CDPSession, type Page, test } from '@playwright/test';
import { openStory, settledBox } from './fixtures.js';

// A probe, not a check: WINDEASE_PROBE=1 npx playwright test
// overflow-origin-probe.spec.ts --project=chromium. Sweeps the cursor across
// the duel board's hand and reports, per pointermove, the layouts and script
// time Chromium counted and every scroll write `useOverflowOrigin` made on the
// hand's surface. Chromium only: the counters come from CDP.

const STORY = 'exotic--board--duel-board';

test.skip(!process.env.WINDEASE_PROBE, 'a probe: runs only when WINDEASE_PROBE is set');

const METRICS = ['LayoutCount', 'RecalcStyleCount', 'LayoutDuration', 'ScriptDuration'] as const;
type Sample = Record<(typeof METRICS)[number], number>;

async function metrics(cdp: CDPSession): Promise<Sample> {
  const { metrics: all } = await cdp.send('Performance.getMetrics');
  const out = {} as Sample;
  for (const m of METRICS) out[m] = all.find((x) => x.name === m)?.value ?? 0;
  return out;
}

/** Record every scroll write made to the hand's surface, with what it held after. */
async function watchWrites(page: Page): Promise<void> {
  await page.evaluate(() => {
    const el = document.querySelector('[data-testid="xb-hand-surface"]') as HTMLElement;
    const log: Array<{ prop: string; asked: number; got: number }> = [];
    (window as unknown as { __writes: typeof log }).__writes = log;
    for (const prop of ['scrollTop', 'scrollLeft'] as const) {
      const d = Object.getOwnPropertyDescriptor(Element.prototype, prop)!;
      Object.defineProperty(el, prop, {
        configurable: true,
        get: () => d.get!.call(el),
        set: (v: number) => {
          d.set!.call(el, v);
          log.push({ prop, asked: v, got: d.get!.call(el) as number });
        },
      });
    }
  });
}

async function takeWrites(
  page: Page,
): Promise<Array<{ prop: string; asked: number; got: number }>> {
  return page.evaluate(() => {
    const w = window as unknown as {
      __writes: Array<{ prop: string; asked: number; got: number }>;
    };
    return w.__writes.splice(0);
  });
}

async function surface(page: Page) {
  return page.evaluate(() => {
    const el = document.querySelector('[data-testid="xb-hand-surface"]') as HTMLElement;
    const box = document.querySelector('[data-node-container="your-hand"]') as HTMLElement;
    return {
      top: el.scrollTop,
      left: el.scrollLeft,
      rangeY: el.scrollHeight - el.clientHeight,
      rangeX: el.scrollWidth - el.clientWidth,
      boxLeft: box.getBoundingClientRect().left,
      boxTop: box.getBoundingClientRect().top,
    };
  });
}

async function sweep(page: Page, cdp: CDPSession, label: string, steps: number, press: boolean) {
  const dock = await settledBox(page.getByTestId('xb-hand-dock'));
  const y = dock.y + dock.h - 60;
  await page.mouse.move(dock.x + 8, y);
  if (press) await page.mouse.down();
  const rows: Array<Sample & { ms: number; writes: number }> = [];
  await takeWrites(page);
  const allWrites: Array<{ prop: string; asked: number; got: number }> = [];
  for (let i = 1; i <= steps; i++) {
    const x = dock.x + 8 + ((dock.w - 16) * i) / steps;
    const before = await metrics(cdp);
    const t0 = Date.now();
    await page.mouse.move(x, y);
    const ms = Date.now() - t0;
    const after = await metrics(cdp);
    const writes = await takeWrites(page);
    allWrites.push(...writes);
    const row = { ms, writes: writes.length } as Sample & { ms: number; writes: number };
    for (const m of METRICS) row[m] = after[m] - before[m];
    rows.push(row);
    console.log(
      `${label} ${String(i).padStart(2)}/${steps} layouts=${row.LayoutCount} ` +
        `layoutMs=${(row.LayoutDuration * 1000).toFixed(2).padStart(6)} ` +
        `scriptMs=${(row.ScriptDuration * 1000).toFixed(2).padStart(6)} writes=${row.writes}`,
    );
  }
  if (press) await page.mouse.up();
  return { rows, writes: allWrites };
}

test('overflow-origin probe', async ({ page }, info) => {
  test.setTimeout(180_000);
  await openStory(page, STORY);
  await page.addStyleTag({
    content: '.xb-root *, .xb-root *::before, .xb-root *::after { box-shadow: none !important; }',
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForTimeout(1500);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  await watchWrites(page);

  const record: Record<string, unknown> = { at: new Date().toISOString() };
  record.initial = await surface(page);

  // A hover sweep, a press-and-sweep, then the same over a hand that scrolls.
  record.hover = await sweep(page, cdp, 'hover', 24, false);
  await page.mouse.move(4, 4);
  await page.waitForTimeout(300);
  record.afterHover = await surface(page);
  record.drag = await sweep(page, cdp, 'drag', 24, true);
  await page.mouse.move(4, 4);
  await page.waitForTimeout(300);
  record.afterDrag = await surface(page);

  await page.getByTestId('xb-draw').evaluate((el) => {
    for (let i = 0; i < 30; i++) (el as HTMLButtonElement).click();
  });
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    const el = document.querySelector('[data-testid="xb-hand-surface"]') as HTMLElement;
    el.scrollLeft = el.scrollWidth;
    el.scrollTop = el.scrollHeight;
  });
  await takeWrites(page);
  record.scrolledStart = await surface(page);
  record.scrolledHover = await sweep(page, cdp, 'scrolled-hover', 24, false);
  await page.mouse.move(4, 4);
  await page.waitForTimeout(300);
  record.scrolledAfter = await surface(page);

  const sum = (rows: Array<Sample & { ms: number; writes: number }>, k: keyof Sample | 'ms') =>
    rows.reduce((s, r) => s + r[k], 0);
  for (const key of ['hover', 'drag', 'scrolledHover'] as const) {
    const { rows, writes } = record[key] as {
      rows: Array<Sample & { ms: number; writes: number }>;
      writes: Array<{ prop: string; asked: number; got: number }>;
    };
    const line =
      `${key}: moves=${rows.length} layouts=${sum(rows, 'LayoutCount')} ` +
      `layoutMs=${(sum(rows, 'LayoutDuration') * 1000).toFixed(1)} ` +
      `scriptMs=${(sum(rows, 'ScriptDuration') * 1000).toFixed(1)} ` +
      `wallMs=${sum(rows, 'ms')} writes=${writes.length} ` +
      `negativeAsks=${writes.filter((w) => w.asked < 0).length} ` +
      `clamped=${writes.filter((w) => Math.abs(w.asked - w.got) > 0.5).length}`;
    console.log(line);
    info.annotations.push({ type: 'overflow-origin-probe', description: line });
  }
  console.log(
    `initial=${JSON.stringify(record.initial)} afterHover=${JSON.stringify(record.afterHover)}`,
  );
  console.log(
    `scrolledStart=${JSON.stringify(record.scrolledStart)} scrolledAfter=${JSON.stringify(record.scrolledAfter)}`,
  );
  await info.attach('overflow-origin-probe.json', {
    body: JSON.stringify(record, null, 2),
    contentType: 'application/json',
  });
  console.log(`RECORD ${JSON.stringify(record)}`);
});
