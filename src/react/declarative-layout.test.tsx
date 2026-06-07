import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Store, asNodeId, createPanel, gridStrategy } from '../index.js';
import { Provider } from './Provider.js';
import { Panel, Zone } from './presets.js';
import { StrategyRegistryProvider } from './strategies.js';

afterEach(cleanup);

describe('declarative layout via strategy', () => {
  it('Zone absolute-positions JSX children via the grid strategy', () => {
    const store = new Store();
    const { container } = render(
      <Provider store={store}>
        <StrategyRegistryProvider strategies={{ grid: gridStrategy }}>
          <Zone
            id={asNodeId('z')}
            strategyId="grid"
            config={{ cols: 2 }}
            viewport={{ w: 200, h: 100 }}
          >
            <Panel id={asNodeId('a')} data-testid="a" />
            <Panel id={asNodeId('b')} data-testid="b" />
          </Zone>
        </StrategyRegistryProvider>
      </Provider>,
    );
    const aEl = container.querySelector('[data-testid="a"]');
    expect(aEl).toBeTruthy();
    // Walk up to the positioned wrapper. The wrapper is the parent of the
    // windease-panel div.
    const aWrapper = aEl?.parentElement;
    expect(aWrapper?.style.position).toBe('absolute');
    expect(aWrapper?.style.width).toBeTruthy();
    expect(aWrapper?.style.height).toBeTruthy();
  });

  it('Zone renderImperative renders store-only children at their rects', async () => {
    const store = new Store();
    const { container } = render(
      <Provider store={store}>
        <StrategyRegistryProvider strategies={{ grid: gridStrategy }}>
          <Zone
            id={asNodeId('z')}
            strategyId="grid"
            config={{ cols: 2 }}
            viewport={{ w: 200, h: 100 }}
            renderImperative={(node) => (
              <div data-testid={`imp-${node.id}`}>{String(node.id)}</div>
            )}
          >
            <Panel id={asNodeId('jsx-a')} data-testid="jsx-a" />
          </Zone>
        </StrategyRegistryProvider>
      </Provider>,
    );

    // No imperative children yet.
    expect(container.querySelector('[data-testid="imp-imp-1"]')).toBeNull();

    await act(async () => {
      store.registerNode(
        createPanel({ id: asNodeId('imp-1'), parentId: asNodeId('z') }),
      );
      store.showNode(asNodeId('imp-1'));
    });

    const impEl = container.querySelector('[data-testid="imp-imp-1"]');
    expect(impEl).toBeTruthy();
    const wrapper = impEl?.parentElement;
    expect(wrapper?.style.position).toBe('absolute');
    expect(wrapper?.style.width).toBeTruthy();
    expect(wrapper?.style.height).toBeTruthy();
  });
});
