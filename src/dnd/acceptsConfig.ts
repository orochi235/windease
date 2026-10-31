import type { AcceptsConfig } from '../container-config.js';
import type { NodeId } from '../node.js';
import type { Store } from '../store.js';
import { trace } from '../trace.js';

/** What {@link acceptsConfigAdmits} judges one drop by. */
export interface AcceptsConfigInput {
  store: Store;
  targetId: NodeId;
  draggingId: NodeId;
  /** The target's `container.config.accepts`, unvalidated. */
  accepts: unknown;
  /** The source already sits in the target, so the drop adds no child. */
  withinParent: boolean;
  /** How many children the target would hold, built only if `max` asks. */
  prospectiveCount: () => number;
  tear: boolean;
}

/** Whether the target's `config.accepts` admits this drop. `max` counts the
 *  same list `canAccept` sees, so a drop that wraps a child adds nothing. */
export function acceptsConfigAdmits({
  store,
  targetId,
  draggingId,
  accepts,
  withinParent,
  prospectiveCount,
  tear,
}: AcceptsConfigInput): boolean {
  if (accepts === undefined || accepts === null) return true;
  if (accepts === false) {
    trace('dnd', `checkAccept ${targetId}: REJECT (accepts: false)`);
    return false;
  }
  if (accepts === 'tear') {
    if (!tear) trace('dnd', `checkAccept ${targetId}: REJECT (accepts: 'tear', not a tear)`);
    return tear;
  }
  if (typeof accepts !== 'object') return true;
  const { kinds, max } = accepts as Exclude<AcceptsConfig, false | 'tear'>;
  if (Array.isArray(kinds)) {
    const kind = store.getNode(draggingId)?.kind;
    if (kind === undefined || !kinds.includes(kind)) {
      trace(
        'dnd',
        `checkAccept ${targetId}: REJECT (accepts.kinds [${kinds.join(', ')}] has no '${kind ?? '(none)'}' for ${draggingId})`,
      );
      return false;
    }
  }
  if (typeof max === 'number' && !withinParent) {
    const count = prospectiveCount();
    if (count > max) {
      trace('dnd', `checkAccept ${targetId}: REJECT (accepts.max: ${count} > ${max})`);
      return false;
    }
  }
  return true;
}
