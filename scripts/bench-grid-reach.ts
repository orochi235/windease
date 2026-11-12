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

const panels = (n: number): LayoutItem[] =>
  Array.from({ length: n }, (_, i) => ({ id: `p${i}`, placement: { span: { cols: 6, rows: 8 } } }));

const cases = [
  { name: 'flow-100/maxRows-220', items: panels(100), maxRows: 220 },
  { name: 'flow-200/maxRows-420', items: panels(200), maxRows: 420 },
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
    done++;
    console.log(
      `${String(done).padStart(pad)}/${total}  ${c.name.padEnd(22)} run ${run}  ${ms.toFixed(1).padStart(8)} ms  ${String(r.affordances.length).padStart(4)} affordances`,
    );
    records.push({
      case: c.name,
      run,
      ms,
      affordances: r.affordances.length,
      at: new Date().toISOString(),
      host: hostname(),
      cpu: cpus()[0]?.model,
      load: loadavg(),
      node: process.version,
    });
  }
}
if (OUT) writeFileSync(OUT, JSON.stringify(records, null, 2));
