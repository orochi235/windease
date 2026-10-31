import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { asNodeId, createNode, Store, stripStrategy } from '../index.js';
import { Container } from './Container.js';
import { useLayoutContext } from './LayoutContext.js';
import { Provider } from './Provider.js';
import { Panel, Zone } from './presets.js';
import { StrategyRegistryProvider } from './strategies.js';

const z = asNodeId('z');

function makeStore(): Store {
  const s = new Store();
  s.registerNode(
    createNode({
      kind: 'zone',
      container: { strategyId: 'strip', config: { axis: 'x', fill: true } },
      id: z,
    }),
  );
  s.showNode(z);
  for (const id of ['a', 'b']) {
    s.registerNode(createNode({ kind: 'panel', focus: true, id: asNodeId(id), parentId: z }));
    s.showNode(asNodeId(id));
  }
  return s;
}

function row(store: Store, w: number) {
  return (
    <Provider store={store}>
      <StrategyRegistryProvider strategies={{ strip: stripStrategy as never }}>
        <Container parentId={z} chrome={{}} viewport={{ w, h: 100 }} settleMs={200} />
      </StrategyRegistryProvider>
    </Provider>
  );
}

const child = (root: HTMLElement, id: string) =>
  root.querySelector(`[data-node="${id}"]`) as HTMLElement;

describe('settle transition across a viewport change', () => {
  it('is dropped when the placements moved because the viewport resized', () => {
    const store = makeStore();
    const { container, rerender } = render(row(store, 200));
    rerender(row(store, 320));
    expect(child(container, 'a').style.width).toBe('160px');
    expect(child(container, 'a').style.transition).toBe('');
  });

  it('comes back for a rearrange at the new size', () => {
    const store = makeStore();
    const { container, rerender } = render(row(store, 200));
    rerender(row(store, 320));
    store.setChildOrder(z, [asNodeId('b'), asNodeId('a')]);
    rerender(row(store, 320));
    expect(child(container, 'a').style.transition).toContain('200ms');
  });

  it('is kept on first render', () => {
    const { container } = render(row(makeStore(), 200));
    expect(child(container, 'a').style.transition).toContain('200ms');
  });
});

function SettleProbe() {
  return <output data-testid="settle">{useLayoutContext().settleMs}</output>;
}

function zone(w: number) {
  return (
    <Provider store={new Store()}>
      <StrategyRegistryProvider strategies={{ strip: stripStrategy as never }}>
        <Zone
          id={z}
          strategyId="strip"
          config={{ axis: 'x', fill: true }}
          viewport={{ w, h: 100 }}
          settleMs={200}
        >
          <Panel id={asNodeId('a')} />
          <SettleProbe />
        </Zone>
      </StrategyRegistryProvider>
    </Provider>
  );
}

describe('settle time a Zone hands its children across a viewport change', () => {
  it('is dropped on the render whose viewport resized', () => {
    const view = render(zone(200));
    expect(view.getByTestId('settle').textContent).toBe('200');
    view.rerender(zone(320));
    expect(view.getByTestId('settle').textContent).toBe('0');
  });
});
