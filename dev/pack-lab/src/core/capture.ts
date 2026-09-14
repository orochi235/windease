import type { LayoutItem } from '#windease/layout-types.js';
import type { Dataset, DatasetHint } from './types.js';

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const isSize = (v: unknown): v is [number, number] =>
  Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === 'number' && Number.isFinite(n));

/**
 * One dataset per plate in a capture file. Throws on the first malformed plate or box, naming
 * it: a capture that loads with a plate missing would compare against the wrong boxes silently.
 */
export function datasetsFromCapture(raw: unknown): Dataset[] {
  if (!isRecord(raw) || typeof raw.source !== 'string' || !Array.isArray(raw.plates)) {
    throw new Error('pack lab: a capture needs a `source` and a `plates` array');
  }
  const source = raw.source;
  const gap = typeof raw.gap === 'number' ? raw.gap : undefined;
  return raw.plates.map((plate: unknown, index) => {
    if (!isRecord(plate) || typeof plate.id !== 'string' || !Array.isArray(plate.boxes)) {
      throw new Error(`pack lab: ${source} plate ${index} needs an \`id\` and a \`boxes\` array`);
    }
    const plateId = plate.id;
    const items: LayoutItem[] = plate.boxes.map((box: unknown, i) => {
      if (!isSize(box)) {
        throw new Error(`pack lab: ${source} plate ${plateId} box ${i} is not a [w, h] pair`);
      }
      return { id: `${plateId}#${i}`, hints: { preferredSize: { w: box[0], h: box[1] } } };
    });
    const hint: DatasetHint = {};
    if (gap !== undefined) hint.gap = gap;
    if (typeof plate.columnWidth === 'number') hint.columnWidth = plate.columnWidth;
    if (typeof plate.aspect === 'number') hint.aspect = plate.aspect;
    return { id: `${source}:${plateId}`, label: plateId, domain: source, items, hint };
  });
}
