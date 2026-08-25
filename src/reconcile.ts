import { type ChildSort, defaultChildSort } from './child-sort.js';
import type { NodeHints, NodeId } from './node.js';
import type { Store } from './store.js';
import { trace } from './trace.js';

/** A child as a binding observed it: its id, plus an optional sort key. */
export interface ObservedChild {
  id: NodeId;
  order: number | undefined;
}

/**
 * Whether a declared value may be written, and how.
 *
 * A lock stops *direct user manipulation*. A binding reconciling a declared
 * value is host code, not the user, so the rule is per field rather than per
 * axis, and it splits two ways:
 *
 * - **Skip** where a user gesture writes the same state (`childOrder`,
 *   `container.state`, `pinned`). Forcing a stale declared value past the lock
 *   would silently revert the arrangement the lock exists to protect.
 * - **Force** where the lock's own gesture is the only other writer
 *   (`placement.size` under `resize`). Nothing can be clobbered.
 *
 * These functions own that decision so a second binding cannot re-derive it
 * differently. A binding supplies only what it observed.
 */

/** Reconcile the generic `placement` bag. Forces: see the rule above. */
export function reconcilePlacement(
  store: Store,
  id: NodeId,
  placement: Record<string, unknown>,
): void {
  if ('pinned' in placement) {
    throw new Error(
      `windease: the generic \`placement\` prop cannot set "pinned" on "${id}" — use the dedicated \`pinned\` prop instead.`,
    );
  }
  store.patchPlacement(id, placement, { force: true });
}

/**
 * Reconcile a declared pin. Skips under the *parent's* arrange lock — pinning
 * rewrites the parent's `childOrder`, which a live drag also writes.
 */
export function reconcilePinned(store: Store, id: NodeId, pinned: number | boolean): void {
  const parentId = store.getNode(id)?.membership?.parentId;
  // A root has no childOrder to hold a slot in. Skip rather than throw: with
  // `parentId` usually arriving from context, one component renders both ways.
  if (parentId === undefined) {
    trace('layout', `pinned reconcile skipped for ${id}: no parent to hold a slot in`);
    return;
  }
  if (store.isLocked(parentId, 'arrange')) {
    trace('layout', `pinned reconcile skipped for ${id}: parent ${parentId} locked (arrange)`);
    return;
  }
  if (pinned === false) store.unpin(id);
  else store.setPinned(id, pinned === true ? undefined : pinned);
}

/** Reconcile declared layout hints. Forces: nothing but the binding writes
 *  hints, so there is no gesture to clobber. */
export function reconcileHints(store: Store, id: NodeId, hints: NodeHints): void {
  store.setHints(id, hints as Record<string, unknown>);
}

/**
 * Reconcile a declared container config against the one the last render
 * declared. Skips under the container's arrange lock.
 *
 * Diffed against `prev` rather than against the store, because the store's copy
 * also holds keys a gesture wrote — a stack's `activeId` moves on every tab
 * click, and re-asserting the declared config on the next render would snap the
 * tab back. A key `prev` declared and `next` drops is deleted, so the prop still
 * reads declaratively for the keys it names.
 */
export function reconcileContainerConfig(
  store: Store,
  id: NodeId,
  next: unknown,
  prev: unknown,
): void {
  if (sameConfig(next, prev)) return;
  if (store.isLocked(id, 'arrange')) {
    trace('layout', `config reconcile skipped for ${id}: locked (arrange)`);
    return;
  }
  store.updateContainerConfig(id, configPatch(next, prev));
}

/** The patch that takes `prev` to `next`: every key `next` names, plus
 *  `undefined` for one `prev` named and `next` dropped. */
function configPatch(next: unknown, prev: unknown): unknown {
  if (!isRecord(next)) return next;
  const patch: Record<string, unknown> = { ...next };
  if (isRecord(prev)) {
    for (const key of Object.keys(prev)) if (!(key in next)) patch[key] = undefined;
  }
  return patch;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Structural equality, so a config literal rebuilt each render with the same
 *  values does not rewrite the store and notify its way into a render loop. */
function sameConfig(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => sameConfig(v, b[i]));
  }
  if (!isRecord(a) || !isRecord(b)) return false;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((k) => k in b && sameConfig(a[k], b[k]));
}

/** Reconcile persisted strategy state. Skips under the container's arrange lock. */
export function reconcileContainerState(store: Store, id: NodeId, state: unknown): void {
  if (store.isLocked(id, 'arrange')) {
    trace('layout', `state reconcile skipped for ${id}: locked (arrange)`);
    return;
  }
  store.setContainerState(id, state);
}

/**
 * Merge the order a binding observed into the parent's `childOrder`, then
 * write it unless the container is arrange-locked.
 *
 * `observed` is whatever the binding saw — JSX children for React, DOM child
 * order for custom elements. Ids that are not currently children of `parentId`
 * are dropped; children the binding did not observe (registered imperatively)
 * keep their relative store order and fill in after the observed ones. Pinned
 * children are excluded from sorting entirely and hold their exact index.
 */
export function reconcileChildOrder(
  store: Store,
  parentId: NodeId,
  observed: readonly ObservedChild[],
  opts?: { sort?: ChildSort },
): void {
  const view = store.getContainerView(parentId);
  if (!view) return;
  const currentIds = view.childOrder;
  const currentSet = new Set(currentIds);
  const entries = observed.filter((e) => currentSet.has(e.id));
  const observedIds = new Set(entries.map((e) => e.id));
  const imperativeIds = currentIds.filter((cid) => !observedIds.has(cid));
  const pinnedIds = new Set(currentIds.filter((cid) => store.getPinnedIndex(cid) !== null));

  const sortFn = opts?.sort ?? defaultChildSort;
  const ordered = sortFn(
    entries.filter((e) => !pinnedIds.has(e.id)).map((e) => ({ id: e.id, order: e.order })),
    currentIds,
  );
  const fillQueue = [...ordered, ...imperativeIds.filter((cid) => !pinnedIds.has(cid))];
  let fillIndex = 0;
  // A permutation of currentIds: pinned ids keep their slot, fillQueue takes
  // the rest in order.
  const finalOrder = currentIds.map((cid) =>
    pinnedIds.has(cid) ? cid : (fillQueue[fillIndex++] as NodeId),
  );

  let same = finalOrder.length === currentIds.length;
  if (same) {
    for (let i = 0; i < finalOrder.length; i++) {
      if (finalOrder[i] !== currentIds[i]) {
        same = false;
        break;
      }
    }
  }
  if (same) return;
  if (store.isLocked(parentId, 'arrange')) {
    trace('layout', `sibling-order reconcile skipped for ${parentId}: locked (arrange)`);
    return;
  }
  store.setChildOrder(parentId, finalOrder);
}
