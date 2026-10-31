import { act, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { asNodeId, createNode, type Node, Store } from '../index.js';
import { useActivity, useChildren, useRootNodes } from './hooks.js';
import { Provider } from './Provider.js';

function withStore(store: Store, ui: React.ReactNode) {
  return <Provider store={store}>{ui}</Provider>;
}

describe('useActivity', () => {
  it('returns undefined when no activity is set', () => {
    const store = new Store();
    store.registerNode(
      createNode({
        kind: 'zone',
        container: { strategyId: 'grid', config: {} },
        id: asNodeId('z'),
      }),
    );
    store.registerNode(
      createNode({
        kind: 'panel',
        focus: true,
        id: asNodeId('p'),
        parentId: asNodeId('z'),
      }),
    );
    let observed: Record<string, unknown> | undefined = { sentinel: true };
    function Probe() {
      observed = useActivity(asNodeId('p'));
      return null;
    }
    render(withStore(store, <Probe />));
    expect(observed).toBeUndefined();
  });

  it('returns the activity bag and re-renders on change', async () => {
    const store = new Store();
    store.registerNode(
      createNode({
        kind: 'zone',
        container: { strategyId: 'grid', config: {} },
        id: asNodeId('z'),
      }),
    );
    store.registerNode(
      createNode({
        kind: 'panel',
        focus: true,
        id: asNodeId('p'),
        parentId: asNodeId('z'),
      }),
    );
    const seen: Array<Record<string, unknown> | undefined> = [];
    function Probe() {
      seen.push(useActivity(asNodeId('p')));
      return null;
    }
    render(withStore(store, <Probe />));
    await act(async () => {
      store.patchActivity(asNodeId('p'), { busy: true });
    });
    expect(seen[seen.length - 1]).toEqual({ busy: true });
    await act(async () => {
      store.patchActivity(asNodeId('p'), { busy: undefined });
    });
    expect(seen[seen.length - 1]).toBeUndefined();
  });
});

describe('record identity', () => {
  function seed(): Store {
    const store = new Store();
    store.registerNode(
      createNode({
        kind: 'zone',
        container: { strategyId: 'grid', config: {} },
        id: asNodeId('z'),
      }),
    );
    store.showNode(asNodeId('z'));
    store.registerNode(
      createNode({ kind: 'panel', focus: true, id: asNodeId('p'), parentId: asNodeId('z') }),
    );
    store.showNode(asNodeId('p'));
    return store;
  }

  it('useChildren hands back the current record after setMeta and hide', async () => {
    const store = seed();
    let seen: readonly Node[] = [];
    function Probe() {
      seen = useChildren(asNodeId('z'));
      return null;
    }
    render(withStore(store, <Probe />));
    await act(async () => store.setMeta(asNodeId('p'), { title: 'new' }));
    expect(seen[0]).toBe(store.getNode(asNodeId('p')));
    expect(seen[0]?.meta).toMatchObject({ title: 'new' });
    await act(async () => store.hideNode(asNodeId('p')));
    expect(seen[0]?.lifecycle.state).toBe('hidden');
  });

  it('useRootNodes hands back the current record after setMeta and hide', async () => {
    const store = seed();
    let seen: readonly Node[] = [];
    function Probe() {
      seen = useRootNodes();
      return null;
    }
    render(withStore(store, <Probe />));
    await act(async () => store.setMeta(asNodeId('z'), { title: 'new' }));
    expect(seen[0]).toBe(store.getNode(asNodeId('z')));
    await act(async () => store.hideNode(asNodeId('z')));
    expect(seen[0]?.lifecycle.state).toBe('hidden');
  });

  it('keeps the array stable while nothing changes', () => {
    const store = seed();
    const seen: Array<readonly Node[]> = [];
    function Probe() {
      seen.push(useChildren(asNodeId('z')));
      return null;
    }
    const { rerender } = render(withStore(store, <Probe />));
    rerender(withStore(store, <Probe />));
    expect(seen.length).toBeGreaterThan(1);
    expect(seen[seen.length - 1]).toBe(seen[0]);
  });
});
