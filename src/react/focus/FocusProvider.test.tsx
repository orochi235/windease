import { act, render, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { asNodeId, createNode, Store, stripStrategy } from '../../index.js';
import { Container } from '../Container.js';
import { Provider } from '../Provider.js';
import { StrategyRegistryProvider } from '../strategies.js';
import { FocusProvider } from './FocusProvider.js';
import { GeometryProvider } from './useGeometrySource.js';

function twoZoneStore(): Store {
  const s = new Store();
  for (const z of ['z1', 'z2']) {
    s.registerNode(
      createNode({
        kind: 'zone',
        container: { strategyId: 'strip', config: { axis: 'x', fill: true } },
        id: asNodeId(z),
      }),
    );
    s.showNode(asNodeId(z));
  }
  for (const c of ['a', 'b']) {
    const nid = asNodeId(c);
    s.registerNode(createNode({ kind: 'panel', focus: true, id: nid, parentId: asNodeId('z1') }));
    s.showNode(nid);
  }
  return s;
}

function twoZoneTree(store: Store) {
  return (
    <Provider store={store}>
      <StrategyRegistryProvider strategies={{ strip: stripStrategy as never }}>
        <GeometryProvider>
          <FocusProvider>
            <Container parentId={asNodeId('z1')} chrome={{}} viewport={{ w: 200, h: 100 }} />
            <Container parentId={asNodeId('z2')} chrome={{}} viewport={{ w: 200, h: 100 }} />
          </FocusProvider>
          <button type="button" data-testid="outside">
            outside
          </button>
        </GeometryProvider>
      </StrategyRegistryProvider>
    </Provider>
  );
}

function makeStore(): Store {
  const s = new Store();
  const z = asNodeId('z');
  s.registerNode(
    createNode({
      kind: 'zone',
      container: { strategyId: 'strip', config: { axis: 'x', fill: true } },
      id: z,
    }),
  );
  s.showNode(z);
  for (const c of ['a', 'b']) {
    const nid = asNodeId(c);
    s.registerNode(createNode({ kind: 'panel', focus: true, id: nid, parentId: z }));
    s.showNode(nid);
  }
  return s;
}

function tree(store: Store) {
  return (
    <Provider store={store}>
      <StrategyRegistryProvider strategies={{ strip: stripStrategy as never }}>
        <GeometryProvider>
          <FocusProvider>
            <Container parentId={asNodeId('z')} chrome={{}} viewport={{ w: 200, h: 100 }} />
          </FocusProvider>
        </GeometryProvider>
      </StrategyRegistryProvider>
    </Provider>
  );
}

/** Moving a node reparents its wrapper, which unmounts and remounts it. The
 *  adapter presents from a store subscription, and that runs before React
 *  commits — so the element it looks for may not be there yet. */
describe('FocusProvider — the caret across a remount', () => {
  const activeNode = () =>
    document.activeElement?.closest('[data-node]')?.getAttribute('data-node') ?? null;

  it('keeps the caret on a node that moves to another parent', async () => {
    const store = twoZoneStore();
    store.focusNode(asNodeId('a'));
    const { container } = render(twoZoneTree(store));
    (container.querySelector('[data-node="a"]') as HTMLElement).focus();
    expect(activeNode()).toBe('a');

    await act(async () => {
      store.moveNode(asNodeId('a'), asNodeId('z2'));
    });

    await waitFor(() => expect(activeNode()).toBe('a'));
    expect(container.querySelector('[data-node-container="z2"] [data-node="a"]')).not.toBeNull();
  });

  it('leaves a caret that was outside the layout alone', async () => {
    const store = twoZoneStore();
    store.focusNode(asNodeId('a'));
    const { getByTestId } = render(twoZoneTree(store));
    const outside = getByTestId('outside') as HTMLElement;
    outside.focus();
    expect(document.activeElement).toBe(outside);

    await act(async () => {
      store.moveNode(asNodeId('b'), asNodeId('z2'));
    });

    expect(document.activeElement).toBe(outside);
  });
});

describe('FocusProvider', () => {
  it('gives exactly one wrapper tabIndex 0', async () => {
    const store = makeStore();
    store.focusNode(asNodeId('b'));
    const { container } = render(tree(store));
    await waitFor(() => {
      const stops = container.querySelectorAll('[data-node][tabindex="0"]');
      expect(stops.length).toBe(1);
      expect(stops[0]?.getAttribute('data-node')).toBe('b');
    });
  });

  it('leaves one tab stop when nothing is focused yet', async () => {
    const store = makeStore();
    const { container } = render(tree(store));
    await waitFor(() => {
      const stops = container.querySelectorAll('[data-node][tabindex="0"]');
      expect(stops.length).toBe(1);
      expect(stops[0]?.getAttribute('data-node')).toBe('a');
    });
    expect(store.focusedId).toBeNull();
  });

  it('raises model focus when a wrapper receives focusin', async () => {
    const store = makeStore();
    store.focusNode(asNodeId('a'));
    const { container } = render(tree(store));
    const wrapper = container.querySelector('[data-node="b"]') as HTMLElement;
    wrapper.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    await waitFor(() => expect(store.focusedId).toBe(asNodeId('b')));
  });

  it('does not oscillate when it moves focus itself', async () => {
    const store = makeStore();
    store.focusNode(asNodeId('a'));
    render(tree(store));
    let transitions = 0;
    store.events.on('node.transitioned', (e) => {
      if (e.machine === 'focus') transitions++;
    });
    store.focusNode(asNodeId('b'));
    await waitFor(() => expect(store.focusedId).toBe(asNodeId('b')));
    // a blurs, b focuses. A feedback loop would keep adding pairs.
    expect(transitions).toBe(2);
  });
});
