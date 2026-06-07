// src/react/sibling-order.test.tsx
import { render, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Store, asNodeId, createPanel } from '../index.js';
import { Provider } from './Provider.js';
import { Panel, Zone } from './presets.js';
import type { ChildSort } from './childSort.js';

afterEach(cleanup);

describe('sibling order reconciliation', () => {
  it('JSX child order is reflected in store childIds', () => {
    const store = new Store();
    render(
      <Provider store={store}>
        <Zone id={asNodeId('z')} strategyId="grid" config={{ cols: 1 }}>
          <Panel id={asNodeId('a')} />
          <Panel id={asNodeId('b')} />
          <Panel id={asNodeId('c')} />
        </Zone>
      </Provider>,
    );
    expect(store.getContainerView(asNodeId('z'))?.childIds).toEqual([
      asNodeId('a'),
      asNodeId('b'),
      asNodeId('c'),
    ]);
  });

  it('reordering JSX siblings updates the store', () => {
    const store = new Store();
    const Tree = ({ reversed }: { reversed: boolean }) => (
      <Provider store={store}>
        <Zone id={asNodeId('z')} strategyId="grid" config={{ cols: 1 }}>
          {reversed ? (
            <>
              <Panel key="c" id={asNodeId('c')} />
              <Panel key="b" id={asNodeId('b')} />
              <Panel key="a" id={asNodeId('a')} />
            </>
          ) : (
            <>
              <Panel key="a" id={asNodeId('a')} />
              <Panel key="b" id={asNodeId('b')} />
              <Panel key="c" id={asNodeId('c')} />
            </>
          )}
        </Zone>
      </Provider>
    );
    const { rerender } = render(<Tree reversed={false} />);
    expect(store.getContainerView(asNodeId('z'))?.childIds).toEqual([
      asNodeId('a'),
      asNodeId('b'),
      asNodeId('c'),
    ]);
    rerender(<Tree reversed={true} />);
    expect(store.getContainerView(asNodeId('z'))?.childIds).toEqual([
      asNodeId('c'),
      asNodeId('b'),
      asNodeId('a'),
    ]);
  });

  it('numeric `order` prop overrides JSX position', () => {
    const store = new Store();
    render(
      <Provider store={store}>
        <Zone id={asNodeId('z')} strategyId="grid" config={{ cols: 1 }}>
          <Panel id={asNodeId('a')} order={20} />
          <Panel id={asNodeId('b')} order={10} />
          <Panel id={asNodeId('c')} />
        </Zone>
      </Provider>,
    );
    // b (order 10) < a (order 20) < c (undefined → +Infinity)
    expect(store.getContainerView(asNodeId('z'))?.childIds).toEqual([
      asNodeId('b'),
      asNodeId('a'),
      asNodeId('c'),
    ]);
  });

  it('custom `sort` prop fully overrides', () => {
    const store = new Store();
    const reverseSort: ChildSort = (jsx) => jsx.map((e) => e.id).reverse();
    render(
      <Provider store={store}>
        <Zone id={asNodeId('z')} strategyId="grid" config={{ cols: 1 }} sort={reverseSort}>
          <Panel id={asNodeId('a')} />
          <Panel id={asNodeId('b')} />
          <Panel id={asNodeId('c')} />
        </Zone>
      </Provider>,
    );
    expect(store.getContainerView(asNodeId('z'))?.childIds).toEqual([
      asNodeId('c'),
      asNodeId('b'),
      asNodeId('a'),
    ]);
  });

  it('mixed JSX + imperative children: JSX first (sorted by order), imperative tail in store order', () => {
    const store = new Store();
    const Stage = () => (
      <Provider store={store}>
        <Zone id={asNodeId('z')} strategyId="grid" config={{ cols: 1 }}>
          <Panel id={asNodeId('jsx-a')} />
          <Panel id={asNodeId('jsx-b')} order={5} />
        </Zone>
      </Provider>
    );
    const { rerender } = render(<Stage />);
    // Now add an imperative child. Then trigger a re-render so the parent's
    // useChildren subscription fires the layout effect and reconciles.
    store.registerNode(createPanel({
      id: asNodeId('imp-1'),
      parentId: asNodeId('z'),
    }));
    rerender(<Stage />);
    expect(store.getContainerView(asNodeId('z'))?.childIds).toEqual([
      asNodeId('jsx-b'),
      asNodeId('jsx-a'),
      asNodeId('imp-1'),
    ]);
  });
});
