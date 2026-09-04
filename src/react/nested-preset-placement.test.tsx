import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { asNodeId, Store } from '../index.js';
import { stripStrategy } from '../layout/strip.js';
import { Panel, Provider, StrategyRegistryProvider, Zone } from './index.js';

/** The wrapper a strategy-computed rect is applied to, or the element itself
 *  when `<Container>` renders it. */
const boxOf = (root: HTMLElement, id: string) =>
  (root.querySelector(`[data-node="${id}"]`)?.parentElement as HTMLElement | null)?.getAttribute(
    'style',
  );

describe('a nested container preset is placed by its parent strategy', () => {
  it('places a <Zone> and a <Panel container> alongside a leaf sibling', () => {
    const store = new Store();
    const { container } = render(
      <Provider store={store}>
        <StrategyRegistryProvider strategies={{ stack: stripStrategy as never }}>
          <Zone
            id={asNodeId('root')}
            strategyId="stack"
            config={{ axis: 'x', fill: true }}
            viewport={{ w: 600, h: 300 }}
          >
            <Zone id={asNodeId('left')} strategyId="stack" config={{ axis: 'y', fill: true }} />
            <Panel
              id={asNodeId('mid')}
              container={{ strategyId: 'stack', config: { axis: 'y', fill: true } }}
            />
            <Panel id={asNodeId('right')} />
          </Zone>
        </StrategyRegistryProvider>
      </Provider>,
    );

    expect(boxOf(container, 'left')).toContain('left: 0px');
    expect(boxOf(container, 'mid')).toContain('left: 200px');
    expect(boxOf(container, 'right')).toContain('left: 400px');
  });
});
