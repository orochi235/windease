import { describe, expect, it } from 'vitest';
import { KindShapeError } from './errors.js';
import { createFocusMachine } from './machines/focus.js';
import { createLifecycleMachine } from './machines/lifecycle.js';
import { createTransitMachine } from './machines/transit.js';
import { asNodeId, type Node } from './node.js';
import { validateKindShape } from './validators.js';

function panel(id = 'p1', parent = 'z1'): Node {
  return {
    id: asNodeId(id),
    kind: 'panel',
    lifecycle: createLifecycleMachine(),
    slot: {
      parentId: asNodeId(parent),
      placement: {},
      transit: createTransitMachine(),
    },
    focus: createFocusMachine(),
  };
}

function group(id = 'g1', parent = 'z1'): Node {
  return {
    id: asNodeId(id),
    kind: 'group',
    lifecycle: createLifecycleMachine(),
    container: { strategyId: 'stack', config: {}, childIds: [], allowsPinning: true },
    slot: {
      parentId: asNodeId(parent),
      placement: {},
      transit: createTransitMachine(),
    },
  };
}

function zone(id = 'z1'): Node {
  return {
    id: asNodeId(id),
    kind: 'zone',
    lifecycle: createLifecycleMachine(),
    container: { strategyId: 'grid', config: {}, childIds: [], allowsPinning: true },
  };
}

describe('validateKindShape', () => {
  it('accepts a well-formed panel (with and without container)', () => {
    expect(() => validateKindShape(panel())).not.toThrow();
    const recursive = panel();
    recursive.container = { strategyId: 'stack', config: {}, childIds: [], allowsPinning: true };
    expect(() => validateKindShape(recursive)).not.toThrow();
  });

  it('accepts a well-formed group', () => {
    expect(() => validateKindShape(group())).not.toThrow();
  });

  it('accepts a well-formed zone', () => {
    expect(() => validateKindShape(zone())).not.toThrow();
  });

  it('rejects a panel missing slot', () => {
    const n = panel();
    delete (n as { slot?: unknown }).slot;
    expect(() => validateKindShape(n)).toThrow(KindShapeError);
  });

  it('rejects a panel missing focus', () => {
    const n = panel();
    delete (n as { focus?: unknown }).focus;
    expect(() => validateKindShape(n)).toThrow(KindShapeError);
  });

  it('rejects a group with focus', () => {
    const n = group();
    n.focus = createFocusMachine();
    expect(() => validateKindShape(n)).toThrow(KindShapeError);
  });

  it('rejects a group missing container', () => {
    const n = group();
    delete (n as { container?: unknown }).container;
    expect(() => validateKindShape(n)).toThrow(KindShapeError);
  });

  it('rejects a group missing slot', () => {
    const n = group();
    delete (n as { slot?: unknown }).slot;
    expect(() => validateKindShape(n)).toThrow(KindShapeError);
  });

  it('rejects a zone with slot', () => {
    const n = zone();
    n.slot = {
      parentId: asNodeId('x'),
      placement: {},
      transit: createTransitMachine(),
    };
    expect(() => validateKindShape(n)).toThrow(KindShapeError);
  });

  it('rejects a zone with focus', () => {
    const n = zone();
    n.focus = createFocusMachine();
    expect(() => validateKindShape(n)).toThrow(KindShapeError);
  });

  it('rejects a zone missing container', () => {
    const n = zone();
    delete (n as { container?: unknown }).container;
    expect(() => validateKindShape(n)).toThrow(KindShapeError);
  });
});
