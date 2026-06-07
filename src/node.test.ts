import { describe, expect, it } from 'vitest';
import { createFocusMachine } from './machines/focus.js';
import { createLifecycleMachine } from './machines/lifecycle.js';
import { createTransitMachine } from './machines/transit.js';
import { asNodeId, type Node, type NodeId } from './node.js';

describe('node identity', () => {
  it('asNodeId mints a branded NodeId from a string', () => {
    const id: NodeId = asNodeId('n1');
    expect(id).toBe('n1');
  });

  it('Node shape compiles with all capabilities present', () => {
    const node: Node = {
      id: asNodeId('p1'),
      kind: 'panel',
      lifecycle: createLifecycleMachine(),
      slot: {
        parentId: asNodeId('z1'),
        placement: {},
        transit: createTransitMachine(),
      },
      focus: createFocusMachine(),
      container: {
        strategyId: 'stack',
        config: {},
        childOrder: [],
        allowsPinning: true,
      },
    };
    expect(node.kind).toBe('panel');
    expect(node.lifecycle.state).toBe('mounted');
    expect(node.slot?.transit.state).toBe('idle');
    expect(node.focus?.state).toBe('blurred');
  });

  it('Node shape compiles with zone-minimal capabilities', () => {
    const node: Node = {
      id: asNodeId('z1'),
      kind: 'zone',
      lifecycle: createLifecycleMachine(),
      container: {
        strategyId: 'grid',
        config: {},
        childOrder: [],
        allowsPinning: true,
      },
    };
    expect(node.kind).toBe('zone');
    expect(node.slot).toBeUndefined();
    expect(node.focus).toBeUndefined();
  });
});
