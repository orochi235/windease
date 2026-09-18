export default { title: 'Exotic / Trees' };

import type { Story } from '@ladle/react';
import { useEffect, useMemo, useState } from 'react';
import { asNodeId, type NodeId, type Store } from '../../index.js';
import { type Preset, presetToStore } from '../../test-utils/exotic/preset.js';
import {
  GOLDEN_PRESET,
  I3_PRESET,
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

/** Both trees were saved for a bigger screen; every pixel size squeezes in proportion. */
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
    const size = (node.membership?.placement as { size?: { w?: number; h?: number } } | undefined)
      ?.size;
    return (
      <DragHandle nodeId={node.id} className="xt-pane">
        <header className="xt-pane__title" data-testid={`xt-pane-${node.id}`}>
          {String(node.meta?.title ?? node.id)}
        </header>
        <p className="xt-pane__size">
          {size ? `placement.size ${JSON.stringify(size)}` : 'no placement.size'}
        </p>
      </DragHandle>
    );
  },
};

/** A drop into a tab stack brings the dropped pane to the front, as i3 and Golden Layout do. */
function useFrontOnDrop(store: Store): string {
  const [last, setLast] = useState('none yet');
  useEffect(
    () =>
      store.events.on('node.moved', ({ id, toParentId }) => {
        // Deferred: the move is still mid-transit when it announces itself.
        if (store.getNode(toParentId)?.container?.strategyId === 'stack') {
          queueMicrotask(() => store.setActiveChild(toParentId, id));
        }
        setLast(`${id} → ${toParentId}`);
      }),
    [store],
  );
  return last;
}

function Tree({ preset }: { preset: Preset }) {
  const store = useMemo(() => presetToStore(preset), [preset]);
  const last = useFrontOnDrop(store);
  return (
    <Provider store={store}>
      <StrategyRegistryProvider strategies={TREE_STRATEGIES}>
        <DragProvider>
          <dl className="xt-caption">
            <dt>Source</dt>
            <dd>{preset.source}</dd>
            <dt>Stresses</dt>
            <dd>{preset.stress}</dd>
          </dl>
          <div className="xt-frame">
            <Container
              parentId={asNodeId(preset.root.id)}
              chrome={chrome}
              viewport={VIEWPORT}
              affordances
              className="windease-zone xt-zone"
            />
          </div>
          <p className="xt-readout">
            Last move: <code data-testid="xt-last-move">{last}</code>
          </p>
          <div className="xt-prose">
            <p>
              Drag a pane into a container of another kind: a horizontal split into a vertical one,
              or a split into a tab stack. The pane keeps the pixel <code>placement.size</code> it
              was saved with. A tab stack ignores it and fills its body. In a split on the other
              axis it is the cross axis and ignored, and because every sibling there already holds a
              size, the newcomer gets the leftover, which is nothing.
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
