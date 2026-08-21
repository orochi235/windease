import { render, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { asNodeId, createNode, Store, stripStrategy } from '../../index.js';
import { Container } from '../Container.js';
import { Provider } from '../Provider.js';
import { StrategyRegistryProvider } from '../strategies.js';
import { FocusProvider } from './FocusProvider.js';
import { GeometryProvider } from './useGeometrySource.js';

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
