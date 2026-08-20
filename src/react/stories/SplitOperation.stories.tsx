export default { title: 'Split operation' };

import type { Story } from '@ladle/react';
import { useMemo, useRef, useState } from 'react';
import {
  asNodeId,
  createPanel,
  createZone,
  gridStrategy,
  type NodeId,
  Store,
  stripStrategy,
} from '../../index.js';
import { type ChromeMap, Container, Provider, StrategyRegistryProvider } from '../index.js';
import './windease.css';

const STRATEGIES = {
  strip: stripStrategy as never,
  grid: gridStrategy as never,
};

const ROOT = asNodeId('root');

export const SplitAndUnsplit: Story = () => {
  const store = useMemo(() => {
    const s = new Store();
    // fill: true — strip's default sizes hintless children to zero, which is
    // right for a toolbar but collapses a split pane to nothing.
    s.registerNode(
      createZone({ id: ROOT, strategyId: 'strip', config: { axis: 'x', gap: 6, fill: true } }),
    );
    s.registerNode(createPanel({ id: asNodeId('p1'), parentId: ROOT, meta: { title: 'p1' } }));
    s.showNode(asNodeId('p1'));
    return s;
  }, []);

  // The store has no id generator, so a consumer mints its own. A counter is
  // all it takes; the ids just have to be unique and stable.
  const counter = useRef(1);
  const [lastGroup, setLastGroup] = useState<NodeId | null>(null);
  const mintPanel = (): NodeId => {
    counter.current += 1;
    return asNodeId(`p${counter.current}`);
  };
  const mintGroup = (): NodeId => asNodeId(`g${counter.current}`);

  /** Split the last panel in the tree, so repeated clicks nest. */
  const target = (): NodeId => {
    const ids = [...store.nodes.values()].filter((n) => !n.container).map((n) => n.id);
    return ids[ids.length - 1] ?? asNodeId('p1');
  };

  // split() registers new nodes but never shows them — that call is the
  // consumer's, same as any other registerNode.
  const showIfPresent = (ids: readonly NodeId[]) => {
    for (const id of ids) {
      if (store.getNode(id)) store.showNode(id);
    }
  };

  const splitX = () => {
    const groupId = mintGroup();
    const newId = mintPanel();
    store.split(target(), { direction: 'x', groupId, newIds: [newId] });
    showIfPresent([groupId, newId]);
  };
  const splitY = () => {
    const groupId = mintGroup();
    const newId = mintPanel();
    store.split(target(), { direction: 'y', groupId, newIds: [newId] });
    showIfPresent([groupId, newId]);
    setLastGroup(groupId);
  };
  const splitBoth = () => {
    const groupId = mintGroup();
    const cols = [asNodeId(`${groupId}-c0`), asNodeId(`${groupId}-c1`)];
    const newIds = [mintPanel(), mintPanel(), mintPanel()];
    store.split(target(), {
      direction: 'both',
      into: [2, 2],
      groupIds: [groupId, ...cols],
      newIds,
    });
    showIfPresent([groupId, ...cols, ...newIds]);
    setLastGroup(groupId);
  };
  const splitGrid = () => {
    const groupId = mintGroup();
    const newIds = [mintPanel(), mintPanel(), mintPanel()];
    store.split(target(), {
      direction: 'grid',
      into: 4,
      cols: 2,
      groupId,
      newIds,
    });
    showIfPresent([groupId, ...newIds]);
    setLastGroup(groupId);
  };
  const unsplit = () => {
    if (lastGroup && store.getNode(lastGroup)) store.unsplit(lastGroup);
    setLastGroup(null);
  };

  const chrome: ChromeMap = useMemo(
    () => ({
      // A group is itself a container, so its children need their own
      // layout pass — recurse with a nested Container, as RecursiveZones does.
      group: ({ node }) => (
        <Container
          parentId={node.id}
          chrome={chrome}
          className="windease-zone"
          affordances
          settleMs={0}
        />
      ),
      panel: ({ node }) => (
        <div className="windease-panel">
          <header className="windease-panel__title">{String(node.meta?.title ?? node.id)}</header>
        </div>
      ),
    }),
    [],
  );

  return (
    <Provider store={store}>
      <StrategyRegistryProvider strategies={STRATEGIES}>
        <div className="story-split-controls">
          <button type="button" data-testid="split-x" onClick={splitX}>
            split x
          </button>
          <button type="button" data-testid="split-y" onClick={splitY}>
            split y
          </button>
          <button type="button" data-testid="split-both" onClick={splitBoth}>
            split both
          </button>
          <button type="button" data-testid="split-grid" onClick={splitGrid}>
            split grid
          </button>
          <button type="button" data-testid="unsplit" onClick={unsplit}>
            unsplit
          </button>
        </div>
        <div className="story-split-host">
          <Container
            parentId={ROOT}
            chrome={chrome}
            className="windease-zone"
            affordances
            settleMs={0}
          />
        </div>
      </StrategyRegistryProvider>
    </Provider>
  );
};
