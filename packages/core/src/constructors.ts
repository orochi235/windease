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
  return {
    id: input.id,
    kind: 'zone',
    meta: input.meta,
    hints: input.hints,
    lifecycle: createLifecycleMachine(),
    container: {
      strategyId: input.strategyId,
      config: input.config,
      childIds: [],
      allowsPinning: input.allowsPinning ?? true,
    },
  };
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
  return {
    id: input.id,
    kind: 'group',
    meta: input.meta,
    hints: input.hints,
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
    meta: input.meta,
    hints: input.hints,
    lifecycle: createLifecycleMachine(),
    slot: {
      parentId: input.parentId,
      placement: input.placement ?? {},
      transit: createTransitMachine(),
    },
    focus: createFocusMachine(),
  };
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
