import { formatMetric, METRICS } from '../core/metrics.js';
import type { Run } from '../core/types.js';

export const runKey = (run: Run): string => `${run.dataset.id}|${run.packer.id}`;

export function RunTable({ runs }: { runs: readonly Run[] }) {
  return (
    <table className="pl-table">
      <thead>
        <tr>
          <th scope="col">run</th>
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
