import type { LayoutItem, LayoutNode, LayoutResult, LayoutStrategy, Size } from './layout-types.js';
import type { Node, NodeId } from './node.js';
import type { Store } from './store.js';

/**
 * Convert a Node into the legacy LayoutItem shape consumed by existing
 * strategies. `placement` (per-membership) projects into `meta` because that
 * is the field strategies read for flags like `pinned`/`locked` today.
 *
 * Phase 7 may collapse LayoutItem and LayoutNode; until then this adapter
 * lets nodes flow through unchanged strategy code.
 */
export function nodeToLayoutItem(node: Node): LayoutItem {
  const item: LayoutItem = { id: node.id };
  if (node.hints?.minSize || node.hints?.preferredSize) {
    item.hints = {};
    if (node.hints.minSize) item.hints.minSize = node.hints.minSize;
    if (node.hints.preferredSize) item.hints.preferredSize = node.hints.preferredSize;
  }
  const placement = node.slot?.placement;
  if (placement && Object.keys(placement).length > 0) {
    item.meta = { ...placement };
  }
  return item;
}

/** Convert a Node into the LayoutNode shape. */
export function nodeToLayoutNode(node: Node): LayoutNode {
  const out: LayoutNode = {
    id: node.id,
    hints: { ...(node.hints ?? {}) },
    meta: { ...(node.meta ?? {}) },
    placement: { ...(node.slot?.placement ?? {}) },
    isContainer: !!node.container,
    activity: { ...(node.activity ?? {}) },
  };
  if (node.kind !== undefined) out.kind = node.kind;
  return out;
}

/**
 * Collect visible children of `parentId` as LayoutNodes in childOrder order.
 * Hidden children (lifecycle.state === 'hidden') are excluded.
 */
export function getLayoutNodes(store: Store, parentId: NodeId): LayoutNode[] {
  const children = store.getChildren(parentId);
  const out: LayoutNode[] = [];
  for (const child of children) {
    if (child.lifecycle.state === 'hidden' || child.lifecycle.state === 'destroyed') continue;
    out.push(nodeToLayoutNode(child));
  }
  return out;
}

/**
 * Run a LayoutStrategy against the visible children of `parentId`.
 * Returns a LayoutResult keyed by NodeId. State is opaque to this helper;
 * callers manage it (typically via a per-container state slot).
 */
export function runStrategyForContainer<TState>(
  store: Store,
  parentId: NodeId,
  viewport: Size,
  strategy: LayoutStrategy<TState, string, unknown>,
  state: TState,
): LayoutResult<NodeId, unknown> {
  const parent = store.getNode(parentId);
  const config = (parent?.container?.config ?? {}) as Record<string, unknown>;
  const children = store.getChildren(parentId);
  const items: LayoutItem[] = [];
  for (const child of children) {
    if (child.lifecycle.state === 'hidden' || child.lifecycle.state === 'destroyed') continue;
    items.push(nodeToLayoutItem(child));
  }
  const result = strategy.layout({
    items,
    container: viewport,
    state,
    options: config,
  });
  return result as LayoutResult<NodeId, unknown>;
}
