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

/** In no particular order, so `sort` has something to do. */
const BOXES: [number, number][] = [
  [110, 80],
  [60, 50],
  [200, 150],
  [90, 30],
  [70, 140],
  [150, 60],
  [140, 220],
  [80, 70],
  [120, 120],
  [100, 40],
  [60, 90],
  [160, 100],
  [70, 40],
  [90, 180],
];

interface Args {
  strategy: 'shelf' | 'column' | 'skyline';
  width: number;
  gap: number;
  height: number;
  sort: 'none' | 'height' | 'width' | 'area' | 'max-side';
  overflowMode: 'scroll' | 'unplaced';
}

export const PackedBoxes: Story<Args> = ({ strategy, width, height, gap, sort, overflowMode }) => {
  const store = useMemo(() => {
    const s = new Store();
    s.registerNode(
      createNode({
        kind: 'zone',
        id: ZONE_ID,
        container: { strategyId: strategy, config: { gap, sort, overflowMode } },
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
  }, [strategy, gap, sort, overflowMode]);

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
            viewport={{ w: width, h: height }}
            className="windease-zone windease-zone--unclipped pack-demo__zone"
            overlay={({ placements, unplaced }) => (
              <p className="pack-demo__readout" data-testid="pack-readout">
                {placements.size} placed, {unplaced.length} unplaced
              </p>
            )}
          />
        </div>
      </StrategyRegistryProvider>
    </Provider>
  );
};

PackedBoxes.args = {
  strategy: 'skyline',
  width: 480,
  height: 360,
  gap: 8,
  sort: 'none',
  overflowMode: 'scroll',
};

PackedBoxes.argTypes = {
  strategy: { options: ['shelf', 'column', 'skyline'], control: { type: 'radio' } },
  width: { control: { type: 'range', min: 160, max: 900, step: 10 } },
  height: { control: { type: 'range', min: 120, max: 900, step: 10 } },
  gap: { control: { type: 'range', min: 0, max: 32, step: 1 } },
  sort: {
    options: ['none', 'height', 'width', 'area', 'max-side'],
    control: { type: 'radio' },
  },
  overflowMode: { options: ['scroll', 'unplaced'], control: { type: 'radio' } },
};
