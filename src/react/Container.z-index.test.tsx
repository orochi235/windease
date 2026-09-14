import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { asNodeId, createNode, desktopStrategy, gridStrategy, Store } from '../index.js';
import { type ChromeMap, Container } from './index.js';
import { Provider } from './Provider.js';
import { StrategyRegistryProvider } from './strategies.js';

const ZONE = asNodeId('z');
const CHROME: ChromeMap = { panel: ({ node }) => <div>{String(node.id)}</div> };

function renderZone(strategyId: string, strategies: Record<string, unknown>) {
  const store = new Store();
  store.registerNode(createNode({ kind: 'zone', id: ZONE, container: { strategyId, config: {} } }));
  for (const [id, x] of [
    ['a', 0],
    ['b', 20],
  ] as const) {
    store.registerNode(
      createNode({
        kind: 'panel',
        id: asNodeId(id),
        parentId: ZONE,
        placement: { x, y: 0 },
        hints: { preferredSize: { w: 50, h: 50 } },
      }),
    );
    store.showNode(asNodeId(id));
  }
  const { container } = render(
    <Provider store={store}>
      <StrategyRegistryProvider strategies={strategies as never}>
        <Container parentId={ZONE} chrome={CHROME} viewport={{ w: 200, h: 100 }} />
      </StrategyRegistryProvider>
    </Provider>,
  );
  const zIndexOf = (id: string) =>
    (container.querySelector(`[data-node="${id}"]`) as HTMLElement).style.zIndex;
  return zIndexOf;
}

describe('Container z-index', () => {
  it("stacks a child by its placement's z", () => {
    const zIndexOf = renderZone('desktop', { desktop: desktopStrategy() });
    expect([zIndexOf('a'), zIndexOf('b')]).toEqual(['1', '2']);
  });

  it('sets no z-index on a child at depth zero', () => {
    const zIndexOf = renderZone('grid', { grid: gridStrategy });
    expect(zIndexOf('a')).toBe('');
  });
});
