import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { asNodeId, Store, stackStrategy } from '../index.js';
import { Provider } from './Provider.js';
import { Panel, Zone } from './presets.js';
import { StrategyRegistryProvider } from './strategies.js';

afterEach(cleanup);

const STRATEGIES = { stack: stackStrategy as never };

describe('a child a strategy withheld', () => {
  it('renders nothing', () => {
    const { queryByTestId } = render(
      <Provider store={new Store()}>
        <StrategyRegistryProvider strategies={STRATEGIES}>
          <Zone
            id={asNodeId('z')}
            strategyId="stack"
            config={{ activeId: 'b', headerSize: 24 }}
            viewport={{ w: 300, h: 200 }}
          >
            <Panel id={asNodeId('a')} data-testid="a" />
            <Panel id={asNodeId('b')} data-testid="b" />
            <Panel id={asNodeId('c')} data-testid="c" />
          </Zone>
        </StrategyRegistryProvider>
      </Provider>,
    );
    expect(queryByTestId('b')).toBeTruthy();
    expect(queryByTestId('a')).toBeNull();
    expect(queryByTestId('c')).toBeNull();
  });

  it('follows activeId when the store changes it', () => {
    const store = new Store();
    const { queryByTestId } = render(
      <Provider store={store}>
        <StrategyRegistryProvider strategies={STRATEGIES}>
          <Zone
            id={asNodeId('z')}
            strategyId="stack"
            config={{ activeId: 'a', headerSize: 24 }}
            viewport={{ w: 300, h: 200 }}
          >
            <Panel id={asNodeId('a')} data-testid="a" />
            <Panel id={asNodeId('b')} data-testid="b" />
          </Zone>
        </StrategyRegistryProvider>
      </Provider>,
    );
    expect(queryByTestId('a')).toBeTruthy();
    expect(queryByTestId('b')).toBeNull();
    act(() => {
      store.updateContainerConfig(asNodeId('z'), { activeId: 'b' });
    });
    expect(queryByTestId('b')).toBeTruthy();
    expect(queryByTestId('a')).toBeNull();
  });
});

describe('a child no strategy withheld', () => {
  // These two are why `unplaced` can carry the signal at all: both report an
  // empty list because no strategy ran, so membership means "withheld" and
  // never "nobody placed me".
  it('still renders under flow mode', () => {
    const { queryByTestId } = render(
      <Provider store={new Store()}>
        <StrategyRegistryProvider strategies={STRATEGIES}>
          <Zone id={asNodeId('z')} hints={{ render: 'flow' }}>
            <Panel id={asNodeId('a')} data-testid="a" />
            <Panel id={asNodeId('b')} data-testid="b" />
          </Zone>
        </StrategyRegistryProvider>
      </Provider>,
    );
    expect(queryByTestId('a')).toBeTruthy();
    expect(queryByTestId('b')).toBeTruthy();
  });

  it('still renders with no strategy registry above it', () => {
    const { queryByTestId } = render(
      <Provider store={new Store()}>
        <Zone id={asNodeId('z')} strategyId="stack">
          <Panel id={asNodeId('a')} data-testid="a" />
          <Panel id={asNodeId('b')} data-testid="b" />
        </Zone>
      </Provider>,
    );
    expect(queryByTestId('a')).toBeTruthy();
    expect(queryByTestId('b')).toBeTruthy();
  });
});
