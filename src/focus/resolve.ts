import { nodeToLayoutItem } from '../layout-node-adapter.js';
import type { LayoutItem, LayoutStrategy, Rect } from '../layout-types.js';
import type { NodeId } from '../node.js';
import type { Store } from '../store.js';
import { trace } from '../trace.js';
import { navigableLeaves } from './navigable.js';
import { isFocusable } from './successor.js';
import type { GeometrySource, NavDirection, NavIntent } from './types.js';

export interface ResolveInput {
  store: Store;
  from: NodeId;
  intent: NavIntent;
  geometry: GeometrySource;
  strategies?: ReadonlyMap<string, LayoutStrategy<unknown, string, unknown>>;
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

function siblingsOf(store: Store, from: NodeId, geometry: GeometrySource): NodeId[] {
  const parentId = store.getNode(from)?.membership?.parentId;
  if (!parentId) return [];
  const navigable = new Set(navigableLeaves(store, geometry));
  return store
    .getChildren(parentId)
    .map((c) => c.id)
    .filter((cid) => navigable.has(cid));
}

function builtinResolve({
  store,
  from,
  intent,
  geometry,
  strategies,
}: ResolveInput): NodeId | null {
  switch (intent) {
    case 'left':
    case 'right':
    case 'up':
    case 'down': {
      const parentId = store.getNode(from)?.membership?.parentId;
      const parent = parentId ? store.getNode(parentId) : undefined;
      const strategy = parent?.container ? strategies?.get(parent.container.strategyId) : undefined;
      if (strategy?.navigate && parentId) {
        const items: LayoutItem[] = store.getChildren(parentId).map((c) => nodeToLayoutItem(c));
        const chosen = strategy.navigate({
          items,
          from,
          direction: intent,
          options: (parent?.container?.config ?? {}) as Record<string, unknown>,
        });
        if (chosen !== undefined) return chosen === null ? null : (chosen as NodeId);
      }
      return directional(store, from, intent, geometry);
    }
    case 'next':
    case 'prev': {
      const row = siblingsOf(store, from, geometry);
      const at = row.indexOf(from);
      if (at < 0) return null;
      const to = intent === 'next' ? row[at + 1] : row[at - 1];
      return to ?? null;
    }
    case 'first':
    case 'last': {
      const row = siblingsOf(store, from, geometry);
      const to = intent === 'first' ? row[0] : row[row.length - 1];
      return to && to !== from ? to : null;
    }
    case 'cycleNext':
    case 'cyclePrev': {
      const all = navigableLeaves(store, geometry);
      if (all.length === 0) return null;
      const at = all.indexOf(from);
      if (at < 0) return all[0] ?? null;
      const step = intent === 'cycleNext' ? 1 : -1;
      return all[(at + step + all.length) % all.length] ?? null;
    }
    default:
      return null;
  }
}

/**
 * Replaces the built-in navigation resolution. Return an id to choose it,
 * `null` to refuse the move, or `undefined` to fall through to
 * `strategy.navigate` and then to geometry.
 *
 * A returned id must name a focusable, visible node — the React focus binding
 * focuses whatever comes back. Anything else is traced and treated as
 * `undefined`.
 */
export type NavigationPolicy = (input: ResolveInput) => NodeId | null | undefined;

/** A policy that calls back into `resolveNavigation` would otherwise recurse
 *  forever; the re-entrant call answers from the built-in instead. */
let consultingPolicy = false;

export function resolveNavigation(input: ResolveInput): NodeId | null {
  if (consultingPolicy) return builtinResolve(input);
  const policy = input.store.navigationPolicy;
  if (!policy) return builtinResolve(input);
  let chosen: NodeId | null | undefined;
  consultingPolicy = true;
  try {
    chosen = policy(input);
  } catch (err) {
    trace('workspace', `navigation policy threw, using built-in: ${err}`);
    chosen = undefined;
  } finally {
    consultingPolicy = false;
  }
  if (chosen && !isFocusable(input.store, chosen)) {
    trace('workspace', `navigation policy returned unusable ${chosen}, using built-in`);
    chosen = undefined;
  }
  if (chosen !== undefined) return chosen;
  return builtinResolve(input);
}
