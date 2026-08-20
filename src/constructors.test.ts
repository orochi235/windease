import { describe, expect, it } from 'vitest';
import { createNode } from './constructors.js';
import { asNodeId, type NodeId } from './node.js';
import { Store } from './store.js';

describe('createNode', () => {
  it('produces a leaf: no container, no membership, no focus', () => {
    const node = createNode({ id: asNodeId('leaf') });
    expect(node.container).toBeUndefined();
    expect(node.membership).toBeUndefined();
    expect(node.focus).toBeUndefined();
    expect(node.lifecycle.state).toBe('mounted');
    expect(node.lock).toBeUndefined();
  });

  it('resolves lock: true on a leaf to only the axes a leaf supports', () => {
    const node = createNode({ id: asNodeId('leaf-lock'), lock: true });
    expect(node.lock).toEqual({ destroy: true });
  });

  it('produces a leaf + focus', () => {
    const node = createNode({ id: asNodeId('lf'), focus: true });
    expect(node.focus).toBeDefined();
    expect(node.focus?.state).toBe('blurred');
    expect(node.container).toBeUndefined();
    expect(node.membership).toBeUndefined();
  });

  it('resolves lock: true on a leaf + focus the same as a bare leaf — focus adds no axes', () => {
    const node = createNode({ id: asNodeId('lf-lock'), focus: true, lock: true });
    expect(node.lock).toEqual({ destroy: true });
  });

  it('produces a container root: container only, no membership', () => {
    const node = createNode({
      id: asNodeId('root'),
      container: { strategyId: 'grid', config: { cols: 3 } },
    });
    expect(node.container).toBeDefined();
    expect(node.container?.strategyId).toBe('grid');
    expect(node.container?.config).toEqual({ cols: 3 });
    expect(node.container?.childOrder).toEqual([]);
    expect(node.container?.allowsPinning).toBe(true);
    expect(node.membership).toBeUndefined();
    expect(node.focus).toBeUndefined();
  });

  it('honors container.allowsPinning: false', () => {
    const node = createNode({
      id: asNodeId('root-nopin'),
      container: { strategyId: 'strip', config: {}, allowsPinning: false },
    });
    expect(node.container?.allowsPinning).toBe(false);
  });

  it('resolves lock: true on a container root to only container axes + destroy', () => {
    const node = createNode({
      id: asNodeId('root-lock'),
      container: { strategyId: 'grid', config: {} },
      lock: true,
    });
    expect(node.lock).toEqual({ destroy: true, accept: true, dragOut: true, arrange: true });
  });

  it('produces a container + parent (the former createGroup shape)', () => {
    const node = createNode({
      id: asNodeId('group'),
      parentId: asNodeId('outer'),
      container: { strategyId: 'stack', config: { axis: 'vertical' } },
    });
    expect(node.container).toBeDefined();
    expect(node.membership).toBeDefined();
    expect(node.membership?.parentId).toBe('outer');
    expect(node.membership?.placement).toEqual({});
    expect(node.membership?.transit.state).toBe('idle');
    expect(node.focus).toBeUndefined();
  });

  it('resolves lock: true on a container + parent to membership + container axes', () => {
    const node = createNode({
      id: asNodeId('group-lock'),
      parentId: asNodeId('outer'),
      container: { strategyId: 'stack', config: {} },
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

  it('produces a container + parent + focus (the "tray inside a window" shape)', () => {
    const node = createNode({
      id: asNodeId('tray'),
      parentId: asNodeId('outer'),
      container: { strategyId: 'stack', config: {} },
      focus: true,
    });
    expect(node.container).toBeDefined();
    expect(node.membership).toBeDefined();
    expect(node.focus).toBeDefined();
    expect(node.focus?.state).toBe('blurred');
  });

  it('resolves lock: true on a container + parent + focus the same as container + parent — focus adds no axes', () => {
    const node = createNode({
      id: asNodeId('tray-lock'),
      parentId: asNodeId('outer'),
      container: { strategyId: 'stack', config: {} },
      focus: true,
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

  it('produces a membership + focus leaf with placement', () => {
    const node = createNode({
      id: asNodeId('panel'),
      parentId: asNodeId('outer'),
      focus: true,
      placement: { locked: true },
    });
    expect(node.membership?.placement).toEqual({ locked: true });
    expect(node.container).toBeUndefined();
  });

  it('filters an explicit LockSet to supported axes, not just true', () => {
    const node = createNode({
      id: asNodeId('panel-lock'),
      parentId: asNodeId('outer'),
      lock: { move: true, arrange: true },
    });
    expect(node.container).toBeUndefined();
    expect(node.lock).toEqual({ move: true });
  });

  it('omits lock when the resolved set is empty', () => {
    const node = createNode({ id: asNodeId('nolock'), lock: false });
    expect(node.lock).toBeUndefined();
  });

  it('carries kind, meta, hints, and order', () => {
    const node = createNode({
      id: asNodeId('n'),
      kind: 'widget',
      meta: { title: 'Editor' },
      hints: { minSize: { w: 200, h: 100 } },
      order: 7,
    });
    expect(node.kind).toBe('widget');
    expect(node.meta).toEqual({ title: 'Editor' });
    expect(node.hints?.minSize).toEqual({ w: 200, h: 100 });
    expect(node.order).toBe(7);
  });

  it('leaves kind, order undefined when not provided', () => {
    const node = createNode({ id: asNodeId('bare') });
    expect(node.kind).toBeUndefined();
    expect(node.order).toBeUndefined();
  });

  it('registers a rootless container under its parent, not as a root', () => {
    const store = new Store();
    store.registerNode(
      createNode({ id: asNodeId('outer'), container: { strategyId: 'strip', config: {} } }),
    );
    store.registerNode(
      createNode({
        id: asNodeId('inner'),
        parentId: asNodeId('outer'),
        container: { strategyId: 'stack', config: {} },
      }),
    );

    expect(store.rootIds).toEqual(['outer']);
    expect(store.getContainerView(asNodeId('outer'))?.childOrder).toEqual(['inner']);
  });

  it('accepts an explicit undefined for optional props without narrowing', () => {
    // Shape of a consumer forwarding optional React props straight through.
    const props: { meta?: Record<string, unknown>; order?: number; parentId?: NodeId } = {};

    const node = createNode({
      id: asNodeId('p'),
      parentId: props.parentId,
      meta: props.meta,
      order: props.order,
    });

    expect(node.meta).toBeUndefined();
    expect(node.order).toBeUndefined();
    expect(node.membership).toBeUndefined();
  });
});
