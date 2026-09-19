export default { title: 'Split operation' };

import type { Story } from '@ladle/react';
import { useMemo, useRef, useState } from 'react';
import {
  asNodeId,
  createNode,
  gridStrategy,
  type NodeId,
  NoSpaceError,
  type SplitStrict,
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
/** The floor a strict split keeps every pane above, on both axes. */
const FLOOR = 120;

/** What a strict split needs that the store has no way to know: how big the
 *  node is right now. A story is a DOM host, so it measures. */
function strictFor(id: NodeId): SplitStrict {
  const box = document.querySelector(`[data-node="${id}"]`)?.getBoundingClientRect();
  return { size: { w: box?.width ?? 0, h: box?.height ?? 0 }, minSize: { w: FLOOR, h: FLOOR } };
}

export const SplitAndUnsplit: Story = () => {
  const store = useMemo(() => {
    const s = new Store();
    // fill: true — strip's default sizes hintless children to zero, which is
    // right for a toolbar but collapses a split pane to nothing.
    s.registerNode(
      createNode({
        kind: 'zone',
        container: { strategyId: 'strip', config: { axis: 'x', gap: 6, fill: true } },
        id: ROOT,
      }),
    );
    s.registerNode(
      createNode({
        kind: 'panel',
        focus: true,
        id: asNodeId('p1'),
        parentId: ROOT,
        meta: { title: 'p1' },
      }),
    );
    s.showNode(asNodeId('p1'));
    return s;
  }, []);

  // The store has no id generator, so a consumer mints its own. A counter is
  // all it takes; the ids just have to be unique and stable.
  const counter = useRef(1);
  const [lastGroup, setLastGroup] = useState<NodeId | null>(null);
  const [strict, setStrict] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  /** Runs one split, showing a strict refusal instead of throwing it at React. */
  const attempt = (run: () => void): boolean => {
    try {
      run();
      setRefused(null);
      return true;
    } catch (e) {
      if (!(e instanceof NoSpaceError)) throw e;
      setRefused(e.message);
      return false;
    }
  };
  const strictOf = (id: NodeId) => (strict ? { strict: strictFor(id) } : {});
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

  const splitX = () => {
    const id = target();
    attempt(() =>
      store.split(id, {
        direction: 'x',
        groupId: mintGroup(),
        newIds: [mintPanel()],
        ...strictOf(id),
      }),
    );
  };
  const splitY = () => {
    const id = target();
    const groupId = mintGroup();
    const done = attempt(() =>
      store.split(id, { direction: 'y', groupId, newIds: [mintPanel()], ...strictOf(id) }),
    );
    if (done) setLastGroup(groupId);
  };
  const splitBoth = () => {
    const id = target();
    const groupId = mintGroup();
    const cols = [asNodeId(`${groupId}-c0`), asNodeId(`${groupId}-c1`)];
    const done = attempt(() =>
      store.split(id, {
        direction: 'both',
        into: [2, 2],
        groupIds: [groupId, ...cols],
        newIds: [mintPanel(), mintPanel(), mintPanel()],
        ...strictOf(id),
      }),
    );
    if (done) setLastGroup(groupId);
  };
  const splitGrid = () => {
    const id = target();
    const groupId = mintGroup();
    const done = attempt(() =>
      store.split(id, {
        direction: 'grid',
        into: 4,
        cols: 2,
        groupId,
        newIds: [mintPanel(), mintPanel(), mintPanel()],
        ...strictOf(id),
      }),
    );
    if (done) setLastGroup(groupId);
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
          <label>
            <input
              type="checkbox"
              data-testid="strict"
              checked={strict}
              onChange={(e) => setStrict(e.target.checked)}
            />{' '}
            strict: refuse panes under {FLOOR}px
          </label>
        </div>
        <p className="story-split-refused" data-testid="split-refused" role="status">
          {refused ?? ''}
        </p>
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
