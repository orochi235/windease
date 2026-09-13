export default { title: 'Pack' };

import type { Story } from '@ladle/react';
import { useMemo } from 'react';
import {
  asNodeId,
  columnStrategy,
  createNode,
  Store,
  shelfStrategy,
  skylineStrategy,
} from '../../index.js';
import { type ChromeMap, Container, Provider, StrategyRegistryProvider } from '../index.js';
import './pack.css';
import './windease.css';

const STRATEGIES = {
  shelf: shelfStrategy as never,
  column: columnStrategy as never,
  skyline: skylineStrategy as never,
};

const ZONE_ID = asNodeId('pack');

/** Tallest first, the order a caller packing for density would hand over. */
const BOXES: [number, number][] = [
  [140, 220],
  [90, 180],
  [200, 150],
  [70, 140],
  [120, 120],
  [160, 100],
  [60, 90],
  [110, 80],
  [80, 70],
  [150, 60],
  [60, 50],
  [100, 40],
  [70, 40],
  [90, 30],
];

interface Args {
  strategy: 'shelf' | 'column' | 'skyline';
  width: number;
  gap: number;
}

export const PackedBoxes: Story<Args> = ({ strategy, width, gap }) => {
  const store = useMemo(() => {
    const s = new Store();
    s.registerNode(
      createNode({
        kind: 'zone',
        id: ZONE_ID,
        container: { strategyId: strategy, config: { gap } },
      }),
    );
    BOXES.forEach(([w, h], i) => {
      const id = asNodeId(`box-${i + 1}`);
      s.registerNode(
        createNode({
          kind: 'panel',
          focus: true,
          id,
          parentId: ZONE_ID,
          hints: { preferredSize: { w, h } },
          meta: { title: `${w}×${h}` },
        }),
      );
      s.showNode(id);
    });
    return s;
  }, [strategy, gap]);

  const chrome: ChromeMap = useMemo(
    () => ({
      panel: ({ node }) => (
        <div className="windease-panel" data-testid="pack-box">
          <header className="windease-panel__title">{String(node.meta?.title ?? node.id)}</header>
        </div>
      ),
    }),
    [],
  );

  return (
    <Provider store={store}>
      <StrategyRegistryProvider strategies={STRATEGIES}>
        <div className="pack-demo">
          <Container
            parentId={ZONE_ID}
            chrome={chrome}
            viewport={{ w: width, h: 360 }}
            className="windease-zone windease-zone--unclipped"
          />
        </div>
      </StrategyRegistryProvider>
    </Provider>
  );
};

PackedBoxes.args = { strategy: 'skyline', width: 480, gap: 8 };

PackedBoxes.argTypes = {
  strategy: { options: ['shelf', 'column', 'skyline'], control: { type: 'radio' } },
  width: { control: { type: 'range', min: 160, max: 900, step: 10 } },
  gap: { control: { type: 'range', min: 0, max: 32, step: 1 } },
};
