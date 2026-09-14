import { type ConfigSchema, defineInstrument } from '@weasel-js/labkit';
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

/** A labkit instrument that packs whatever its config names and shows the results. */
export function defineComparison<TC>(def: ComparisonDef<TC>) {
  return defineInstrument<Record<string, never>, TC>({
    name: def.name,
    config: def.config,
    initialState: () => ({}),
    render: ({ config }) => (
      <Comparison runs={def.specs(config).map((spec) => run(spec))} columns={def.columns(config)} />
    ),
  });
}
