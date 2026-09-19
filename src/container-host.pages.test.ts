import { describe, expect, it } from 'vitest';
import { createNode } from './constructors.js';
import { ContainerHost } from './container-host.js';
import { HistoryController } from './history.js';
import { gridStrategy } from './layout/grid.js';
import { type PageState, pageStrategy } from './layout/page.js';
import type { StrategyRegistry } from './layout-types.js';
import { asNodeId, type NodeId } from './node.js';
import { deserialize, serialize } from './snapshot.js';
import { Store } from './store.js';

const REGISTRY: StrategyRegistry = new Map([
  ['page', pageStrategy(gridStrategy) as never],
  ['grid', gridStrategy as never],
]);
const DESK = asNodeId('desk');
const OTHER = asNodeId('other');

function build(): Store {
  const s = new Store();
  s.registerNode(createNode({ id: DESK, container: { strategyId: 'page', config: { pages: 3 } } }));
  s.registerNode(createNode({ id: OTHER, container: { strategyId: 'grid', config: {} } }));
  const child = (id: string, parentId: NodeId, placement?: Record<string, unknown>) => {
    s.registerNode(createNode({ id: asNodeId(id), parentId, focus: true, placement }));
    s.showNode(asNodeId(id));
  };
  child('a', DESK, { page: 0 });
  child('b', DESK, { page: 1 });
  child('stray', OTHER, { page: 2 });
  return s;
}

function host(store: Store): ContainerHost {
  const h = new ContainerHost(store, DESK, REGISTRY);
  h.setViewport({ w: 200, h: 200 });
  return h;
}

const page = (store: Store) =>
  (store.getContainerState(DESK) as PageState<unknown> | undefined)?.page;
const shown = (h: ContainerHost) => [...h.layout().placements.keys()];

describe('ContainerHost.command', () => {
  it('switches the page a strategy shows and stores it', () => {
    const store = build();
    const h = host(store);
    expect(shown(h)).toEqual(['a']);
    h.command({ type: 'next' });
    expect(page(store)).toBe(1);
    expect(shown(h)).toEqual(['b']);
    h.destroy();
  });

  it('is refused under lock.arrange', () => {
    const store = build();
    store.setLock(DESK, { arrange: true });
    const h = host(store);
    h.command({ type: 'next' });
    expect(page(store)).toBeUndefined();
    h.destroy();
  });

  it('does nothing on a strategy with no command', () => {
    const store = build();
    const h = new ContainerHost(store, OTHER, REGISTRY);
    h.setViewport({ w: 200, h: 200 });
    h.command({ type: 'next' });
    expect(store.getContainerState(OTHER)).toBeUndefined();
    h.destroy();
  });

  it('undoes as one step, like any container state write', () => {
    const store = build();
    const history = new HistoryController<ReturnType<typeof serialize>>();
    history.push(serialize(store));
    const h = host(store);
    h.command({ type: 'page', to: 2 });
    history.push(serialize(store));
    const back = history.undo();
    if (back) deserialize(store, back);
    expect(page(store)).toBeUndefined();
    h.destroy();
  });
});

describe('ContainerHost land', () => {
  it('puts a child moved in from another parent on the page shown', () => {
    const store = build();
    const h = host(store);
    h.command({ type: 'page', to: 1 });
    store.moveNode(asNodeId('stray'), DESK);
    expect(store.getNode(asNodeId('stray'))?.membership?.placement.page).toBe(1);
    expect(shown(h)).toEqual(['b', 'stray']);
    h.destroy();
  });

  it('leaves the page of a child registered with one', () => {
    const store = build();
    const h = host(store);
    store.registerNode(
      createNode({ id: asNodeId('late'), parentId: DESK, focus: true, placement: { page: 2 } }),
    );
    expect(store.getNode(asNodeId('late'))?.membership?.placement.page).toBe(2);
    h.destroy();
  });

  it('leaves a reorder within the container alone', () => {
    const store = build();
    const h = host(store);
    h.command({ type: 'page', to: 1 });
    store.reorderInParent(asNodeId('a'), 1);
    expect(store.getNode(asNodeId('a'))?.membership?.placement.page).toBe(0);
    h.destroy();
  });

  it('lands each of a multi-node move', () => {
    const store = build();
    store.registerNode(createNode({ id: asNodeId('s2'), parentId: OTHER, focus: true }));
    const h = host(store);
    h.command({ type: 'page', to: 2 });
    store.moveNodes([asNodeId('stray'), asNodeId('s2')], DESK);
    expect(store.getNode(asNodeId('stray'))?.membership?.placement.page).toBe(2);
    expect(store.getNode(asNodeId('s2'))?.membership?.placement.page).toBe(2);
    h.destroy();
  });

  it('records the move and its land as one undo step', async () => {
    const store = build();
    const history = new HistoryController<ReturnType<typeof serialize>>();
    const h = host(store);
    h.command({ type: 'page', to: 1 });
    history.push(serialize(store));
    const off = store.subscribe(() => history.push(serialize(store)));
    store.moveNode(asNodeId('stray'), DESK);
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    off();
    const back = history.undo();
    if (back) deserialize(store, back);
    const stray = store.getNode(asNodeId('stray'));
    expect(stray?.membership?.parentId).toBe(OTHER);
    expect(stray?.membership?.placement.page).toBe(2);
    h.destroy();
  });

  it('does nothing once the host is destroyed', () => {
    const store = build();
    const h = host(store);
    h.command({ type: 'page', to: 1 });
    h.destroy();
    store.moveNode(asNodeId('stray'), DESK);
    expect(store.getNode(asNodeId('stray'))?.membership?.placement.page).toBe(2);
  });
});
