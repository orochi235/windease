export default { title: 'Stack' };

import type { Story } from '@ladle/react';
import { useMemo } from 'react';
import { Store, asNodeId, createPanel, createZone, stackStrategy } from '../../index.js';
import { type ChromeMap, Container, Provider, StrategyRegistryProvider } from '../index.js';
import './windease.css';

const STRATEGIES = {
  stack: stackStrategy as never,
};

const ZONE_ID = asNodeId('stack');

interface Args {
  gap: number;
  padding: number;
}

export const Stack: Story<Args> = ({ gap, padding }) => {
  const store = useMemo(() => {
    const s = new Store();
    s.registerNode(
      createZone({
        id: ZONE_ID,
        strategyId: 'stack',
        config: { gap, padding },
      }),
    );
    const heights = [80, 140, 200];
    heights.forEach((h, i) => {
      const id = asNodeId(`stack-${i + 1}`);
      s.registerNode(
        createPanel({
          id,
          parentId: ZONE_ID,
          hints: { preferredSize: { w: 0, h } },
          meta: { title: `Item (h=${h}px)` },
        }),
      );
      s.showNode(id);
    });
    return s;
  }, [gap, padding]);

  const chrome: ChromeMap = useMemo(
    () => ({
      panel: ({ node }) => (
        <div className="windease-panel">
          <header className="windease-panel__title">{String(node.meta?.title ?? node.id)}</header>
        </div>
      ),
    }),
    [],
  );

  return (
    <Provider store={store}>
      <StrategyRegistryProvider strategies={STRATEGIES}>
        <div style={{ width: 260, height: 500 }}>
          <Container
            parentId={ZONE_ID}
            chrome={chrome}
            viewport={{ w: 260, h: 500 }}
            className="windease-zone"
          />
        </div>
      </StrategyRegistryProvider>
    </Provider>
  );
};

Stack.args = {
  gap: 8,
  padding: 8,
};

Stack.argTypes = {
  gap: { control: { type: 'range', min: 0, max: 32, step: 1 } },
  padding: { control: { type: 'range', min: 0, max: 32, step: 1 } },
};
