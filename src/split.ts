import { DuplicateNodeError, InvariantViolationError, NodeNotFoundError } from './errors.js';
import type { NodeId } from './node.js';
import type { SplitInput } from './split-types.js';
import type { Store } from './store.js';

export type SplitMode = 'wrap' | 'flatten' | 'reconfigure';

/** Total children the split produces, including the target. */
function totalChildren(input: SplitInput): number {
  if (input.direction === 'both') return input.into[0] * input.into[1];
  if (input.direction === 'grid') return input.into;
  return input.into ?? 2;
}

/** Every id this call will register. Group ids first, then the new panels. */
function mintedIds(input: SplitInput): NodeId[] {
  const groups = input.direction === 'both' ? [...input.groupIds] : [];
  return [...groups, ...input.newIds];
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

  const minted = mintedIds(input);
  const seen = new Set<NodeId>();
  for (const mid of minted) {
    if (seen.has(mid)) {
      throw new DuplicateNodeError(mid);
    }
    seen.add(mid);
    if (store.getNodeTruth(mid)) throw new DuplicateNodeError(mid);
  }

  const mode = resolveMode(store, id, input);

  // 'both' needs its column groups in every mode — at a root the outer entry is
  // ignored (the target is the outer container) but the columns are still built,
  // so the count is the same either way.
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

export function splitNode(store: Store, id: NodeId, input: SplitInput): void {
  validateSplit(store, id, input);
  throw new InvariantViolationError('split-unimplemented', 'split modes land in tasks 3-5', { id });
}
