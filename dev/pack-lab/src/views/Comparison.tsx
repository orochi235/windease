import { useMemo } from 'react';
import type { Run } from '../core/types.js';
import { extentOf, PackView } from './PackView.js';
import { RunTable, runKey } from './RunTable.js';

/** The widest grid lab.css has a rule for. */
const MAX_COLUMNS = 6;

export function Comparison({ runs, columns }: { runs: readonly Run[]; columns: number }) {
  const extent = useMemo(() => extentOf(runs), [runs]);
  if (runs.length === 0) {
    return (
      <p className="pl-empty">Nothing to pack: turn on at least one dataset and one packer.</p>
    );
  }
  return (
    <div className="pl-comparison">
      <div className="pl-grid" data-columns={Math.min(Math.max(columns, 1), MAX_COLUMNS)}>
        {runs.map((run) => (
          <PackView key={runKey(run)} run={run} extent={extent} />
        ))}
      </div>
      <RunTable runs={runs} />
    </div>
  );
}
