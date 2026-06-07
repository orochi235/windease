export default { title: 'Binary split (resize)' };

import {
  asNodeId,
  binarySplit,
  createPanel,
  createZone,
  WindeaseStore,
} from '../../index.js';
import type { Story } from '@ladle/react';
import { useMemo } from 'react';
import {
  type ChromeMap,
  NodeContainer,
  StrategyRegistryProvider,
  WindeaseProvider,
} from '../index.js';
import './windease.css';
import { colorClassForId } from './Panel.js';

const STRATEGIES = {
  binarySplit: binarySplit as never,
};

interface Args {
  direction: 'horizontal' | 'vertical';
  gutterSize: number;
}

export const BinarySplit: Story<Args> = ({ direction, gutterSize }) => {
  const store = useMemo(() => {
    const s = new WindeaseStore();
    s.registerNode(
      createZone({
        id: asNodeId('split'),
        strategyId: 'binarySplit',
        config: { direction, gutterSize },
      }),
    );
    for (const id of ['left', 'right'] as const) {
      const nid = asNodeId(id);
      s.registerNode(
        createPanel({ id: nid, parentId: asNodeId('split'), meta: { title: id } }),
      );
      s.showNode(nid);
    }
    return s;
    // biome-ignore lint/correctness/useExhaustiveDependencies: rebuild on control change
  }, [direction, gutterSize]);

  const chrome: ChromeMap = useMemo(
    () => ({
      zone: ({ children }) => <>{children}</>,
      group: ({ node, children }) => (
        <div className={`story-panel ${colorClassForId(node.id)}`}>{children}</div>
      ),
      panel: ({ node }) => (
        <div className={`story-panel ${colorClassForId(node.id)}`}>
          <span className="story-panel__title">{String(node.meta?.title ?? node.id)}</span>
        </div>
      ),
    }),
    [],
  );

  return (
    <WindeaseProvider store={store}>
      <StrategyRegistryProvider strategies={STRATEGIES}>
        <div style={{ width: 600, height: 360, background: '#0f172a08', borderRadius: 8 }}>
          <NodeContainer
            parentId={asNodeId('split')}
            chrome={chrome}
            viewport={{ w: 600, h: 360 }}
            className="windease-zone"
            affordances
          />
        </div>
        <p style={{ marginTop: 12, font: '12px/1.4 system-ui, sans-serif', color: '#64748b' }}>
          Drag the gutter to resize. Ratio persists in the store's container-state
          side-channel (not snapshotted, not in undo history).
        </p>
      </StrategyRegistryProvider>
    </WindeaseProvider>
  );
};

BinarySplit.args = {
  direction: 'horizontal',
  gutterSize: 6,
};

BinarySplit.argTypes = {
  direction: { control: { type: 'radio' }, options: ['horizontal', 'vertical'] },
  gutterSize: { control: { type: 'range', min: 2, max: 20, step: 1 } },
};
