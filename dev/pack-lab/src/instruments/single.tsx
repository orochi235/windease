import { f } from '@weasel-js/labkit';
import { PACKERS, packerById } from '../core/packers.js';
import { specFor } from '../core/run.js';
import { STORY_BOXES } from '../core/sample.js';
import { DATASETS, datasetById } from '../datasets.js';
import { defineComparison } from './defineComparison.js';
import { settingsFields } from './settings.js';

const config = f.schema({
  dataset: f
    .enum<string>(
      STORY_BOXES.id,
      DATASETS.map((d) => d.id),
    )
    .label('Dataset'),
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
  specs: (c) => [specFor(datasetById(c.dataset), packerById(c.packer), c)],
  columns: () => 1,
});
