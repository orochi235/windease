#!/usr/bin/env node
// Repeat-run the Playwright suite and rank every test by how often it fails.
//
// What it answers: which specs are actually flaky, and in which of the three
// modes TODO.md names. The ranking there is a static heuristic — geometry reads
// per settledBox poll — and this replaces it with counts.
//
// Two arms, because the suite is documented as failing only under machine load:
// `idle` runs alone, `loaded` runs with CPU spinners holding the load average
// near twice the core count. An all-green idle arm beside a red loaded one is
// the result, not a failed measurement.
//
//   node scripts/flake-census.mjs --budget-minutes 420 --out census.json
//   node scripts/flake-census.mjs --arms idle --runs 5        # quick smoke
//
// Retries stay at 0 (playwright.config.ts, absent CI) so a flake is recorded
// rather than retried away.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { availableParallelism, tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : fallback;
};

const OUT = flag('out', 'flake-census.json');
const RUNS = Number(flag('runs', '1000'));
const BUDGET_MS = Number(flag('budget-minutes', '420')) * 60_000;
const ARMS = flag('arms', 'idle,loaded').split(',');
const CORES = availableParallelism();
// TODO.md puts the threshold at roughly twice the core count. The suite's own
// workers contribute, so the spinners aim at the threshold rather than past it.
const SPINNERS = Number(flag('spinners', String(CORES * 2)));

const started = Date.now();
const elapsed = () => Date.now() - started;
const mmss = (ms) =>
  `${Math.floor(ms / 60_000)}m${String(Math.floor((ms / 1000) % 60)).padStart(2, '0')}s`;

/** One row per (engine, file, title), accumulated across every run of every arm. */
const tests = new Map();
const runs = [];

/**
 * Which of the three documented failure modes a result is. `starved` and
 * `story-load` are both timeouts and only the message separates them;
 * `assertion` is the one that can be mistaken for a real regression.
 */
function classify(result) {
  const text = `${result.error?.message ?? ''} ${result.errors?.map((e) => e.message).join(' ') ?? ''}`;
  if (/story .* never (rendered|placed)|openStory|first placed node/i.test(text))
    return 'story-load';
  if (result.status === 'timedOut') return 'starved';
  if (/expect|toBe|toEqual|toHaveCount|toBeGreater/i.test(text)) return 'assertion';
  return 'other';
}

function walk(suite, file, engine, onSpec) {
  for (const spec of suite.specs ?? []) {
    for (const test of spec.tests ?? []) {
      const project = test.projectName ?? engine;
      for (const result of test.results ?? []) {
        onSpec({ file: file ?? spec.file, title: spec.title, project, result });
      }
    }
  }
  for (const child of suite.suites ?? []) walk(child, child.file ?? file, engine, onSpec);
}

function record(report) {
  let passed = 0;
  const failures = [];
  for (const suite of report.suites ?? []) {
    walk(suite, suite.file, null, ({ file, title, project, result }) => {
      const key = `${project} › ${file} › ${title}`;
      const row = tests.get(key) ?? { key, project, file, title, runs: 0, failures: 0, modes: {} };
      row.runs += 1;
      if (result.status === 'passed') {
        passed += 1;
      } else {
        const mode = classify(result);
        row.failures += 1;
        row.modes[mode] = (row.modes[mode] ?? 0) + 1;
        failures.push({ key, mode, ms: result.duration });
      }
      tests.set(key, row);
    });
  }
  return { passed, failures };
}

function startSpinners(n) {
  if (n <= 0) return [];
  // A bare busy loop is the cheapest way to move the load average; each one
  // pins a core and nothing else.
  return Array.from({ length: n }, () =>
    spawn(process.execPath, ['-e', 'for(;;);'], { stdio: 'ignore', detached: false }),
  );
}

let spinners = [];
const stopSpinners = () => {
  for (const p of spinners) p.kill('SIGKILL');
  spinners = [];
};
for (const sig of ['SIGINT', 'SIGTERM', 'exit']) process.on(sig, stopSpinners);

