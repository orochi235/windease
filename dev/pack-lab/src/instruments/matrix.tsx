import { f } from '@weasel-js/labkit';
import { PACKERS } from '../core/packers.js';
import { specFor } from '../core/run.js';
import { DATASETS } from '../datasets.js';
import { defineComparison } from './defineComparison.js';
import { packerToggles, settingsFields } from './settings.js';

/** Datasets on when a Matrix opens: a readable grid rather than every captured plate at once. */
const OPEN_WITH = 3;

// Keyed by position, not id: a config path is dotted, and a plate id can hold a dot.
const datasetKey = (index: number) => `d${index}`;

const config = f.schema({
  datasets: f
    .group(
      Object.fromEntries(
        DATASETS.map((d, i) => [datasetKey(i), f.boolean(i < OPEN_WITH).label(d.label)]),
      ),
    )
    .label('Datasets'),
  packers: packerToggles(),
  ...settingsFields(),
});

export const matrix = defineComparison({
  name: 'Matrix',
  config,
  specs: (c) => {
    const packers = PACKERS.filter((p) => c.packers[p.id]);
    return DATASETS.filter((_, i) => c.datasets[datasetKey(i)]).flatMap((d) =>
      packers.map((p) => specFor(d, p, c)),
    );
  },
  columns: (c) => PACKERS.filter((p) => c.packers[p.id]).length,
});
