import { datasetsFromCapture } from './core/capture.js';
import { STORY_BOXES } from './core/sample.js';
import type { Dataset } from './core/types.js';

const captures = import.meta.glob('../datasets/*.json', { eager: true, import: 'default' });

const stemOf = (path: string): string =>
  path.slice(path.lastIndexOf('/') + 1).replace(/\.json$/, '');

/** The built-in sample, then every capture file's plates, files in name order. */
export const DATASETS: readonly Dataset[] = [
  STORY_BOXES,
  ...Object.keys(captures)
    .sort()
    .flatMap((path) => datasetsFromCapture(captures[path], stemOf(path))),
];

/** A dataset's id as a config key. labkit splits config paths on `.`, and plate ids can hold dots. */
export const datasetKey = (dataset: Dataset): string => dataset.id.replaceAll('.', '~');

const ids = new Set<string>();
const keys = new Set<string>();
for (const dataset of DATASETS) {
  if (ids.has(dataset.id)) throw new Error(`pack lab: two datasets share the id ${dataset.id}`);
  ids.add(dataset.id);
  const key = datasetKey(dataset);
  if (keys.has(key)) {
    throw new Error(`pack lab: dataset ${dataset.id} collides with another at config key ${key}`);
  }
  keys.add(key);
}

/** A stored trial can name a dataset a recapture dropped; it falls back to the sample. */
export const datasetById = (id: string): Dataset =>
  DATASETS.find((d) => d.id === id) ?? STORY_BOXES;
