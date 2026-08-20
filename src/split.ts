import { createGroup, createPanel } from './constructors.js';
import {
  DuplicateNodeError,
  InvariantViolationError,
  LockedError,
  NodeNotFoundError,
} from './errors.js';
import type { NodeId } from './node.js';
import type { SplitInput } from './split-types.js';
import type { Store } from './store.js';
import { trace } from './trace.js';

export type SplitMode = 'wrap' | 'flatten' | 'reconfigure';

/** Total children the split produces, including the target. */
function totalChildren(input: SplitInput): number {
  if (input.direction === 'both') return input.into[0] * input.into[1];
  if (input.direction === 'grid') return input.into;
  return input.into ?? 2;
}

/** Ids this call will actually register, which depends on the mode: a
 *  `groupId` is unused when flattening or reconfiguring. */
function mintedIds(input: SplitInput, mode: SplitMode): NodeId[] {
  if (input.direction === 'both') {
    const groups = mode === 'reconfigure' ? input.groupIds.slice(1) : [...input.groupIds];
    return [...groups, ...input.newIds];
  }
  const group = mode === 'wrap' && input.groupId ? [input.groupId] : [];
  return [...group, ...input.newIds];
}

export function resolveMode(store: Store, id: NodeId, input: SplitInput): SplitMode {
  const node = store.getNodeTruth(id);
  if (!node?.membership) return 'reconfigure';
  if (input.direction === 'x' || input.direction === 'y') {
    const parent = store.getNodeTruth(node.membership.parentId);
    const cfg = parent?.container?.config as { axis?: string } | undefined;
    if (parent?.container?.strategyId === 'strip' && (cfg?.axis ?? 'x') === input.direction) {
      return 'flatten';
    }
  }
  return 'wrap';
}

export function validateSplit(store: Store, id: NodeId, input: SplitInput): SplitMode {
  if (!store.getNodeTruth(id)) {
    throw new NodeNotFoundError(id);
  }

  const mode = resolveMode(store, id, input);

  const total = totalChildren(input);
  if (input.direction === 'both') {
    const [cols, rows] = input.into;
    if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 1 || rows < 1) {
      throw new InvariantViolationError(
        'split-arity',
        `into must be two positive integers, got [${cols}, ${rows}]`,
        { into: input.into },
      );
    }
  }
  if (total < 2 || !Number.isInteger(total)) {
    throw new InvariantViolationError(
      'split-arity',
      `into must produce at least 2 children, got ${total}`,
      { into: input.into },
    );
  }
  if (input.newIds.length !== total - 1) {
    throw new InvariantViolationError(
      'split-arity',
      `newIds must have ${total - 1} entries for a split into ${total}, got ${input.newIds.length}`,
      { expected: total - 1, actual: input.newIds.length },
    );
  }

  const minted = mintedIds(input, mode);
  const seen = new Set<NodeId>();
  for (const mid of minted) {
    if (seen.has(mid)) {
      throw new DuplicateNodeError(mid);
    }
    seen.add(mid);
    if (store.getNodeTruth(mid)) throw new DuplicateNodeError(mid);
  }

  // 'both' needs its column groups validated in every mode, not only wrap.
  if (input.direction === 'both') {
    const needed = 1 + input.into[0];
    if (input.groupIds.length !== needed) {
      throw new InvariantViolationError(
        'split-missing-group-id',
        `direction 'both' into [${input.into[0]}, ${input.into[1]}] needs ${needed} groupIds, got ${input.groupIds.length}`,
        { expected: needed, actual: input.groupIds.length },
      );
    }
  } else if (mode === 'wrap' && !input.groupId) {
    throw new InvariantViolationError(
      'split-missing-group-id',
      `split of ${id} wraps it in a new group and needs a groupId`,
      { id },
    );
  }
  return mode;
}

/** Strip config for an axis, with the caller's config merged over it. */
function stripConfig(axis: 'x' | 'y', extra?: Record<string, unknown>): Record<string, unknown> {
  return { axis, ...extra };
}

/** Lock axes `split` enforces itself. Internal calls then run suspended, so a
 *  guard on a public method cannot fire partway and leave a half-built tree. */
function assertSplitUnlocked(store: Store, id: NodeId, mode: SplitMode, force: boolean): void {
  if (force) return;
  const node = store.getNodeTruth(id);
  const check = (target: NodeId, axis: 'move' | 'arrange' | 'dragOut') => {
    if (store.isLocked(target, axis)) {
      throw new LockedError(target, axis, 'split');
    }
  };
  if (mode === 'reconfigure') {
    check(id, 'arrange');
    return;
  }
  const parentId = node?.membership?.parentId;
  if (!parentId) return;
  if (mode === 'flatten') {
    check(parentId, 'arrange');
    return;
  }
  check(id, 'move');
  check(parentId, 'dragOut');
  check(parentId, 'arrange');
}

export function splitNode(store: Store, id: NodeId, input: SplitInput): void {
  const mode = validateSplit(store, id, input);
  assertSplitUnlocked(store, id, mode, input.force === true);

  store.transact(() => {
    store.withLocksSuspended(() => {
      if (mode === 'flatten') {
        applyFlatten(store, id, input);
      } else if (mode === 'wrap') {
        applyWrap(store, id, input);
      } else {
        applyReconfigure(store, id, input);
      }
    });
  }, 'split');
}

function applyFlatten(store: Store, id: NodeId, input: SplitInput): void {
  const node = store.getNodeTruth(id);
  const parentId = node?.membership?.parentId;
  if (!parentId) return;
  const order = store.getContainerView(parentId)?.childOrder ?? [];
  let at = order.indexOf(id);
  for (const newId of input.newIds) {
    at += 1;
    store.registerNode(createPanel({ id: newId, parentId }));
    store.reorderInParent(newId, at);
  }
  trace(
    'store',
    `split: flatten ${id} → ${parentId}@${order.indexOf(id)} (+${input.newIds.length})`,
  );
}

function applyWrap(store: Store, id: NodeId, input: SplitInput): void {
  if (input.direction === 'both' || input.direction === 'grid') {
    throw new InvariantViolationError('split-unimplemented', 'both/grid land in tasks 4-5', { id });
  }
  const node = store.getNodeTruth(id);
  const parentId = node?.membership?.parentId;
  const groupId = input.groupId;
  if (!parentId || !groupId) return;

  const order = store.getContainerView(parentId)?.childOrder ?? [];
  const at = order.indexOf(id);
  const placement = { ...(node?.membership?.placement ?? {}) };
  const pinned = store.getPinnedIndex(id);
  delete placement.pinned;

  store.registerNode(
    createGroup({
      id: groupId,
      parentId,
      strategyId: 'strip',
      config: stripConfig(input.direction, input.config),
      placement,
    }),
  );
  store.reorderInParent(groupId, at);
  store.moveNode(id, groupId, 0);
  store.patchPlacement(id, { size: undefined });
  store.unpin(id);
  for (const newId of input.newIds) {
    store.registerNode(createPanel({ id: newId, parentId: groupId }));
  }
  if (pinned !== null) store.setPinned(groupId, pinned);

  trace(
    'store',
    `split: wrap ${id} → ${groupId}@${at} (strip ${input.direction}, ${input.newIds.length + 1} children)`,
  );
}

function applyReconfigure(_store: Store, id: NodeId, _input: SplitInput): void {
  throw new InvariantViolationError(
    'split-unimplemented',
    'split-unimplemented: reconfigure lands in task 4',
    { id },
  );
}
