export default { title: 'v0.2 / Grid' };

import {
  asNodeId,
  createPanel,
  createZone,
  gridStrategy,
  WindeaseNodeStore,
} from '../../../index.js';
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
  grid: gridStrategy as never,
};

const ZONE_ID = asNodeId('grid');

interface Args {
  cols: number;
  gap: number;
  padding: number;
  panelCount: number;
}

export const Grid: Story<Args> = ({ cols, gap, padding, panelCount }) => {
  const store = useMemo(() => {
    const s = new WindeaseNodeStore();
    s.registerNode(
      createZone({
        id: ZONE_ID,
        strategyId: 'grid',
        config: { cols, gap, padding },
      }),
    );
    for (let i = 0; i < panelCount; i++) {
      const id = asNodeId(`panel-${i + 1}`);
      s.registerNode(
        createPanel({ id, parentId: ZONE_ID, meta: { title: `Window ${id}` } }),
      );
      s.showNode(id);
    }
    return s;
    // biome-ignore lint/correctness/useExhaustiveDependencies: rebuild store when controls change
  }, [cols, gap, padding, panelCount]);

  const chrome: ChromeMap = useMemo(
    () => ({
      panel: ({ node }) => (
        <div className={`story-panel ${colorClassForId(node.id)}`}>
          <span className="story-panel__title">
            {String(node.meta?.title ?? `Window ${node.id}`)}
          </span>
        </div>
      ),
    }),
    [],
  );

  return (
    <WindeaseNodeProvider store={store}>
      <StrategyRegistryProvider strategies={STRATEGIES}>
        <div style={{ width: 480, height: 360 }}>
          <NodeContainer
            parentId={ZONE_ID}
            chrome={chrome}
            viewport={{ w: 480, h: 360 }}
            className="windease-zone"
          />
        </div>
      </StrategyRegistryProvider>
    </WindeaseNodeProvider>
  );
};

Grid.args = {
  cols: 2,
  gap: 8,
  padding: 8,
  panelCount: 4,
};

Grid.argTypes = {
  cols: { control: { type: 'range', min: 1, max: 6, step: 1 } },
  gap: { control: { type: 'range', min: 0, max: 32, step: 1 } },
  padding: { control: { type: 'range', min: 0, max: 32, step: 1 } },
  panelCount: { control: { type: 'range', min: 1, max: 12, step: 1 } },
};