const jsonDir = mkdtempSync(join(tmpdir(), 'flake-census-'));

function playwright(jsonPath) {
  return new Promise((resolve) => {
    const child = spawn('npx', ['playwright', 'test', '--reporter=list,json'], {
      // `list` keeps a line per test on stdout so a long run is never
      // indistinguishable from a hung one; `json` goes to the file we parse.
      env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_NAME: jsonPath, CI: '' },
      stdio: ['ignore', 'inherit', 'inherit'],
    });
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

function writeOut() {
  const ranked = [...tests.values()]
    .map((t) => ({ ...t, rate: t.runs ? t.failures / t.runs : 0 }))
    .sort((a, b) => b.rate - a.rate || b.failures - a.failures);
  writeFileSync(
    OUT,
    `${JSON.stringify(
      {
        startedAt: new Date(started).toISOString(),
        elapsedMs: elapsed(),
        cores: CORES,
        spinners: SPINNERS,
        arms: ARMS,
        runs,
        tests: ranked,
      },
      null,
      2,
    )}\n`,
  );
  return ranked;
}

console.log(
  `flake census: arms=${ARMS.join('+')} runs<=${RUNS} budget=${mmss(BUDGET_MS)} (${mmss(BUDGET_MS / ARMS.length)} per arm) cores=${CORES} spinners=${SPINNERS}`,
);
console.log(`writing ${OUT} after every run — safe to read or interrupt at any point\n`);

let n = 0;
// Split evenly rather than first-come: one arm is not a result, and a shared
// budget would spend the whole night on `idle` and never start `loaded`.
const ARM_BUDGET_MS = BUDGET_MS / ARMS.length;
for (const arm of ARMS) {
  if (arm === 'loaded') spinners = startSpinners(SPINNERS);
  const armStarted = Date.now();
  for (let i = 1; i <= RUNS; i++) {
    if (Date.now() - armStarted > ARM_BUDGET_MS) {
      console.log(`\n[${arm}] budget spent after ${mmss(Date.now() - armStarted)} — next arm`);
      break;
    }
    n += 1;
    const jsonPath = join(jsonDir, `run-${n}.json`);
    const t0 = Date.now();
    const code = await playwright(jsonPath);
    const took = Date.now() - t0;

    let summary = { passed: 0, failures: [] };
    try {
      summary = record(JSON.parse(readFileSync(jsonPath, 'utf8')));
    } catch (err) {
      console.log(`  [${arm}] run ${i} produced no parseable report: ${err.message}`);
    }
    rmSync(jsonPath, { force: true });

    runs.push({ arm, index: i, ms: took, exit: code, failures: summary.failures.length });
    console.log(
      `\n[${arm}] run ${i}/${RUNS} — ${summary.passed} passed, ${summary.failures.length} failed in ${mmss(took)} (elapsed ${mmss(elapsed())})`,
    );
    for (const f of summary.failures) console.log(`    ✗ ${f.mode.padEnd(10)} ${f.key}`);
    writeOut();
  }
  stopSpinners();
}
stopSpinners();

const ranked = writeOut();
const flaky = ranked.filter((t) => t.failures > 0);
console.log(
  `\n=== ${n} runs in ${mmss(elapsed())}; ${flaky.length} tests failed at least once ===`,
);
for (const t of flaky.slice(0, 40)) {
  const modes = Object.entries(t.modes)
    .map(([m, c]) => `${m}×${c}`)
    .join(' ');
  console.log(
    `${String(Math.round(t.rate * 100)).padStart(3)}%  ${String(t.failures).padStart(3)}/${String(t.runs).padEnd(4)} ${modes.padEnd(24)} ${t.key}`,
  );
}
if (flaky.length === 0) console.log('every test passed every run');
console.log(`\nfull results: ${OUT}`);
rmSync(jsonDir, { recursive: true, force: true });
