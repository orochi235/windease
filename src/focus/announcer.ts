import type { NodeId } from '../node.js';
import type { Store } from '../store.js';
import { trace } from '../trace.js';
import { accessibleName } from './name.js';
import type { FocusAdapter } from './types.js';

const DEPARTURE: Record<'destroyed' | 'hidden' | 'moved', string> = {
  destroyed: 'closed',
  hidden: 'hidden',
  moved: 'moved',
};

function isFocusInside(store: Store, id: NodeId): boolean {
  let cursor: NodeId | null | undefined = store.focusedId;
  while (cursor) {
    if (cursor === id) return true;
    cursor = store.getNode(cursor)?.membership?.parentId ?? null;
  }
  return false;
}

function positionIn(store: Store, parentId: NodeId, id: NodeId): string {
  const order = store.getNode(parentId)?.container?.childOrder ?? [];
  return `position ${order.indexOf(id) + 1} of ${order.length}`;
}

/**
 * Speaks the structural changes that move no focus, through the adapter's
 * `announce`. A change that does move focus needs nothing here: presenting
 * focus on the new node announces its name.
 *
 * Covers the focused node departing (destroy, hide) and the focused subtree
 * being relocated or reordered. Everything else is silent — a host that moves
 * thirty nodes the user is not in should not narrate thirty times.
 *
 * Returns an unsubscribe.
 */
export function bindAnnouncer(store: Store, adapter: FocusAdapter): () => void {
  const say = (text: string) => {
    trace('store', `announce: ${text}`);
    adapter.announce(text);
  };

  // The departing node is still registered when `focus.successor` fires, so its
  // name must be read synchronously here — a deferred listener sees nothing.
  const offSuccessor = store.events.on('focus.successor', ({ from, to, reason }) => {
    const what = `${accessibleName(store, from)} ${DEPARTURE[reason]}`;
    say(to ? what : `${what}. Nothing left to focus`);
  });

  const offMoved = store.events.on('node.moved', ({ id, toParentId }) => {
    if (!isFocusInside(store, id)) return;
    const where = `${accessibleName(store, toParentId)}, ${positionIn(store, toParentId, id)}`;
    say(`${accessibleName(store, id)} moved to ${where}`);
  });

  const offReordered = store.events.on('node.reordered', ({ id, parentId }) => {
    if (!isFocusInside(store, id)) return;
    say(`${accessibleName(store, id)} moved to ${positionIn(store, parentId, id)}`);
  });

  return () => {
    offSuccessor();
    offMoved();
    offReordered();
  };
}
