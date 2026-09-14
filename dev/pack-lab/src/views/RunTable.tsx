import { formatMetric, METRICS } from '../core/metrics.js';
import type { Run } from '../core/types.js';

export const runKey = (run: Run): string => `${run.dataset.id}|${run.packer.id}`;

const optionCell = (run: Run, key: string): string => {
  const value = run.options[key];
  return typeof value === 'number' ? value.toFixed(1) : '—';
};

/** What each run was packed with, which with dataset hints on can differ from the sliders. */
const SETTINGS: readonly { id: string; label: string; cell: (run: Run) => string }[] = [
  {
    id: 'fit',
    label: 'fit',
    cell: ({ fit }) =>
      fit.kind === 'aspect' ? `ratio ${fit.ratio.toFixed(2)}` : `width ${fit.width.toFixed(1)}`,
  },
  { id: 'gap', label: 'gap', cell: (run) => optionCell(run, 'gap') },
  { id: 'columnWidth', label: 'column width', cell: (run) => optionCell(run, 'columnWidth') },
];

export function RunTable({ runs }: { runs: readonly Run[] }) {
  return (
    <table className="pl-table">
      <caption className="pl-table__caption">Runs</caption>
      <thead>
        <tr>
          <th scope="col">run</th>
          {SETTINGS.map((s) => (
            <th key={s.id} scope="col" className="pl-table__num">
              {s.label}
            </th>
          ))}
          {METRICS.map((m) => (
            <th key={m.id} scope="col" className="pl-table__num">
              {m.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {runs.map((run) => (
          <tr key={runKey(run)}>
            <th scope="row">
              {run.dataset.label} · {run.packer.id}
            </th>
            {SETTINGS.map((s) => (
              <td key={s.id} className="pl-table__num">
                {s.cell(run)}
              </td>
            ))}
            {METRICS.map((m) => (
              <td key={m.id} className="pl-table__num">
                {formatMetric(m, run.metrics[m.id] ?? Number.NaN)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
