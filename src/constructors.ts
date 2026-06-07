import { createFocusMachine } from './machines/focus.js';
import { createLifecycleMachine } from './machines/lifecycle.js';
import { createTransitMachine } from './machines/transit.js';
import type { Node, NodeHints, NodeId } from './node.js';

export interface CreateZoneInput {
  id: NodeId;
  strategyId: string;
  config: unknown;
  allowsPinning?: boolean;
  allowsDrop?: boolean;
  allowsDragOut?: boolean;
  meta?: Record<string, unknown>;
  hints?: NodeHints;
  /** See `Node.order`. */
  order?: number;
}

export function createZone(input: CreateZoneInput): Node {
  const node: Node = {
    id: input.id,
    kind: 'zone',
    lifecycle: createLifecycleMachine(),
    container: {
      strategyId: input.strategyId,
      config: input.config,
      childOrder: [],
      allowsPinning: input.allowsPinning ?? true,
      allowsDrop: input.allowsDrop ?? true,
      allowsDragOut: input.allowsDragOut ?? true,
    },
  };
  if (input.meta !== undefined) node.meta = input.meta;
  if (input.hints !== undefined) node.hints = input.hints;
  if (input.order !== undefined) node.order = input.order;
  return node;
}

export interface CreateGroupInput {
  id: NodeId;
  parentId: NodeId;
  strategyId: string;
  config: unknown;
  allowsPinning?: boolean;
  allowsDrop?: boolean;
  allowsDragOut?: boolean;
  placement?: Record<string, unknown>;
  meta?: Record<string, unknown>;
  hints?: NodeHints;
  /** See `Node.order`. */
  order?: number;
}

export function createGroup(input: CreateGroupInput): Node {
  const node: Node = {
    id: input.id,
    kind: 'group',
    lifecycle: createLifecycleMachine(),
    container: {
      strategyId: input.strategyId,
      config: input.config,
      childOrder: [],
      allowsPinning: input.allowsPinning ?? true,
      allowsDrop: input.allowsDrop ?? true,
      allowsDragOut: input.allowsDragOut ?? true,
    },
    slot: {
      parentId: input.parentId,
      placement: input.placement ?? {},
      transit: createTransitMachine(),
    },
  };
  if (input.meta !== undefined) node.meta = input.meta;
  if (input.hints !== undefined) node.hints = input.hints;
  if (input.order !== undefined) node.order = input.order;
  return node;
}

export interface CreatePanelInput {
  id: NodeId;
  parentId: NodeId;
  placement?: Record<string, unknown>;
  meta?: Record<string, unknown>;
  hints?: NodeHints;
  /** See `Node.order`. */
  order?: number;
  container?: {
    strategyId: string;
    config: unknown;
    allowsPinning?: boolean;
    allowsDrop?: boolean;
    allowsDragOut?: boolean;
  };
}

export function createPanel(input: CreatePanelInput): Node {
  const node: Node = {
    id: input.id,
    kind: 'panel',
    lifecycle: createLifecycleMachine(),
    slot: {
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
      allowsDrop: input.container.allowsDrop ?? true,
      allowsDragOut: input.container.allowsDragOut ?? true,
    };
  }
  return node;
}
