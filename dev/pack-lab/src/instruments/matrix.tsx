import { f } from '@weasel-js/labkit';
import { PACKERS } from '../core/packers.js';
import { specFor } from '../core/run.js';
import { DATASETS, datasetKey } from '../datasets.js';
import { defineComparison } from './defineComparison.js';
import { packerToggles, settingsFields } from './settings.js';

/** Datasets on when a Matrix opens: a readable grid rather than every captured plate at once. */
const OPEN_WITH = 3;

const config = f.schema({
  datasets: f
    .group(
      Object.fromEntries(
        DATASETS.map((d, i) => [datasetKey(d), f.boolean(i < OPEN_WITH).label(d.label)]),
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
    return DATASETS.filter((d) => c.datasets[datasetKey(d)]).flatMap((d) =>
      packers.map((p) => specFor(d, p, c)),
    );
  },
  columns: (c) => PACKERS.filter((p) => c.packers[p.id]).length,
});
