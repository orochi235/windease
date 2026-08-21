import type { Rect } from '../layout-types.js';
import type { NodeId } from '../node.js';
import type { Store } from '../store.js';
import { navigableLeaves } from './navigable.js';
import type { GeometrySource, NavDirection, NavIntent } from './types.js';

export interface ResolveInput {
  store: Store;
  from: NodeId;
  intent: NavIntent;
  geometry: GeometrySource;
}

const center = (r: Rect) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

/** Cross-axis drift costs less than primary-axis distance, so a node straight
 *  ahead beats a nearer one far off to the side. */
const CROSS_AXIS_PENALTY = 2;

function directional(
  store: Store,
  from: NodeId,
  direction: NavDirection,
  geometry: GeometrySource,
): NodeId | null {
  const source = geometry.rectOf(from);
  if (!source) return null;
  const origin = center(source);

  let best: { id: NodeId; score: number } | null = null;
  for (const candidate of navigableLeaves(store, geometry)) {
    if (candidate === from) continue;
    const r = geometry.rectOf(candidate);
    if (!r) continue;
    const c = center(r);
    const dx = c.x - origin.x;
    const dy = c.y - origin.y;

    let primary: number;
    let cross: number;
    if (direction === 'left') {
      if (dx >= 0) continue;
      primary = -dx;
      cross = Math.abs(dy);
    } else if (direction === 'right') {
      if (dx <= 0) continue;
      primary = dx;
      cross = Math.abs(dy);
    } else if (direction === 'up') {
      if (dy >= 0) continue;
      primary = -dy;
      cross = Math.abs(dx);
    } else {
      if (dy <= 0) continue;
      primary = dy;
      cross = Math.abs(dx);
    }

    const score = primary + CROSS_AXIS_PENALTY * cross;
    if (!best || score < best.score) best = { id: candidate, score };
  }
  return best ? best.id : null;
}

export function resolveNavigation({ store, from, intent, geometry }: ResolveInput): NodeId | null {
  switch (intent) {
    case 'left':
    case 'right':
    case 'up':
    case 'down':
      return directional(store, from, intent, geometry);
    default:
      return null;
  }
}
