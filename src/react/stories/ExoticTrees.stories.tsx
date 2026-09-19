export default { title: 'Exotic / Trees' };

import type { Story } from '@ladle/react';
import { useMemo } from 'react';
import { asNodeId, type NodeId } from '../../index.js';
import { type Preset, presetToStore } from '../../test-utils/exotic/preset.js';
import {
  GOLDEN_PRESET,
  I3_PRESET,
  PRESETS,
  TREE_STRATEGIES,
} from '../../test-utils/exotic/tree-scenarios.js';
import {
  type ChromeMap,
  Container,
  DragHandle,
  DragProvider,
  Provider,
  StrategyRegistryProvider,
  useStack,
} from '../index.js';
import '../styles.css';
import './exotic-trees.css';
import { PresetInfo } from './PresetInfo.js';
import { PresetPicker, usePresetPick } from './PresetPicker.js';
import { PresetCode } from './presetCode.js';

/** Every tree was saved for a bigger screen; its shares scale down in proportion. */
const VIEWPORT = { w: 960, h: 540 };

function TabStrip({ id, stacked }: { id: NodeId; stacked: boolean }) {
  const { tabs, activeId, activate } = useStack(id);
  return (
    <div className={stacked ? 'xt-tabs xt-tabs--stacked' : 'xt-tabs'} role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          className="xt-tab"
          data-testid={`xt-tab-${tab.id}`}
          aria-selected={tab.id === activeId}
          onClick={() => activate(tab.id)}
        >
          {tab.title}
        </button>
      ))}
    </div>
  );
}

const chrome: ChromeMap = {
  group: ({ node }) => {
    const stack = node.container?.strategyId === 'stack';
    const header = (node.container?.config as { headerSize?: number } | undefined)?.headerSize;
    if (stack) {
      return (
        <div className="xt-stack" data-testid={`xt-group-${node.id}`}>
          <TabStrip id={node.id} stacked={(header ?? 0) > 30} />
          <Container parentId={node.id} chrome={chrome} className="xt-fill" />
        </div>
      );
    }
    const axis = (node.container?.config as { axis?: string } | undefined)?.axis ?? 'x';
    return (
      <div className={`xt-split xt-split--${axis}`} data-testid={`xt-group-${node.id}`}>
        <Container parentId={node.id} chrome={chrome} affordances className="xt-fill" />
      </div>
    );
  },
  panel: ({ node }) => {
    const share = (node.membership?.placement as { share?: number } | undefined)?.share;
    return (
      <DragHandle nodeId={node.id} className="xt-pane">
        <header className="xt-pane__title" data-testid={`xt-pane-${node.id}`}>
          {String(node.meta?.title ?? node.id)}
        </header>
        <p className="xt-pane__size">
          {share === undefined ? 'no placement.share' : `placement.share ${share.toFixed(3)}`}
        </p>
      </DragHandle>
    );
  },
};

function Tree({ preset }: { preset: Preset }) {
  const store = useMemo(() => presetToStore(preset), [preset]);
  return (
    <Provider store={store}>
      <StrategyRegistryProvider strategies={TREE_STRATEGIES}>
        <DragProvider>
          <PresetInfo preset={preset} />
          <div className="xt-frame">
            <Container
              parentId={asNodeId(preset.mechanics.id)}
              chrome={chrome}
              viewport={VIEWPORT}
              affordances
              className="windease-zone xt-zone"
            />
          </div>
          <PresetCode preset={preset} viewport={VIEWPORT} />
          <div className="xt-prose">
            <p>
              Drag a pane into a container of another kind: a horizontal split into a vertical one,
              or a split into a tab stack. A tab stack shows the pane it receives and fills its body
              with it. The pane keeps the <code>placement.share</code> it was saved with, and a
              share names no axis, so in a split on the other axis a share of a width becomes a
              share of the height. A pane saved as a tab has no share, and in a split whose shares
              already add up to the whole it gets the leftover, which is nothing.
            </p>
          </div>
        </DragProvider>
      </StrategyRegistryProvider>
    </Provider>
  );
}

/** The i3 workspace from `tree-scenarios.ts`: six nested levels of splith, splitv, tabbed and stacked. */
export const SwayWorkspace: Story = () => <Tree preset={I3_PRESET} />;

/** The Golden Layout IDE config, rows and columns of stacks with percentage sizes. */
export const GoldenLayout: Story = () => <Tree preset={GOLDEN_PRESET} />;

/** Every tree preset, from i3 and Golden Layout to Emacs side windows and the trading desk. */
export const Presets: Story = () => {
  const [preset, pick] = usePresetPick(PRESETS);
  return (
    <>
      <PresetPicker presets={PRESETS} value={preset} onChange={pick} />
      <Tree key={preset.id} preset={preset} />
    </>
  );
};
