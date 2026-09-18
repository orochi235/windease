import { act, fireEvent, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { asNodeId, createNode, desktopStrategy, Store } from '../index.js';
import { type ChromeMap, Container } from './index.js';
import { Provider } from './Provider.js';
import { StrategyRegistryProvider } from './strategies.js';

const ZONE = asNodeId('z');
const CHROME: ChromeMap = { panel: ({ node }) => <div>{String(node.id)}</div> };

function renderDesktop(config: Record<string, unknown>) {
  const store = new Store();
  store.registerNode(
    createNode({ kind: 'zone', id: ZONE, container: { strategyId: 'desktop', config } }),
  );
  for (const id of ['a', 'b']) {
    store.registerNode(
      createNode({
        kind: 'panel',
        id: asNodeId(id),
        parentId: ZONE,
        placement: { x: 0, y: 0 },
        hints: { preferredSize: { w: 50, h: 50 } },
      }),
    );
    store.showNode(asNodeId(id));
  }
  const { container } = render(
    <Provider store={store}>
      <StrategyRegistryProvider strategies={{ desktop: desktopStrategy() as never }}>
        <Container parentId={ZONE} chrome={CHROME} viewport={{ w: 200, h: 100 }} />
      </StrategyRegistryProvider>
    </Provider>,
  );
  const click = async (id: string) => {
    await act(async () => {
      fireEvent.click(container.querySelector(`[data-node="${id}"]`) as HTMLElement);
    });
  };
  return { store, click };
}

describe("Container with config raise: 'click'", () => {
  it('raises a child that has no focus capability when it is clicked', async () => {
    const { store, click } = renderDesktop({ raise: 'click' });
    await click('a');
    expect(store.getContainerView(ZONE)?.childOrder).toEqual(['b', 'a']);
  });

  it("does nothing on click under 'focus'", async () => {
    const { store, click } = renderDesktop({ raise: 'focus' });
    await click('a');
    expect(store.getContainerView(ZONE)?.childOrder).toEqual(['a', 'b']);
  });

  it("does nothing on click when the container is locked against 'arrange'", async () => {
    const { store, click } = renderDesktop({ raise: 'click' });
    store.setLock(ZONE, { arrange: true });
    await click('a');
    expect(store.getContainerView(ZONE)?.childOrder).toEqual(['a', 'b']);
  });
});
