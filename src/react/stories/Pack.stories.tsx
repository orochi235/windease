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
import {
  type ChromeMap,
  Container,
  type OverlayContext,
  Provider,
  StrategyRegistryProvider,
} from '../index.js';
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
  rotate: boolean;
  overflowMode: 'scroll' | 'unplaced';
  /** Column only; 0 leaves it unset. */
  cols: number;
  /** Column only; 0 leaves it unset, so the narrowest box sets it. */
  columnWidth: number;
  /** Column only, and only without `cols`. */
  justify: 'start' | 'center' | 'end';
}

/** The count readout, and a ↻ on every box the packer turned, read from its
 *  `rotation` channel. */
function PackOverlay({ placements, unplaced, channels }: OverlayContext) {
  const turned = [...(channels ?? [])].filter(([, c]) => c.rotation === 90);
  return (
    <>
      {turned.map(([id]) => {
        const rect = placements.get(id);
        return rect ? (
          <span
            key={id}
            className="pack-demo__turned"
            data-turned={id}
            title="turned a quarter"
            style={{ left: rect.x, top: rect.y }}
          >
            ↻
          </span>
        ) : null;
      })}
      <p className="pack-demo__readout" data-testid="pack-readout">
        {placements.size} placed, {unplaced.length} unplaced
        {channels ? `, ${turned.length} turned` : ''}
      </p>
    </>
  );
}

export const PackedBoxes: Story<Args> = ({
  strategy,
  width,
  height,
  gap,
  sort,
  rotate,
  overflowMode,
  cols,
  columnWidth,
  justify,
}) => {
  const store = useMemo(() => {
    const s = new Store();
    s.registerNode(
      createNode({
        kind: 'zone',
        id: ZONE_ID,
        container: {
          strategyId: strategy,
          config: {
            gap,
            sort,
            rotate,
            overflowMode,
            ...(strategy === 'column'
              ? {
                  justify,
                  ...(cols > 0 ? { cols } : columnWidth > 0 ? { columnWidth } : {}),
                }
              : {}),
          },
        },
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
  }, [strategy, gap, sort, rotate, overflowMode, cols, columnWidth, justify]);

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
            overlay={PackOverlay}
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
  rotate: false,
  overflowMode: 'scroll',
  cols: 0,
  columnWidth: 0,
  justify: 'start',
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
  rotate: { control: { type: 'boolean' } },
  overflowMode: { options: ['scroll', 'unplaced'], control: { type: 'radio' } },
  cols: { control: { type: 'range', min: 0, max: 8, step: 1 } },
  columnWidth: { control: { type: 'range', min: 0, max: 240, step: 10 } },
  justify: { options: ['start', 'center', 'end'], control: { type: 'radio' } },
};
