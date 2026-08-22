import { act, render } from '@testing-library/react';
import { StrictMode } from 'react';
import { describe, expect, it } from 'vitest';
import { asNodeId, createNode, gridStrategy, Store } from '../index.js';
import { type ChromeMap, Container } from './index.js';
import { Provider } from './Provider.js';
import { StrategyRegistryProvider } from './strategies.js';

const CHROME: ChromeMap = {
  panel: ({ node }) => <div data-testid={`p-${node.id}`}>{String(node.id)}</div>,
};

const ZONE = asNodeId('z');

function makeStore(): Store {
  const s = new Store();
  s.registerNode(
    createNode({ kind: 'zone', id: ZONE, container: { strategyId: 'grid', config: { cols: 2 } } }),
  );
  for (const name of ['a', 'b']) {
    const id = asNodeId(name);
    s.registerNode(createNode({ kind: 'panel', focus: true, id, parentId: ZONE }));
    s.showNode(id);
  }
  return s;
}

function tree(store: Store) {
  return (
    <Provider store={store}>
      <StrategyRegistryProvider strategies={{ grid: gridStrategy as never }}>
        <Container parentId={ZONE} chrome={CHROME} viewport={{ w: 400, h: 300 }} />
      </StrategyRegistryProvider>
    </Provider>
  );
}

describe('Container under StrictMode', () => {
  it('renders children after the double mount', () => {
    const { getByTestId } = render(<StrictMode>{tree(makeStore())}</StrictMode>);
    expect(getByTestId('p-a')).toBeDefined();
    expect(getByTestId('p-b')).toBeDefined();
  });

  it('still tracks the store after the double mount', () => {
    const store = makeStore();
    const { getByTestId } = render(<StrictMode>{tree(store)}</StrictMode>);

    const c = asNodeId('c');
    act(() => {
      store.registerNode(createNode({ kind: 'panel', focus: true, id: c, parentId: ZONE }));
      store.showNode(c);
    });

    expect(getByTestId('p-c')).toBeDefined();
  });
});
