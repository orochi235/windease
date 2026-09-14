import { useMemo } from 'react';
import type { Run } from '../core/types.js';
import { type Extent, extentOf, PackView } from './PackView.js';
import { RunTable, runKey } from './RunTable.js';

/** The widest grid lab.css has a rule for. */
const MAX_COLUMNS = 6;

/** One scale per dataset, so its packers compare at a glance without a large plate shrinking a small one. */
function extentsByDataset(runs: readonly Run[]): Map<string, Extent> {
  const groups = new Map<string, Run[]>();
  for (const run of runs) {
    const group = groups.get(run.dataset.id);
    if (group) group.push(run);
    else groups.set(run.dataset.id, [run]);
  }
  return new Map([...groups].map(([id, group]) => [id, extentOf(group)]));
}

export function Comparison({ runs, columns }: { runs: readonly Run[]; columns: number }) {
  const extents = useMemo(() => extentsByDataset(runs), [runs]);
  if (runs.length === 0) {
    return (
      <p className="pl-empty">Nothing to pack: turn on at least one dataset and one packer.</p>
    );
  }
  return (
    <div className="pl-comparison">
      <div className="pl-grid" data-columns={Math.min(Math.max(columns, 1), MAX_COLUMNS)}>
        {runs.map((run) => (
          <PackView
            key={runKey(run)}
            run={run}
            extent={extents.get(run.dataset.id) ?? extentOf([run])}
          />
        ))}
      </div>
      <RunTable runs={runs} />
    </div>
  );
}
