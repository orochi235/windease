import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { asNodeId, createNode, type NodeId, Store } from '../index.js';
import { useStack } from './dnd/useStack.js';
import { Provider } from './Provider.js';

afterEach(cleanup);

const id = (s: string) => asNodeId(s);

function seeded(config: Record<string, unknown> = {}): Store {
  const s = new Store();
  s.registerNode(
    createNode({ kind: 'group', container: { strategyId: 'stack', config }, id: id('s1') }),
  );
  for (const [p, title] of [
    ['a', 'Alpha'],
    ['b', 'Beta'],
  ] as const) {
    s.registerNode(createNode({ kind: 'panel', id: id(p), parentId: id('s1'), meta: { title } }));
    s.showNode(id(p));
  }
  return s;
}

function mount(store: Store) {
  const seen: { current: ReturnType<typeof useStack> | null } = { current: null };
  function Probe() {
    seen.current = useStack(id('s1'));
    return null;
  }
  render(
    <Provider store={store}>
      <Probe />
    </Provider>,
  );
  return seen;
}

describe('useStack', () => {
  it('reports tabs in childOrder, titled from meta', () => {
    const seen = mount(seeded());
    expect(seen.current?.tabs).toEqual([
      { id: id('a'), title: 'Alpha' },
      { id: id('b'), title: 'Beta' },
    ]);
  });

  it('defaults activeId to the first child', () => {
    expect(mount(seeded()).current?.activeId).toBe(id('a'));
  });

  it('reports the configured activeId', () => {
    expect(mount(seeded({ activeId: 'b' })).current?.activeId).toBe(id('b'));
  });

  it('reports the first child when activeId names one that has left', () => {
    // Matches the strategy's own fallback, so the model and the body agree.
    expect(mount(seeded({ activeId: 'gone' })).current?.activeId).toBe(id('a'));
  });

  it('activate writes the config and the next render reports it', async () => {
    const store = seeded();
    const seen = mount(store);
    // The store notifies on a microtask, so the sync form of `act` returns
    // before React has re-rendered.
    await act(async () => {
      seen.current?.activate(id('b'));
    });
    expect(store.getNode(id('s1'))?.container?.config).toMatchObject({ activeId: id('b') });
    expect(seen.current?.activeId).toBe(id('b'));
  });

  it('activate is a no-op for an id that is not a child', () => {
    const store = seeded();
    const seen = mount(store);
    const before = store.getNode(id('s1'))?.container?.config;
    act(() => seen.current?.activate('elsewhere' as NodeId));
    expect(store.getNode(id('s1'))?.container?.config).toBe(before);
  });
});
