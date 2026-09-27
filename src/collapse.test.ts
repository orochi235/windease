import { describe, expect, it } from 'vitest';
import {
  type CollapsePolicy,
  collapse,
  isEmptyContainer,
  resolveCollapse,
  stay,
} from './collapse.js';
import { createNode } from './constructors.js';
import { asNodeId } from './node.js';
import { Store } from './store.js';

const ROOT = asNodeId('root');
const SIDE = asNodeId('side');
const MAIN = asNodeId('main');
const PANEL = asNodeId('panel');

/** root ▸ [side (a group, holding `panel` unless `empty`), main]. */
function scene(policy?: CollapsePolicy, { empty = true } = {}) {
  const store = new Store(policy ? { collapsePolicy: policy } : {});
  store.registerNode(
    createNode({ kind: 'zone', id: ROOT, container: { strategyId: 'strip', config: {} } }),
  );
  store.registerNode(
    createNode({
      kind: 'group',
      id: SIDE,
      parentId: ROOT,
      container: { strategyId: 'strip', config: { axis: 'y' } },
    }),
  );
  store.registerNode(createNode({ kind: 'panel', focus: true, id: MAIN, parentId: ROOT }));
  for (const id of [ROOT, SIDE, MAIN]) store.showNode(id);
  if (!empty) {
    store.registerNode(createNode({ kind: 'panel', focus: true, id: PANEL, parentId: SIDE }));
    store.showNode(PANEL);
  }
  return store;
}

describe('isEmptyContainer', () => {
  it('is true for a container with no children', () => {
    expect(isEmptyContainer(scene(), SIDE)).toBe(true);
  });

  it('is false while a child would reach layout', () => {
    expect(isEmptyContainer(scene(undefined, { empty: false }), SIDE)).toBe(false);
  });

  it('is true when every child is hidden', () => {
    const store = scene(undefined, { empty: false });
    store.hideNode(PANEL);
    expect(isEmptyContainer(store, SIDE)).toBe(true);
  });

  it('is false for a node that is not a container', () => {
    expect(isEmptyContainer(scene(), MAIN)).toBe(false);
  });
});

describe('resolveCollapse', () => {
  it('answers null with no policy, which is how a store behaved before', () => {
    expect(resolveCollapse({ store: scene(), id: SIDE })).toBeNull();
  });

  it('returns the extent the policy chose', () => {
    const store = scene(() => ({ extent: 24 }));
    expect(resolveCollapse({ store, id: SIDE })).toEqual({ extent: 24 });
  });

  it('reads null as a refusal and undefined as a deferral, both leaving the container open', () => {
    expect(resolveCollapse({ store: scene(() => null), id: SIDE })).toBeNull();
    expect(resolveCollapse({ store: scene(() => undefined), id: SIDE })).toBeNull();
  });

  it('never asks about a container that still holds a child', () => {
    let asked = 0;
    const store = scene(
      () => {
        asked++;
        return { extent: 0 };
      },
      { empty: false },
    );
    expect(resolveCollapse({ store, id: SIDE })).toBeNull();
    expect(asked).toBe(0);
  });

  it('never asks about a root, which no parent lays out', () => {
    let asked = 0;
    const store = scene(() => {
      asked++;
      return { extent: 0 };
    });
    store.unregisterNode(SIDE);
    store.unregisterNode(MAIN);
    expect(resolveCollapse({ store, id: ROOT })).toBeNull();
    expect(asked).toBe(0);
  });

  it('treats a policy that throws as a deferral', () => {
    const store = scene(() => {
      throw new Error('boom');
    });
    expect(resolveCollapse({ store, id: SIDE })).toBeNull();
  });

  it.each([
    ['negative', -1],
    ['NaN', Number.NaN],
    ['infinite', Number.POSITIVE_INFINITY],
    ['a string', '24' as unknown as number],
  ])('treats a %s extent as a deferral', (_, extent) => {
    const store = scene(() => ({ extent }));
    expect(resolveCollapse({ store, id: SIDE })).toBeNull();
  });

  it('hands the policy the drag the caller described', () => {
    const seen: unknown[] = [];
    const store = scene(({ id, drag }) => {
      seen.push(drag?.ids, drag?.accepts(id));
      return undefined;
    });
    resolveCollapse({ store, id: SIDE, drag: { ids: [PANEL], accepts: (t) => t === SIDE } });
    expect(seen).toEqual([[PANEL], true]);
  });

  it('answers a policy that calls back into it without recursing', () => {
    let asked = 0;
    const store = scene((input) => {
      asked++;
      const inner = resolveCollapse(input);
      return inner ?? { extent: 12 };
    });
    expect(resolveCollapse({ store, id: SIDE })).toEqual({ extent: 12 });
    // A stack overflow is caught like any other throw, so the answer alone
    // cannot tell a guarded policy from one that recursed until it died.
    expect(asked).toBe(1);
  });
});

describe('the built-in policies', () => {
  it('stay refuses, so the container keeps its extent', () => {
    expect(resolveCollapse({ store: scene(stay), id: SIDE })).toBeNull();
  });

  it('collapse() takes the container to zero', () => {
    expect(resolveCollapse({ store: scene(collapse()), id: SIDE })).toEqual({ extent: 0 });
  });

  it('collapse({ to }) leaves a rail', () => {
    expect(resolveCollapse({ store: scene(collapse({ to: 24 })), id: SIDE })).toEqual({
      extent: 24,
    });
  });

  it('collapse({ dragTo }) opens for a drag the container would take', () => {
    const store = scene(collapse({ dragTo: 200 }));
    const accepts = (taken: boolean) => ({ ids: [PANEL], accepts: () => taken });
    expect(resolveCollapse({ store, id: SIDE, drag: accepts(true) })).toEqual({ extent: 200 });
    expect(resolveCollapse({ store, id: SIDE, drag: accepts(false) })).toEqual({ extent: 0 });
    expect(resolveCollapse({ store, id: SIDE })).toEqual({ extent: 0 });
  });
});
