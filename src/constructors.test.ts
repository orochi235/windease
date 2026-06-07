import { describe, expect, it } from 'vitest';
import { createGroup, createPanel, createZone } from './constructors.js';
import { asNodeId } from './node.js';

describe('createZone', () => {
  it('produces a zone-kind node with container only', () => {
    const node = createZone({
      id: asNodeId('z1'),
      strategyId: 'grid',
      config: { cols: 3 },
    });
    expect(node.kind).toBe('zone');
    expect(node.container).toBeDefined();
    expect(node.container?.strategyId).toBe('grid');
    expect(node.container?.config).toEqual({ cols: 3 });
    expect(node.container?.childOrder).toEqual([]);
    expect(node.container?.allowsPinning).toBe(true);
    expect(node.slot).toBeUndefined();
    expect(node.focus).toBeUndefined();
    expect(node.lifecycle.state).toBe('mounted');
  });

  it('honors allowsPinning: false', () => {
    const node = createZone({
      id: asNodeId('z2'),
      strategyId: 'stack',
      config: {},
      allowsPinning: false,
    });
    expect(node.container?.allowsPinning).toBe(false);
  });

  it('carries meta and hints when provided', () => {
    const node = createZone({
      id: asNodeId('z3'),
      strategyId: 'grid',
      config: {},
      meta: { label: 'main' },
      hints: { preferredSize: { w: 800, h: 600 } },
    });
    expect(node.meta).toEqual({ label: 'main' });
    expect(node.hints?.preferredSize).toEqual({ w: 800, h: 600 });
  });

});

describe('createGroup', () => {
  it('produces a group-kind node with container + slot', () => {
    const node = createGroup({
      id: asNodeId('g1'),
      parentId: asNodeId('z1'),
      strategyId: 'stack',
      config: { axis: 'vertical' },
    });
    expect(node.kind).toBe('group');
    expect(node.container).toBeDefined();
    expect(node.container?.strategyId).toBe('stack');
    expect(node.slot).toBeDefined();
    expect(node.slot?.parentId).toBe('z1');
    expect(node.slot?.placement).toEqual({});
    expect(node.slot?.transit.state).toBe('idle');
    expect(node.focus).toBeUndefined();
    expect(node.lifecycle.state).toBe('mounted');
  });

  it('honors allowsPinning and placement', () => {
    const node = createGroup({
      id: asNodeId('g2'),
      parentId: asNodeId('z1'),
      strategyId: 'strip',
      config: {},
      allowsPinning: false,
      placement: { pinned: true },
    });
    expect(node.container?.allowsPinning).toBe(false);
    expect(node.slot?.placement).toEqual({ pinned: true });
  });

});

describe('createPanel', () => {
  it('produces a leaf panel (no container)', () => {
    const node = createPanel({
      id: asNodeId('p1'),
      parentId: asNodeId('z1'),
    });
    expect(node.kind).toBe('panel');
    expect(node.slot).toBeDefined();
    expect(node.slot?.parentId).toBe('z1');
    expect(node.focus).toBeDefined();
    expect(node.focus?.state).toBe('blurred');
    expect(node.container).toBeUndefined();
    expect(node.lifecycle.state).toBe('mounted');
  });

  it('produces a recursive panel when container is provided', () => {
    const node = createPanel({
      id: asNodeId('p2'),
      parentId: asNodeId('z1'),
      container: { strategyId: 'stack', config: { axis: 'vertical' } },
    });
    expect(node.container).toBeDefined();
    expect(node.container?.strategyId).toBe('stack');
    expect(node.container?.childOrder).toEqual([]);
    expect(node.container?.allowsPinning).toBe(true);
  });

  it('honors container.allowsPinning override', () => {
    const node = createPanel({
      id: asNodeId('p3'),
      parentId: asNodeId('z1'),
      container: { strategyId: 'stack', config: {}, allowsPinning: false },
    });
    expect(node.container?.allowsPinning).toBe(false);
  });

  it('carries meta, hints, placement', () => {
    const node = createPanel({
      id: asNodeId('p4'),
      parentId: asNodeId('z1'),
      meta: { title: 'Editor' },
      hints: { minSize: { w: 200, h: 100 } },
      placement: { locked: true },
    });
    expect(node.meta).toEqual({ title: 'Editor' });
    expect(node.hints?.minSize).toEqual({ w: 200, h: 100 });
    expect(node.slot?.placement).toEqual({ locked: true });
  });

});

describe('node factories — order', () => {
  it('round-trips an explicit order on createPanel', () => {
    const n = createPanel({
      id: asNodeId('a'),
      parentId: asNodeId('root'),
      order: 7,
    });
    expect(n.order).toBe(7);
  });

  it('round-trips on createGroup and createZone', () => {
    const g = createGroup({
      id: asNodeId('g'),
      parentId: asNodeId('root'),
      strategyId: 'stack',
      config: {},
      order: 3,
    });
    const z = createZone({
      id: asNodeId('z'),
      strategyId: 'grid',
      config: {},
      order: 1,
    });
    expect(g.order).toBe(3);
    expect(z.order).toBe(1);
  });

  it('leaves order undefined when not provided', () => {
    expect(
      createPanel({ id: asNodeId('a'), parentId: asNodeId('root') }).order,
    ).toBeUndefined();
  });
});
