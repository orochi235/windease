import { render, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
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
    s.setMeta(nid, { title: c === 'a' ? 'Editor' : 'Preview' });
  }
  return s;
}

function tree(store: Store, focus: ReactNode) {
  return (
    <Provider store={store}>
      <StrategyRegistryProvider strategies={{ strip: stripStrategy as never }}>
        <GeometryProvider>{focus}</GeometryProvider>
      </StrategyRegistryProvider>
    </Provider>
  );
}

const zone = <Container parentId={asNodeId('z')} chrome={{}} viewport={{ w: 200, h: 100 }} />;

function liveRegion(container: HTMLElement): HTMLElement | null {
  return container.querySelector('.windease-live-region');
}

describe('FocusProvider announcements', () => {
  it('renders a polite live region, empty until something happens', () => {
    const { container } = render(tree(makeStore(), <FocusProvider>{zone}</FocusProvider>));
    const region = liveRegion(container);
    expect(region).not.toBeNull();
    expect(region?.getAttribute('aria-live')).toBe('polite');
    expect(region?.textContent).toBe('');
  });

  it('speaks the departure when the focused pane is destroyed', async () => {
    const store = makeStore();
    const { container } = render(tree(store, <FocusProvider>{zone}</FocusProvider>));
    store.focusNode(asNodeId('a'));
    store.unregisterNode(asNodeId('a'));
    await waitFor(() => expect(liveRegion(container)?.textContent).toBe('Editor closed'));
  });

  it('replaces the spoken node so an identical message is announced twice', async () => {
    const store = makeStore();
    const { container } = render(tree(store, <FocusProvider>{zone}</FocusProvider>));
    store.focusNode(asNodeId('a'));
    store.reorderInParent(asNodeId('a'), 1);
    await waitFor(() =>
      expect(liveRegion(container)?.textContent).toBe('Editor moved to position 2 of 2'),
    );
    const first = liveRegion(container)?.firstElementChild;
    store.reorderInParent(asNodeId('a'), 0);
    await waitFor(() =>
      expect(liveRegion(container)?.textContent).toBe('Editor moved to position 1 of 2'),
    );
    expect(liveRegion(container)?.firstElementChild).not.toBe(first);
  });

  it('renders no live region when announcements are turned off', async () => {
    const store = makeStore();
    const { container } = render(
      tree(
        store,
        <FocusProvider announce={false}>
          <Container parentId={asNodeId('z')} chrome={{}} viewport={{ w: 200, h: 100 }} />
        </FocusProvider>,
      ),
    );
    store.focusNode(asNodeId('a'));
    store.unregisterNode(asNodeId('a'));
    await waitFor(() => expect(store.focusedId).toBe(asNodeId('b')));
    expect(liveRegion(container)).toBeNull();
  });
});
