import type { NodeId } from '../node.js';
import type { Store } from '../store.js';
import type { GeometrySource } from './types.js';

/** Below this, a pane is as unreachable as one at zero, and float geometry
 *  makes exact-zero comparisons unreliable. */
const MIN_NAVIGABLE_PX = 1;

/**
 * Every leaf that can currently take focus, in document order. Hidden and
 * destroyed subtrees are excluded, as are nodes with no measurable rect —
 * which is what keeps a zero-size or unplaced pane out of the tab ring.
 */
export function navigableLeaves(store: Store, geometry: GeometrySource): NodeId[] {
  const out: NodeId[] = [];
  const walk = (ids: readonly NodeId[]): void => {
    for (const nid of ids) {
      const node = store.getNode(nid);
      if (!node) continue;
      // A container only takes its subtree out of the set by being hidden.
      // `mounted` still renders — `<Container>` never checks its parent's
      // lifecycle, so a root nobody called showNode on is on screen.
      if (node.lifecycle.state === 'hidden' || node.lifecycle.state === 'destroyed') continue;
      const children = store.getChildren(nid).map((c) => c.id);
      if (children.length > 0) {
        walk(children);
        continue;
      }
      if (node.lifecycle.state !== 'visible') continue;
      if (!node.focus) continue;
      const r = geometry.rectOf(nid);
      if (!r || r.w < MIN_NAVIGABLE_PX || r.h < MIN_NAVIGABLE_PX) continue;
      out.push(nid);
    }
  };
  walk(store.rootIds);
  return out;
}
