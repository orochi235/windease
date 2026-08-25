#!/usr/bin/env node
// Measure how long a story takes to render its first placed node, per engine.
//
// What it answers: whether `openStory`'s wait budget (e2e/fixtures.ts) still
// has headroom over a cold start. The suite's flake history is Firefox specs
// failing that precondition under machine load and passing in isolation; the
// margin is the thing to measure, because the suite itself does not fail on
// demand.
//
//   npm run ladle &                             # or reuse a running one
//   node scripts/probe-story-load.mjs firefox 3
//   node scripts/probe-story-load.mjs firefox 3 --stories a--b,c--d
//
// To measure the cold path — which is where the margin is thinnest — clear
// Vite's cache and restart Ladle first (`rm -rf node_modules/.vite`), and run
// several of these at once to emulate the suite's parallel workers:
//
//   for e in firefox firefox chromium webkit; do node scripts/probe-story-load.mjs $e 2 & done
//
// Story ids come from Ladle's /meta.json, so this cannot drift out of date the
// way a hardcoded list does.
import { chromium, firefox, webkit } from 'playwright';

const PORT = 61000;
const BASE = `http://localhost:${PORT}`;
const ENGINES = { chromium, firefox, webkit };

const [engineName = 'firefox', repsArg = '3', ...rest] = process.argv.slice(2);
const reps = Number(repsArg);
const engine = ENGINES[engineName];
if (!engine) {
  console.error(`unknown engine "${engineName}" — one of ${Object.keys(ENGINES).join(', ')}`);
  process.exit(1);
}

const explicit = rest.includes('--stories') ? rest[rest.indexOf('--stories') + 1].split(',') : null;

async function storyIds() {
  if (explicit) return explicit;
  const res = await fetch(`${BASE}/meta.json`);
  if (!res.ok) throw new Error(`GET /meta.json → ${res.status}; is Ladle running on ${PORT}?`);
  const meta = await res.json();
  return Object.keys(meta.stories ?? {});
}

const stories = await storyIds();
// One story per file is enough to sample the cold path; the whole catalogue
// would measure Ladle's routing, not the first render.
const sample = stories.filter((_, i) => i % Math.max(1, Math.ceil(stories.length / 8)) === 0);

const browser = await engine.launch();
const durations = [];
const failures = [];
let n = 0;
const total = reps * sample.length;

for (let r = 0; r < reps; r++) {
  for (const story of sample) {
    n++;
    const context = await browser.newContext({ viewport: { width: 1200, height: 800 } });
    const page = await context.newPage();
    const started = Date.now();
    let ms = -1;
    let note = '';
    try {
      await page.goto(`${BASE}/?story=${story}`, { timeout: 60_000 });
      await page.locator('[data-node]').first().waitFor({ state: 'visible', timeout: 60_000 });
      ms = Date.now() - started;
      durations.push(ms);
    } catch (error) {
      note = String(error).split('\n')[0].slice(0, 120);
      failures.push({ story, note });
    }
    console.log(`${n}/${total} ${engineName} ${story} ${ms > 0 ? `${ms}ms` : `FAILED ${note}`}`);
    await context.close();
  }
}
await browser.close();

durations.sort((a, b) => a - b);
const at = (p) => durations[Math.min(durations.length - 1, Math.floor((durations.length - 1) * p))];
console.log(
  `\n${engineName}: n=${n} failed=${failures.length} ` +
    `median=${at(0.5)}ms p90=${at(0.9)}ms max=${durations.at(-1)}ms`,
);
process.exit(failures.length > 0 ? 1 : 0);
