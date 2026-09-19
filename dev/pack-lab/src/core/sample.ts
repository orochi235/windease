import type { Dataset } from './types.js';

/** The Pack story's boxes, in the story's order. */
const BOXES: [number, number][] = [
  [110, 80],
  [60, 50],
  [200, 150],
  [90, 30],
  [70, 140],
  [150, 60],
  [140, 220],
  [80, 70],
  [120, 120],
  [100, 40],
  [60, 90],
  [160, 100],
  [70, 40],
  [90, 180],
];

export const STORY_BOXES: Dataset = {
  id: 'windease:story-boxes',
  label: 'Pack story boxes',
  domain: 'windease',
  items: BOXES.map(([w, h], i) => ({ id: `box-${i + 1}`, hints: { preferredSize: { w, h } } })),
  hint: { gap: 8 },
};
