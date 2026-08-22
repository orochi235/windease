import { describe, expect, it, vi } from 'vitest';
import { createNode } from './constructors.js';
import { ContainerHost } from './container-host.js';
import { asNodeId, Store } from './index.js';
import { stripStrategy } from './layout/strip.js';

const Z = asNodeId('z');

function hostWith(hints?: { render?: 'placed' | 'flow' }) {
  const store = new Store();
  store.registerNode(
    createNode({
      kind: 'zone',
      id: Z,
      container: { strategyId: 'strip', config: { axis: 'x', fill: true } },
      ...(hints ? { hints } : {}),
    }),
  );
  for (const c of ['a', 'b']) {
    const nid = asNodeId(c);
    store.registerNode(createNode({ kind: 'panel', focus: true, id: nid, parentId: Z }));
    store.showNode(nid);
  }
  const host = new ContainerHost(store, Z, new Map([['strip', stripStrategy as never]]));
  return { store, host };
}

describe('ContainerHost — flow mode', () => {
  it('reports placed mode by default', () => {
    const { host } = hostWith();
    host.setViewport({ w: 200, h: 100 });
    const layout = host.layout();
    expect(layout.mode).toBe('placed');
    expect(layout.placements.size).toBe(2);
  });

  it('runs no strategy and produces no placements', () => {
    const { host } = hostWith({ render: 'flow' });
    host.setViewport({ w: 200, h: 100 });
    const layout = host.layout();
    expect(layout.mode).toBe('flow');
    expect(layout.placements.size).toBe(0);
    expect(layout.affordances).toEqual([]);
    expect(layout.unplaced).toEqual([]);
  });

  it('does not call the strategy at all', () => {
    const store = new Store();
    store.registerNode(
      createNode({
        kind: 'zone',
        id: Z,
        container: { strategyId: 'spy', config: {} },
        hints: { render: 'flow' },
      }),
    );
    const p = asNodeId('p');
    store.registerNode(createNode({ kind: 'panel', focus: true, id: p, parentId: Z }));
    store.showNode(p);
    const layout = vi.fn(() => ({ placements: new Map(), affordances: [] }));
    const host = new ContainerHost(store, Z, new Map([['spy', { name: 'spy', layout } as never]]));
    host.setViewport({ w: 200, h: 100 });
    host.layout();
    expect(layout).not.toHaveBeenCalled();
  });

  it('is ready before any viewport is measured', () => {
    const { host } = hostWith({ render: 'flow' });
    expect(host.layout().mode).toBe('flow');
  });

  it('a placed container with no viewport is not', () => {
    const { host } = hostWith();
    expect(host.layout().viewport).toBeNull();
    expect(host.layout().placements.size).toBe(0);
  });
});
