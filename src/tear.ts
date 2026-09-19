import {
  CapabilityMissingError,
  CycleError,
  InvariantViolationError,
  LockedError,
} from './errors.js';
import { nodeToLayoutItem } from './layout-node-adapter.js';
import type { LayoutItem, LayoutStrategy, Size } from './layout-types.js';
import type { NodeId } from './node.js';
import type { MutateOptions, Store } from './store.js';
import { trace } from './trace.js';

type AnyStrategy = LayoutStrategy<unknown, string, unknown>;

/** A container's strategy state as its layout would see it: persisted, or seeded. */
export function containerStateFor(store: Store, parentId: NodeId, strategy: AnyStrategy): unknown {
  const persisted = store.getContainerState(parentId);
  if (persisted !== undefined) return persisted;
  const parent = store.getNodeTruth(parentId);
  const items: LayoutItem[] = store
    .getChildren(parentId)
    .filter((c) => c.lifecycle.state === 'visible')
    .map(nodeToLayoutItem);
  return strategy.initialState?.(
    items,
    (parent?.container?.config ?? {}) as Record<string, unknown>,
  );
}

/**
 * The nearest container above `id` whose strategy floats children, or null.
 * `id` itself is not considered.
 */
export function floatAncestor(
  store: Store,
  getStrategy: (strategyId: string) => AnyStrategy | undefined,
  id: NodeId,
): NodeId | null {
  let cursor = store.getNodeTruth(id)?.membership?.parentId;
  while (cursor !== undefined) {
    const node = store.getNodeTruth(cursor);
    const strategyId = node?.container?.strategyId;
    if (strategyId && getStrategy(strategyId)?.float) return cursor;
    cursor = node?.membership?.parentId;
  }
  return null;
}

/** Where a floated child goes and how big it is. */
export interface FloatInput {
  /** Top-left corner, relative to the container. */
  at: { x: number; y: number };
  /** Written to `hints.preferredSize`, which both floating and desktop read. */
  size?: Size;
}

/**
 * Move `id` into `parentId` as a floating child with its top-left corner at
 * `at`. `strategy` is `parentId`'s, and must carry a `float` hook: that hook
 * decides where the position lives (placement `x`/`y` for desktop, container
 * state for floating).
 *
 * Validates before it mutates, then runs as one transaction, so a history
 * bracketed on `transaction.begin` / `end` records one undo step.
 */
export function floatNode(
  store: Store,
  strategy: AnyStrategy,
  id: NodeId,
  parentId: NodeId,
  input: FloatInput,
  opts?: MutateOptions,
): void {
  const node = store.getNodeTruth(id);
  if (!node?.membership) throw new CapabilityMissingError(id, 'membership', 'floatNode');
  const parent = store.getNodeTruth(parentId);
  if (!parent?.container) throw new CapabilityMissingError(parentId, 'container', 'floatNode');
  const hook = strategy.float;
  if (!hook) {
    throw new InvariantViolationError(
      'strategy-cannot-float',
      `strategy ${strategy.name} of ${parentId} does not float children`,
      { id, parentId },
    );
  }
  if (id === parentId || store.getAncestors(parentId).some((a) => a.id === id)) {
    throw new CycleError(id, parentId);
  }
  if (opts?.force !== true) {
    const guards: [NodeId, 'move' | 'accept' | 'dragOut' | 'arrange'][] = [
      [id, 'move'],
      [parentId, 'accept'],
      [parentId, 'arrange'],
      [node.membership.parentId, 'dragOut'],
    ];
    for (const [gid, axis] of guards) {
      if (store.isLocked(gid, axis)) throw new LockedError(gid, axis, 'floatNode');
    }
  }

  const options = (parent.container.config ?? {}) as Record<string, unknown>;
  const state = containerStateFor(store, parentId, strategy);
  const placed = hook.place({ id, at: input.at, state, options });

  store.transact(() => {
    if (input.size) store.setHints(id, { preferredSize: input.size });
    store.patchPlacement(id, placed.placement, opts);
    if (placed.state !== undefined) store.setContainerState(parentId, placed.state, opts);
    store.moveNode(id, parentId, undefined, opts);
  }, 'floatNode');
  trace(
    'store',
    `float: ${id} → ${parentId} at (${input.at.x}, ${input.at.y})${input.size ? ` ${input.size.w}x${input.size.h}` : ''}`,
  );
}

/**
 * Move a floating child into a stack as a tab, clearing the placement keys its
 * current parent's `float` hook wrote. `from` is that parent's strategy; absent,
 * nothing is cleared and this is a plain `moveNode`.
 */
export function dockNode(
  store: Store,
  id: NodeId,
  stackId: NodeId,
  input: { at?: number; from?: AnyStrategy } = {},
  opts?: MutateOptions,
): void {
  const keys = input.from?.float?.keys ?? [];
  const placement = store.getNodeTruth(id)?.membership?.placement ?? {};
  const clear: Record<string, undefined> = {};
  for (const k of keys) if (k in placement) clear[k] = undefined;
  store.transact(() => {
    store.moveNode(id, stackId, input.at, opts);
    if (Object.keys(clear).length > 0) store.patchPlacement(id, clear, opts);
  }, 'dockNode');
  trace(
    'store',
    `dock: ${id} → ${stackId}@${input.at ?? 'append'} (cleared ${keys.join(', ') || 'nothing'})`,
  );
}
