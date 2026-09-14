import { type ConfigSchema, defineInstrument } from '@weasel-js/labkit';
import { useMemo } from 'react';
import { run } from '../core/run.js';
import type { RunSpec } from '../core/types.js';
import { Comparison } from '../views/Comparison.js';

export interface ComparisonDef<TC> {
  name: string;
  config: ConfigSchema<TC>;
  /** The runs a config asks for, in display order. */
  specs: (config: TC) => RunSpec[];
  /** Canvases per row. */
  columns: (config: TC) => number;
}

/** labkit copies the config on every write, so its identity is a sound memo key. */
function ComparisonTrial<TC>({ def, config }: { def: ComparisonDef<TC>; config: TC }) {
  const runs = useMemo(() => def.specs(config).map((spec) => run(spec)), [def, config]);
  return <Comparison runs={runs} columns={def.columns(config)} />;
}

/** A labkit instrument that packs whatever its config names and shows the results. */
export function defineComparison<TC>(def: ComparisonDef<TC>) {
  return defineInstrument<Record<string, never>, TC>({
    name: def.name,
    config: def.config,
    initialState: () => ({}),
    // labkit calls `render` as a plain function, so hooks live in a component beneath it.
    render: ({ config }) => <ComparisonTrial def={def} config={config} />,
  });
}
