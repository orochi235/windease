import type { Dataset } from './types.js';

const BOXES: [number, number][] = [
  [140, 220],
  [90, 180],
  [200, 150],
  [70, 140],
  [120, 120],
  [160, 100],
  [60, 90],
  [110, 80],
  [80, 70],
  [150, 60],
  [60, 50],
  [100, 40],
  [70, 40],
  [90, 30],
];

export const STORY_BOXES: Dataset = {
  id: 'windease:story-boxes',
  label: 'Pack story boxes',
  domain: 'windease',
  items: BOXES.map(([w, h], i) => ({ id: `box-${i + 1}`, hints: { preferredSize: { w, h } } })),
  hint: { gap: 8 },
};
