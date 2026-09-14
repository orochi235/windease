import { f } from '@weasel-js/labkit';
import { PACKERS } from '../core/packers.js';
import { specFor } from '../core/run.js';
import { datasetById } from '../datasets.js';
import { defineComparison } from './defineComparison.js';
import { datasetField, packerToggles, settingsFields } from './settings.js';

const config = f.schema({
  dataset: datasetField(),
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
