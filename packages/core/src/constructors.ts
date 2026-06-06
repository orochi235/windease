import { createFocusMachine } from './machines/focus.js';
import { createLifecycleMachine } from './machines/lifecycle.js';
import { createTransitMachine } from './machines/transit.js';
import type { Node, NodeHints, NodeId } from './node.js';

export interface CreateZoneInput {
  id: NodeId;
  strategyId: string;
  config: unknown;
  allowsPinning?: boolean;
  meta?: Record<string, unknown>;
  hints?: NodeHints;
}

export function createZone(input: CreateZoneInput): Node {
  const node: Node = {
    id: input.id,
    kind: 'zone',
    lifecycle: createLifecycleMachine(),
    container: {
      strategyId: input.strategyId,
      config: input.config,
      childIds: [],
      allowsPinning: input.allowsPinning ?? true,
    },
  };
  if (input.meta !== undefined) node.meta = input.meta;
  if (input.hints !== undefined) node.hints = input.hints;
  return node;
}

export interface CreateGroupInput {
  id: NodeId;
  parentId: NodeId;
  strategyId: string;
  config: unknown;
  allowsPinning?: boolean;
  placement?: Record<string, unknown>;
  meta?: Record<string, unknown>;
  hints?: NodeHints;
}

export function createGroup(input: CreateGroupInput): Node {
  const node: Node = {
    id: input.id,
    kind: 'group',
    lifecycle: createLifecycleMachine(),
    container: {
      strategyId: input.strategyId,
      config: input.config,
      childIds: [],
      allowsPinning: input.allowsPinning ?? true,
    },
    slot: {
      parentId: input.parentId,
      placement: input.placement ?? {},
      transit: createTransitMachine(),
    },
  };
  if (input.meta !== undefined) node.meta = input.meta;
  if (input.hints !== undefined) node.hints = input.hints;
  return node;
}

export interface CreatePanelInput {
  id: NodeId;
  parentId: NodeId;
  placement?: Record<string, unknown>;
  meta?: Record<string, unknown>;
  hints?: NodeHints;
  container?: {
    strategyId: string;
    config: unknown;
    allowsPinning?: boolean;
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
  if (input.container) {
    node.container = {
      strategyId: input.container.strategyId,
      config: input.container.config,
      childIds: [],
      allowsPinning: input.container.allowsPinning ?? true,
    };
  }
  return node;
}
