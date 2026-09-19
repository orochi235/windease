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
        <Container parentId={ZONE} chrome={CHROME} viewport={{ w: 200, h: 100 }} affordances />
      </StrategyRegistryProvider>
    </Provider>,
  );
  const clickOn = async (selector: string) => {
    await act(async () => {
      fireEvent.click(container.querySelector(selector) as HTMLElement);
    });
  };
  const pressOn = async (selector: string) => {
    await act(async () => {
      fireEvent.pointerDown(container.querySelector(selector) as HTMLElement, { pointerId: 1 });
    });
  };
  const click = (id: string) => clickOn(`[data-node="${id}"]`);
  return { store, click, clickOn, pressOn };
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

  it('raises a window whose title band is pressed', async () => {
    const { store, pressOn } = renderDesktop({ raise: 'click', drag: true });
    await pressOn('[data-affordance-hit="desktop:drag:a"]');
    expect(store.getContainerView(ZONE)?.childOrder).toEqual(['b', 'a']);
  });

  it('raises a window whose minimize box is clicked', async () => {
    const { store, clickOn } = renderDesktop({ raise: 'click', minimizable: true });
    await clickOn('[data-affordance-hit="desktop:minimize:a"]');
    expect(store.getContainerView(ZONE)?.childOrder).toEqual(['b', 'a']);
  });

  it('leaves the order alone when the parent does not raise', async () => {
    const { store, pressOn } = renderDesktop({ drag: true });
    await pressOn('[data-affordance-hit="desktop:drag:a"]');
    expect(store.getContainerView(ZONE)?.childOrder).toEqual(['a', 'b']);
  });
});
