// Times a resizable grid's layout() on the dashboards TODO.md measures span
// reach against, one line per run, and writes every run's figures to --out.
//
//   npx tsx scripts/bench-grid-reach.ts --runs 5 --out reach.json
import { writeFileSync } from 'node:fs';
import { cpus, hostname, loadavg } from 'node:os';
import { gridStrategy } from '../src/layout/grid.js';
import type { LayoutItem } from '../src/layout-types.js';

const args = process.argv.slice(2);
const flag = (name: string, fallback: string) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? (args[at + 1] as string) : fallback;
};
const RUNS = Number(flag('runs', '5'));
const OUT = flag('out', '');

const panels = (n: number, ...widths: number[]): LayoutItem[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `p${i}`,
    placement: { span: { cols: widths[i % widths.length] ?? 6, rows: 8 } },
  }));

// Both wasteful cases leave columns empty in every band, so the reach sits far
// below the span that starves the rest. 7-wide panels can never fill a 24-wide
// row; 10- and 8-wide ones could, but first-fit order leaves 6 columns over.
const cases = [
  { name: 'flow-100/maxRows-220', items: panels(100), maxRows: 220 },
  { name: 'flow-200/maxRows-420', items: panels(200), maxRows: 420 },
  { name: 'flow-100x7/maxRows-272', items: panels(100, 7), maxRows: 272 },
  { name: 'flow-100x10,8/maxRows-400', items: panels(100, 10, 8), maxRows: 400 },
];

const records: Record<string, unknown>[] = [];
const total = cases.length * RUNS;
const pad = String(total).length;
let done = 0;
for (const c of cases) {
  const options = { cols: 24, maxRows: c.maxRows, cell: { h: 30 }, resizable: true };
  for (let run = 1; run <= RUNS; run++) {
    const t = performance.now();
    const r = gridStrategy.layout({
      items: c.items,
      container: { w: 2400, h: 1000 },
      state: undefined,
      options,
    });
    const ms = performance.now() - t;
    // Sums every handle's ceiling, so a change that moves any reach shows here.
    let reach = 0;
    for (const a of r.affordances) reach += a.bounds?.valueMax ?? 0;
    done++;
    console.log(
      `${String(done).padStart(pad)}/${total}  ${c.name.padEnd(26)} run ${run}  ${ms.toFixed(1).padStart(8)} ms  ${String(r.affordances.length).padStart(4)} affordances  reach sum ${String(reach).padStart(6)}`,
    );
    records.push({
      case: c.name,
      run,
      ms,
      affordances: r.affordances.length,
      reach,
      at: new Date().toISOString(),
      host: hostname(),
      cpu: cpus()[0]?.model,
      load: loadavg(),
      node: process.version,
    });
  }
}
if (OUT) writeFileSync(OUT, JSON.stringify(records, null, 2));
