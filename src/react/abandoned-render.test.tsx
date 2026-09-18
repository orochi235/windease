import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { asNodeId, Store, stripStrategy } from '../index.js';
import { Provider } from './Provider.js';
import { Panel, Zone } from './presets.js';
import { StrategyRegistryProvider } from './strategies.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('a child that throws while rendering', () => {
  it('surfaces its own error, not a collision on the parent it aborted', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() =>
      render(
        <Provider store={new Store()}>
          <StrategyRegistryProvider strategies={{ strip: stripStrategy as never }}>
            <Zone id={asNodeId('z')} strategyId="strip">
              <Panel id={asNodeId('a')} />
              <Panel id={asNodeId('b')} placement={{ pinned: 0 }} />
            </Zone>
          </StrategyRegistryProvider>
        </Provider>,
      ),
    ).toThrow(/use the dedicated `pinned` prop/);
  });

  it('still reports two mounted presets that really share an id', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() =>
      render(
        <Provider store={new Store()}>
          <StrategyRegistryProvider strategies={{ strip: stripStrategy as never }}>
            <Zone id={asNodeId('z')} strategyId="strip">
              <Panel id={asNodeId('a')} />
              <Panel id={asNodeId('a')} />
            </Zone>
          </StrategyRegistryProvider>
        </Provider>,
      ),
    ).toThrow(/already mounted by another/);
  });
});
