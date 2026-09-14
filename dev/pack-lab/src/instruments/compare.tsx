import { f } from '@weasel-js/labkit';
import { PACKERS } from '../core/packers.js';
import { specFor } from '../core/run.js';
import { STORY_BOXES } from '../core/sample.js';
import { DATASETS, datasetById } from '../datasets.js';
import { defineComparison } from './defineComparison.js';
import { packerToggles, settingsFields } from './settings.js';

const config = f.schema({
  dataset: f
    .enum<string>(
      STORY_BOXES.id,
      DATASETS.map((d) => d.id),
    )
    .label('Dataset'),
  packers: packerToggles(),
  ...settingsFields(),
});

export const compare = defineComparison({
  name: 'Compare',
  config,
  specs: (c) =>
    PACKERS.filter((p) => c.packers[p.id]).map((p) => specFor(datasetById(c.dataset), p, c)),
  columns: (c) => PACKERS.filter((p) => c.packers[p.id]).length,
});
