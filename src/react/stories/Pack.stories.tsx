export default { title: 'Pack' };

import type { Story } from '@ladle/react';
import { useMemo } from 'react';
import {
  asNodeId,
  columnStrategy,
  createNode,
  justifiedStrategy,
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

const POCKET_STRATEGIES = { ...STRATEGIES, justified: justifiedStrategy as never };

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

interface PocketArgs {
  strategy: 'shelf' | 'column' | 'skyline' | 'justified';
  width: number;
  height: number;
  gap: number;
  /** Both sides under this go to the pocket; 0 turns the pocket off. */
  pocketUnder: number;
  /** How many small boxes to add to the wall. */
  smalls: number;
}

/** Outlines the pocket — the hull of every box carrying a `pocket` channel. */
function PocketOverlay({ placements, unplaced, channels }: OverlayContext) {
  const ids = [...(channels ?? [])].filter(([, c]) => c.pocket === 1).map(([id]) => id);
  const rects = ids.map((id) => placements.get(id)).filter((r) => r !== undefined);
  const box = rects.length
    ? {
        x: Math.min(...rects.map((r) => r.x)),
        y: Math.min(...rects.map((r) => r.y)),
        right: Math.max(...rects.map((r) => r.x + r.w)),
        bottom: Math.max(...rects.map((r) => r.y + r.h)),
      }
    : null;
  return (
    <>
      {box ? (
        <div
          className="pack-demo__pocket"
          data-testid="pack-pocket"
          style={{ left: box.x, top: box.y, width: box.right - box.x, height: box.bottom - box.y }}
        >
          <span className="pack-demo__pocket-label">pocket</span>
        </div>
      ) : null}
      <p className="pack-demo__readout" data-testid="pocket-readout">
        {placements.size} placed, {unplaced.length} unplaced, {ids.length} pocketed
      </p>
    </>
  );
}

/** Small boxes, in a jumble of sizes the packers would otherwise scatter. */
const SMALL_BOXES: [number, number][] = [
  [28, 24],
  [20, 20],
  [34, 30],
  [24, 36],
  [30, 22],
  [22, 28],
  [36, 26],
  [26, 32],
  [32, 20],
  [20, 34],
  [30, 30],
  [24, 24],
];

export const Pocket: Story<PocketArgs> = ({
  strategy,
  width,
  height,
  gap,
  pocketUnder,
  smalls,
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
            ...(strategy === 'justified' ? { rowHeight: 120 } : {}),
            ...(pocketUnder > 0 ? { pocket: { w: pocketUnder, h: pocketUnder } } : {}),
          },
        },
      }),
    );
    const boxes: [number, number][] = [...BOXES.slice(0, 6), ...SMALL_BOXES.slice(0, smalls)];
    boxes.forEach(([w, h], i) => {
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
  }, [strategy, gap, pocketUnder, smalls]);

  const chrome: ChromeMap = useMemo(
    () => ({
      panel: ({ node }) => (
        <div className="windease-panel" data-testid="pocket-box">
          <header className="windease-panel__title">{String(node.meta?.title ?? node.id)}</header>
        </div>
      ),
    }),
    [],
  );

  return (
    <Provider store={store}>
      <StrategyRegistryProvider strategies={POCKET_STRATEGIES}>
        <div className="pack-demo">
          <Container
            parentId={ZONE_ID}
            chrome={chrome}
            viewport={{ w: width, h: height }}
            className="windease-zone windease-zone--unclipped pack-demo__zone"
            overlay={PocketOverlay}
          />
        </div>
      </StrategyRegistryProvider>
    </Provider>
  );
};

Pocket.args = {
  strategy: 'shelf',
  width: 480,
  height: 360,
  gap: 8,
  pocketUnder: 40,
  smalls: 8,
};

Pocket.argTypes = {
  strategy: {
    options: ['shelf', 'column', 'skyline', 'justified'],
    control: { type: 'radio' },
  },
  width: { control: { type: 'range', min: 240, max: 900, step: 10 } },
  height: { control: { type: 'range', min: 160, max: 900, step: 10 } },
  gap: { control: { type: 'range', min: 0, max: 32, step: 1 } },
  pocketUnder: { control: { type: 'range', min: 0, max: 80, step: 4 } },
  smalls: { control: { type: 'range', min: 0, max: 12, step: 1 } },
};
