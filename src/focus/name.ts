import type { NodeId } from '../node.js';
import type { Store } from '../store.js';

/**
 * The node's accessible name. `meta.title` is the reserved key for it; without
 * one, the node's kind plus its one-based position among siblings, and failing
 * that its id.
 */
export function accessibleName(store: Store, id: NodeId): string {
  const node = store.getNode(id);
  if (!node) return String(id);
  const title = node.meta?.title;
  if (typeof title === 'string' && title.length > 0) return title;
  if (!node.kind) return String(id);
  const parentId = node.membership?.parentId;
  const order = parentId ? (store.getNode(parentId)?.container?.childOrder ?? []) : store.rootIds;
  const at = order.indexOf(id);
  return at >= 0 ? `${node.kind} ${at + 1}` : String(node.kind);
}
