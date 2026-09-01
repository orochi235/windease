import { type LockSet, resolveLock } from './lock.js';
import { createFocusMachine } from './machines/focus.js';
import { createLifecycleMachine } from './machines/lifecycle.js';
import { createTransitMachine } from './machines/transit.js';
import type { Node, NodeHints, NodeId } from './node.js';

/**
 * Input to {@link createNode}. Which capabilities the node ends up with is
 * decided here and is fixed for its lifetime: `parentId` grants `membership`,
 * `container` grants `container`, `focus` grants `focus`.
 */
export interface CreateNodeInput {
  id: NodeId;
  /** Free-form label. Drives the React ChromeMap and CSS classes only; core never reads it. */
  kind?: string | undefined;
  /** Omit for a root. Present → the node gains `membership`. */
  parentId?: NodeId | undefined;
  /** Omit for a leaf. Present → the node gains `container`. */
  container?:
    | {
        strategyId: string;
        config: unknown;
        allowsPinning?: boolean | undefined;
      }
    | undefined;
  /** Give the node a focus machine. */
  focus?: boolean | undefined;
  placement?: Record<string, unknown> | undefined;
  meta?: Record<string, unknown> | undefined;
  hints?: NodeHints | undefined;
  /** See `Node.order`. */
  order?: number | undefined;
  lock?: boolean | LockSet | undefined;
}

/**
 * Build a `Node`. The only supported way to make one — the capability machines
 * are constructed here, so an object literal shaped like a `Node` will not
 * work.
 *
 * Creating a node does not add it to a store; pass the result to
 * `store.registerNode`.
 * @group Constructors
 */
export function createNode(input: CreateNodeInput): Node {
  const node: Node = {
    id: input.id,
    lifecycle: createLifecycleMachine(),
  };
  if (input.kind !== undefined) node.kind = input.kind;
  if (input.parentId !== undefined) {
    node.membership = {
      parentId: input.parentId,
      placement: input.placement ?? {},
      transit: createTransitMachine(),
    };
  }
  if (input.container) {
    node.container = {
      strategyId: input.container.strategyId,
      config: input.container.config,
      childOrder: [],
      allowsPinning: input.container.allowsPinning ?? true,
    };
  }
  if (input.focus) node.focus = createFocusMachine();
  if (input.meta !== undefined) node.meta = input.meta;
  if (input.hints !== undefined) node.hints = input.hints;
  if (input.order !== undefined) node.order = input.order;
  if (input.lock !== undefined) {
    const resolved = resolveLock(node, input.lock);
    if (Object.keys(resolved).length > 0) node.lock = resolved;
  }
  return node;
}
