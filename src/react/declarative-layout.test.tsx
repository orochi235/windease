import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Store, asNodeId, gridStrategy } from '../index.js';
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
});
