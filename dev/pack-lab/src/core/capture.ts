import type { LayoutItem } from '#windease/layout-types.js';
import type { Dataset, DatasetHint } from './types.js';

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

const isSize = (v: unknown): v is [number, number] =>
  Array.isArray(v) && v.length === 2 && v.every((n) => isFiniteNumber(n) && n > 0);

/** A capture hint value: finite, and positive unless `allowZero` (only `gap` allows it). */
function hintNumber(
  value: unknown,
  key: string,
  where: string,
  allowZero: boolean,
): number | undefined {
  if (value === undefined) return undefined;
  const ok = isFiniteNumber(value) && (allowZero ? value >= 0 : value > 0);
  if (!ok)
    throw new Error(
      `pack lab: ${where} \`${key}\` is not a ${allowZero ? 'non-negative' : 'positive'} number`,
    );
  return value;
}

/**
 * One dataset per plate in a capture file. Throws on the first malformed plate or box, naming
 * it: a capture that loads with a plate missing would compare against the wrong boxes silently.
 */
export function datasetsFromCapture(raw: unknown): Dataset[] {
  if (
    !isRecord(raw) ||
    typeof raw.source !== 'string' ||
    typeof raw.commit !== 'string' ||
    !Array.isArray(raw.plates)
  ) {
    throw new Error('pack lab: a capture needs a `source` and a `plates` array');
  }
  const source = raw.source;
  const commit = raw.commit;
  const gap = hintNumber(raw.gap, 'gap', `${source} capture`, true);
  const seen = new Set<string>();
  return raw.plates.map((plate: unknown, index) => {
    if (!isRecord(plate) || typeof plate.id !== 'string' || !Array.isArray(plate.boxes)) {
      throw new Error(`pack lab: ${source} plate ${index} needs an \`id\` and a \`boxes\` array`);
    }
    const plateId = plate.id;
    if (seen.has(plateId)) {
      throw new Error(`pack lab: ${source} has more than one plate named ${plateId}`);
    }
    seen.add(plateId);
    const items: LayoutItem[] = plate.boxes.map((box: unknown, i) => {
      if (!isSize(box)) {
        throw new Error(`pack lab: ${source} plate ${plateId} box ${i} is not a [w, h] pair`);
      }
      return { id: `${plateId}#${i}`, hints: { preferredSize: { w: box[0], h: box[1] } } };
    });
    const hint: DatasetHint = {};
    if (gap !== undefined) hint.gap = gap;
    const columnWidth = hintNumber(
      plate.columnWidth,
      'columnWidth',
      `${source} plate ${plateId}`,
      false,
    );
    if (columnWidth !== undefined) hint.columnWidth = columnWidth;
    const aspect = hintNumber(plate.aspect, 'aspect', `${source} plate ${plateId}`, false);
    if (aspect !== undefined) hint.aspect = aspect;
    return { id: `${source}@${commit}:${plateId}`, label: plateId, domain: source, items, hint };
  });
}
