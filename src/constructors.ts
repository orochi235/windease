import { type LockSet, resolveLock } from './lock.js';
import { createFocusMachine } from './machines/focus.js';
import { createLifecycleMachine } from './machines/lifecycle.js';
import { createTransitMachine } from './machines/transit.js';
import type { Node, NodeHints, NodeId } from './node.js';

export interface CreateZoneInput {
  id: NodeId;
  strategyId: string;
  config: unknown;
  /** Omit for a root. With a parent, the node gains `membership`. */
  parentId?: NodeId | undefined;
  placement?: Record<string, unknown> | undefined;
  allowsPinning?: boolean | undefined;
  lock?: boolean | LockSet | undefined;
  meta?: Record<string, unknown> | undefined;
  hints?: NodeHints | undefined;
  /** See `Node.order`. */
  order?: number | undefined;
}

function createContainerNode(input: CreateZoneInput, kind: string): Node {
  const node: Node = {
    id: input.id,
    kind,
    lifecycle: createLifecycleMachine(),
    container: {
      strategyId: input.strategyId,
      config: input.config,
      childOrder: [],
      allowsPinning: input.allowsPinning ?? true,
    },
  };
  if (input.parentId !== undefined) {
    node.membership = {
      parentId: input.parentId,
      placement: input.placement ?? {},
      transit: createTransitMachine(),
    };
  }
  if (input.meta !== undefined) node.meta = input.meta;
  if (input.hints !== undefined) node.hints = input.hints;
  if (input.order !== undefined) node.order = input.order;
  if (input.lock !== undefined) {
    const resolved = resolveLock(node, input.lock);
    if (Object.keys(resolved).length > 0) node.lock = resolved;
  }
  return node;
}

/** @group Constructors */
export function createZone(input: CreateZoneInput): Node {
  return createContainerNode(input, 'zone');
}

export interface CreatePanelInput {
  id: NodeId;
  parentId: NodeId;
  placement?: Record<string, unknown> | undefined;
  meta?: Record<string, unknown> | undefined;
  hints?: NodeHints | undefined;
  /** See `Node.order`. */
  order?: number | undefined;
  lock?: boolean | LockSet | undefined;
  container?:
    | {
        strategyId: string;
        config: unknown;
        allowsPinning?: boolean | undefined;
      }
    | undefined;
}

/** @group Constructors */
export function createPanel(input: CreatePanelInput): Node {
  const node: Node = {
    id: input.id,
    kind: 'panel',
    lifecycle: createLifecycleMachine(),
    membership: {
      parentId: input.parentId,
      placement: input.placement ?? {},
      transit: createTransitMachine(),
    },
    focus: createFocusMachine(),
  };
  if (input.meta !== undefined) node.meta = input.meta;
  if (input.hints !== undefined) node.hints = input.hints;
  if (input.order !== undefined) node.order = input.order;
  if (input.container) {
    node.container = {
      strategyId: input.container.strategyId,
      config: input.container.config,
      childOrder: [],
      allowsPinning: input.container.allowsPinning ?? true,
    };
  }
  if (input.lock !== undefined) {
    const resolved = resolveLock(node, input.lock);
    if (Object.keys(resolved).length > 0) node.lock = resolved;
  }
  return node;
}
