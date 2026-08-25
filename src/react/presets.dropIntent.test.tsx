import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { childRectsForContainer } from '../dnd/insertionIndex.js';
import { asNodeId, Store, stripStrategy } from '../index.js';
import { Panel, Provider, StrategyRegistryProvider, Zone } from './index.js';

const STRATEGIES = { strip: stripStrategy as never };

describe('preset DOM contract', () => {
  it('harvests a zone’s own panes, not its grandchildren', () => {
    const store = new Store();
    const { container } = render(
      <Provider store={store}>
        <StrategyRegistryProvider strategies={STRATEGIES}>
          <Zone
            id={asNodeId('outer')}
            strategyId="strip"
            config={{ axis: 'x', fill: true }}
            viewport={{ w: 200, h: 100 }}
          >
            <Panel id={asNodeId('a')} />
            <Zone id={asNodeId('inner')} strategyId="strip" config={{ axis: 'y', fill: true }}>
              <Panel id={asNodeId('deep')} />
            </Zone>
          </Zone>
        </StrategyRegistryProvider>
      </Provider>,
    );
    const outer = container.querySelector('[data-node="outer"]') as HTMLElement;
    expect(childRectsForContainer(outer).map((r) => r.id)).toEqual(['a', 'inner']);
  });
});
