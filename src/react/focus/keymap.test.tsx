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

describe('keymap', () => {
  it('ArrowRight on a wrapper moves focus', async () => {
    const store = makeStore();
    store.focusNode(asNodeId('a'));
    const { container } = render(tree(store));
    const wrapper = container.querySelector('[data-node="a"]') as HTMLElement;
    wrapper.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    await waitFor(() => expect(store.focusedId).toBe(asNodeId('b')));
  });

  it('ArrowRight inside content does NOT move focus', async () => {
    const store = makeStore();
    store.focusNode(asNodeId('a'));
    const { container } = render(tree(store));
    const wrapper = container.querySelector('[data-node="a"]') as HTMLElement;
    const input = document.createElement('input');
    wrapper.appendChild(input);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));
    expect(store.focusedId).toBe(asNodeId('a'));
  });

  it('F6 cycles from inside content', async () => {
    const store = makeStore();
    store.focusNode(asNodeId('a'));
    const { container } = render(tree(store));
    const wrapper = container.querySelector('[data-node="a"]') as HTMLElement;
    const input = document.createElement('input');
    wrapper.appendChild(input);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'F6', bubbles: true }));
    await waitFor(() => expect(store.focusedId).toBe(asNodeId('b')));
  });
});
