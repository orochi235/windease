import {
  asNodeId,
  createPanel,
  createZone,
  stripStrategy,
  WindeaseNodeStore,
} from '@windease/core';
import type { Story } from '@ladle/react';
import { useMemo } from 'react';
import {
  type ChromeMap,
  NodeContainer,
  StrategyRegistryProvider,
  WindeaseNodeProvider,
} from '../../v2/index.js';
import '../windease.css';
import { colorClassForId } from '../Panel.js';

const STRATEGIES = {
  strip: stripStrategy as never,
};

function makeStripStore(axis: 'x' | 'y', sizes: number[]): WindeaseNodeStore {
  const s = new WindeaseNodeStore();
  const zoneId = asNodeId(`strip-${axis}`);
  s.registerNode(
    createZone({
      id: zoneId,
      strategyId: 'strip',
      config: { axis, gap: 6, padding: 6 },
    }),
  );
  sizes.forEach((size, i) => {
    const id = asNodeId(`tool-${axis}-${i + 1}`);
    const preferredSize = axis === 'x' ? { w: size, h: 0 } : { w: 0, h: size };
    s.registerNode(
      createPanel({
        id,
        parentId: zoneId,
        hints: { preferredSize },
        meta: {
          title: axis === 'x' ? `x (w=${size})` : `y (h=${size})`,
        },
      }),
    );
    s.showNode(id);
  });
  return s;
}

const chrome: ChromeMap = {
  panel: ({ node }) => (
    <div className={`story-panel ${colorClassForId(node.id)}`}>
      <span className="story-panel__title">
        {String(node.meta?.title ?? node.id)}
      </span>
    </div>
  ),
};

export const HorizontalStrip: Story = () => {
  const store = useMemo(() => makeStripStore('x', [80, 120, 160, 100]), []);
  return (
    <WindeaseNodeProvider store={store}>
      <StrategyRegistryProvider strategies={STRATEGIES}>
        <div style={{ width: 600, height: 100 }}>
          <NodeContainer
            parentId={asNodeId('strip-x')}
            chrome={chrome}
            viewport={{ w: 600, h: 100 }}
            className="windease-zone"
          />
        </div>
      </StrategyRegistryProvider>
    </WindeaseNodeProvider>
  );
};

export const VerticalStrip: Story = () => {
  const store = useMemo(() => makeStripStore('y', [60, 90, 60, 120]), []);
  return (
    <WindeaseNodeProvider store={store}>
      <StrategyRegistryProvider strategies={STRATEGIES}>
        <div style={{ width: 220, height: 420 }}>
          <NodeContainer
            parentId={asNodeId('strip-y')}
            chrome={chrome}
            viewport={{ w: 220, h: 420 }}
            className="windease-zone"
          />
        </div>
      </StrategyRegistryProvider>
    </WindeaseNodeProvider>
  );
};
