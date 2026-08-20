import { describe, expect, it } from 'vitest';
import { createPanel, createZone } from './constructors.js';
import { asNodeId } from './node.js';
import { Store } from './store.js';

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
    expect(node.membership).toBeUndefined();
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

  it('resolves lock at construction, filtering to supported axes', () => {
    const node = createZone({
      id: asNodeId('z-lock'),
      strategyId: 'grid',
      config: {},
      lock: { accept: true, move: true },
    });
    expect(node.lock).toEqual({ accept: true });
  });

  it('omits lock when the resolved set is empty', () => {
    const node = createZone({
      id: asNodeId('z-nolock'),
      strategyId: 'grid',
      config: {},
      lock: false,
    });
    expect(node.lock).toBeUndefined();
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

describe('createZone with a parentId — full capability shape', () => {
  it('produces a zone-kind node with container + membership', () => {
    const node = createZone({
      id: asNodeId('g1'),
      parentId: asNodeId('z1'),
      strategyId: 'stack',
      config: { axis: 'vertical' },
    });
    expect(node.kind).toBe('zone');
    expect(node.container).toBeDefined();
    expect(node.container?.strategyId).toBe('stack');
    expect(node.membership).toBeDefined();
    expect(node.membership?.parentId).toBe('z1');
    expect(node.membership?.placement).toEqual({});
    expect(node.membership?.transit.state).toBe('idle');
    expect(node.focus).toBeUndefined();
    expect(node.lifecycle.state).toBe('mounted');
  });

  it('honors allowsPinning and placement', () => {
    const node = createZone({
      id: asNodeId('g2'),
      parentId: asNodeId('z1'),
      strategyId: 'strip',
      config: {},
      allowsPinning: false,
      placement: { pinned: true },
    });
    expect(node.container?.allowsPinning).toBe(false);
    expect(node.membership?.placement).toEqual({ pinned: true });
  });

  it('resolves lock using the full container + membership shape', () => {
    const node = createZone({
      id: asNodeId('g-lock'),
      parentId: asNodeId('z1'),
      strategyId: 'stack',
      config: {},
      lock: true,
    });
    expect(node.lock).toEqual({
      move: true,
      resize: true,
      destroy: true,
      accept: true,
      dragOut: true,
      arrange: true,
    });
  });
});

describe('createPanel', () => {
  it('produces a leaf panel (no container)', () => {
    const node = createPanel({
      id: asNodeId('p1'),
      parentId: asNodeId('z1'),
    });
    expect(node.kind).toBe('panel');
    expect(node.membership).toBeDefined();
    expect(node.membership?.parentId).toBe('z1');
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
    expect(node.membership?.placement).toEqual({ locked: true });
  });

  it('resolves a top-level lock on a childless panel', () => {
    const node = createPanel({
      id: asNodeId('p5'),
      parentId: asNodeId('z1'),
      lock: { move: true, arrange: true },
    });
    expect(node.container).toBeUndefined();
    expect(node.lock).toEqual({ move: true });
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

  it('round-trips on createZone, parented and root', () => {
    const g = createZone({
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
    expect(createPanel({ id: asNodeId('a'), parentId: asNodeId('root') }).order).toBeUndefined();
  });
});

describe('createZone with a parentId', () => {
  it('attaches membership when given a parentId', () => {
    const node = createZone({
      id: asNodeId('inner'),
      parentId: asNodeId('outer'),
      strategyId: 'strip',
      config: {},
    });

    expect(node.membership?.parentId).toBe('outer');
    expect(node.membership?.placement).toEqual({});
    expect(node.container?.strategyId).toBe('strip');
  });

  it('omits membership when given none', () => {
    const node = createZone({ id: asNodeId('root'), strategyId: 'strip', config: {} });
    expect(node.membership).toBeUndefined();
  });

  it('takes a placement alongside a parentId', () => {
    const node = createZone({
      id: asNodeId('inner'),
      parentId: asNodeId('outer'),
      strategyId: 'strip',
      config: {},
      placement: { size: { w: 100 } },
    });

    expect(node.membership?.placement).toEqual({ size: { w: 100 } });
  });

  it('keeps kind zone by default, overridable after construction', () => {
    const zone = createZone({
      id: asNodeId('a'),
      parentId: asNodeId('p'),
      strategyId: 'strip',
      config: {},
    });
    expect(zone.kind).toBe('zone');

    // The migration path for the removed group constructor: build a zone,
    // then set kind — what `Store.split`'s interposed groups do internally.
    const group = createZone({
      id: asNodeId('b'),
      parentId: asNodeId('p'),
      strategyId: 'strip',
      config: {},
    });
    group.kind = 'group';
    expect(group.kind).toBe('group');
  });

  it('capability set is unaffected by a kind override', () => {
    const zone = createZone({
      id: asNodeId('a'),
      parentId: asNodeId('p'),
      strategyId: 'strip',
      config: {},
    });
    const group = createZone({
      id: asNodeId('b'),
      parentId: asNodeId('p'),
      strategyId: 'strip',
      config: {},
    });
    group.kind = 'group';

    const caps = (n: typeof zone) => ({
      container: !!n.container,
      membership: !!n.membership,
      focus: !!n.focus,
    });
    expect(caps(zone)).toEqual(caps(group));
  });

  it('registers under the parent rather than as a root', () => {
    const store = new Store();
    store.registerNode(createZone({ id: asNodeId('outer'), strategyId: 'strip', config: {} }));
    store.registerNode(
      createZone({
        id: asNodeId('inner'),
        parentId: asNodeId('outer'),
        strategyId: 'stack',
        config: {},
      }),
    );

    expect(store.rootIds).toEqual(['outer']);
    expect(store.getContainerView(asNodeId('outer'))?.childOrder).toEqual(['inner']);
  });
});
