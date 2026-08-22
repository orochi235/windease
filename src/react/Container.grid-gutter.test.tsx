import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { asNodeId, createNode, gridStrategy, Store } from '../index.js';
import { Container } from './Container.js';
import { Provider } from './Provider.js';
import { StrategyRegistryProvider } from './strategies.js';

const Z = asNodeId('z');
const CONFIG = { resizable: true, gap: 0, padding: 0 };

function makeStore(): Store {
  const s = new Store();
  s.registerNode(
    createNode({ kind: 'zone', container: { strategyId: 'grid', config: CONFIG }, id: Z }),
  );
  s.showNode(Z);
  for (let i = 1; i <= 4; i++) {
    const nid = asNodeId(`w${i}`);
    s.registerNode(createNode({ kind: 'panel', id: nid, parentId: Z, meta: { title: `W${i}` } }));
    s.showNode(nid);
  }
  return s;
}

const tree = (store: Store) => (
  <Provider store={store}>
    <StrategyRegistryProvider strategies={{ grid: gridStrategy as never }}>
      <Container parentId={Z} chrome={{}} viewport={{ w: 400, h: 400 }} affordances />
    </StrategyRegistryProvider>
  </Provider>
);

const spanOf = (s: Store, id: string) =>
  s.getNode(asNodeId(id))?.membership?.placement?.span as
    | { cols?: number; rows?: number }
    | undefined;

const gutterX = (c: HTMLElement) =>
  c.querySelector('[data-affordance-hit="resize-x-w1"]') as HTMLElement;

describe('grid gutters in the React layer', () => {
  it('reports the span in cells through ARIA', () => {
    const { container } = render(tree(makeStore()));
    const g = gutterX(container);
    expect(g.getAttribute('role')).toBe('separator');
    expect(g.getAttribute('aria-valuenow')).toBe('1');
    expect(g.getAttribute('aria-valuemax')).toBe('2');
  });

  it('moves one cell per key press, not eight pixels', () => {
    // The reason `bounds.step` exists: the container-level 8px default is
    // meaningless against a value counted in cells.
    const store = makeStore();
    const { container } = render(tree(store));
    fireEvent.keyDown(gutterX(container), { key: 'ArrowRight' });
    expect(spanOf(store, 'w1')?.cols).toBe(2);
  });

  it('comes back on the opposite arrow', () => {
    const store = makeStore();
    const { container } = render(tree(store));
    fireEvent.keyDown(gutterX(container), { key: 'ArrowRight' });
    fireEvent.keyDown(gutterX(container), { key: 'ArrowLeft' });
    expect(spanOf(store, 'w1')?.cols).toBe(1);
  });

  it('renders no gutter for a resize-locked item', () => {
    const store = makeStore();
    store.setLock(asNodeId('w1'), { resize: true });
    const { container } = render(tree(store));
    expect(container.querySelector('[data-affordance-hit="resize-x-w1"]')).toBeNull();
  });
});
