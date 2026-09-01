import { asNodeId, stripStrategy } from '../index.js';
import { Panel, Provider, StrategyRegistryProvider, Zone } from '../react/index.js';
import '../react/styles.css';
import './demos.css';

const strategies = { strip: stripStrategy as never };

/** Exactly the snippet in chapter 1.2 — kept in one place so the page cannot
 *  claim an output it does not produce. */
export function FirstTree() {
  return (
    <Provider>
      <StrategyRegistryProvider strategies={strategies}>
        <Zone
          strategyId="strip"
          config={{ axis: 'x', gap: 8, padding: 8, fill: true }}
          viewport={{ w: 420, h: 160 }}
          className="gd-zone"
        >
          <Panel id={asNodeId('left')} className="gd-pane">
            left
          </Panel>
          <Panel id={asNodeId('right')} className="gd-pane">
            right
          </Panel>
        </Zone>
      </StrategyRegistryProvider>
    </Provider>
  );
}
