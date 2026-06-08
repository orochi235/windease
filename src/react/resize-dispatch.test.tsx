import { render, cleanup, act } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { Provider } from './Provider.js';
import { StrategyRegistryProvider } from './strategies.js';
import { asNodeId, Store, stackStrategy } from '../index.js';
import { createPanel, createZone } from '../constructors.js';
import { useContainerLayout, type ContainerLayout } from './useContainerLayout.js';

afterEach(cleanup);

describe('resize affordance dispatch wiring', () => {
  it('useContainerLayout routes resize events to strategy.dispatchAffordance', () => {
    const store = new Store();
    store.registerNode(createZone({ id: asNodeId('z'), strategyId: 'stack' }));
    store.registerNode(createPanel({ id: asNodeId('a'), parentId: asNodeId('z') }));
    store.registerNode(createPanel({ id: asNodeId('b'), parentId: asNodeId('z') }));
    store.showNode(asNodeId('a'));
    store.showNode(asNodeId('b'));

    let layoutCapture: ContainerLayout | null = null;
    function Probe({ capture }: { capture: (l: ContainerLayout) => void }) {
      const ref = useRef<HTMLDivElement>(null);
      const layout = useContainerLayout(asNodeId('z'), ref, { w: 100, h: 400 });
      capture(layout);
      return <div ref={ref} />;
    }

    render(
      <Provider store={store}>
        <StrategyRegistryProvider strategies={{ stack: stackStrategy } as never}>
          <Probe
            capture={(l) => {
              layoutCapture = l;
            }}
          />
        </StrategyRegistryProvider>
      </Provider>,
    );

    expect(layoutCapture).not.toBeNull();
    act(() => {
      layoutCapture!.dispatchAffordance({
        affordanceId: 'resize-y-a',
        kind: 'drag',
        payload: { dx: 0, dy: 30 },
      } as never);
    });
    const placement = store.getNode(asNodeId('a'))?.slot?.placement as
      | { size?: { h: number } }
      | undefined;
    expect(placement?.size?.h).toBeGreaterThan(0);
  });
});
