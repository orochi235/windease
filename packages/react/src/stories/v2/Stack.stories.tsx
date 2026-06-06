import {
  asNodeId,
  createPanel,
  createZone,
  stackStrategy,
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
  stack: stackStrategy as never,
};

const ZONE_ID = asNodeId('stack');

interface Args {
  gap: number;
  padding: number;
}

export const Stack: Story<Args> = ({ gap, padding }) => {
  const store = useMemo(() => {
    const s = new WindeaseNodeStore();
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
    // biome-ignore lint/correctness/useExhaustiveDependencies: rebuild on control change
  }, [gap, padding]);

  const chrome: ChromeMap = useMemo(
    () => ({
      panel: ({ node }) => (
        <div className={`story-panel ${colorClassForId(node.id)}`}>
          <span className="story-panel__title">
            {String(node.meta?.title ?? node.id)}
          </span>
        </div>
      ),
    }),
    [],
  );

  return (
    <WindeaseNodeProvider store={store}>
      <StrategyRegistryProvider strategies={STRATEGIES}>
        <div style={{ width: 260, height: 500 }}>
          <NodeContainer
            parentId={ZONE_ID}
            chrome={chrome}
            viewport={{ w: 260, h: 500 }}
            className="windease-zone"
          />
        </div>
      </StrategyRegistryProvider>
    </WindeaseNodeProvider>
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
