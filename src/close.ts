import type { NodeId } from './node.js';
import type { Store } from './store.js';
import { trace } from './trace.js';

/**
 * Ask the host to close `id` by emitting `node.closeRequested`. The store
 * changes nothing: a listener answers by hiding, unregistering, or asking the
 * user first. Refused, and traced, when `id` is not a visible node or carries
 * `lock.destroy` or `lock.hide`, since the listener may answer either way.
 * Returns whether the request went out.
 *
 * @group Store
 */
export function requestClose(store: Store, id: NodeId): boolean {
  const node = store.getNode(id);
  if (node?.lifecycle.state !== 'visible') {
    trace('store', `close ${id}: refused (${node?.lifecycle.state ?? 'not registered'})`);
    return false;
  }
  for (const axis of ['destroy', 'hide'] as const) {
    if (store.isLocked(id, axis)) {
      trace('store', `close ${id}: refused (lock.${axis})`);
      return false;
    }
  }
  const parentId = node.membership?.parentId ?? null;
  trace('store', `close ${id}: requested (parent ${parentId ?? 'none'})`);
  store.events.emit('node.closeRequested', { id, parentId });
  return true;
}
