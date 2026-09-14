import { f } from '@weasel-js/labkit';
import { PACKERS } from '../core/packers.js';
import { specFor } from '../core/run.js';
import { datasetById } from '../datasets.js';
import { defineComparison } from './defineComparison.js';
import { datasetField, settingsFields } from './settings.js';

const config = f.schema({
  dataset: datasetField(),
  packer: f
    .enum<string>(
      'skyline',
      PACKERS.map((p) => p.id),
    )
    .label('Packer'),
  ...settingsFields(),
});

export const single = defineComparison({
  name: 'Single',
  config,
  specs: (c) => {
    // A stored trial can name a packer since removed.
    const packer = PACKERS.find((p) => p.id === c.packer) ?? PACKERS[0];
    return packer ? [specFor(datasetById(c.dataset), packer, c)] : [];
  },
  columns: () => 1,
});
