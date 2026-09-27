export default { title: 'Policies/Collapse' };

import type { Story } from '@ladle/react';
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import {
  asNodeId,
  type CollapsePolicy,
  collapse,
  createNode,
  type Node,
  type NodeId,
  Store,
  stay,
  stripStrategy,
} from '../../index.js';
import {
  DragHandle,
  DragProvider,
  Provider,
  StrategyRegistryProvider,
  useStore,
  Zone,
} from '../index.js';
import '../styles.css';
import './accept-policy.css';
import './collapse-policy.css';

const STRATEGIES = { strip: stripStrategy as never };

const ROOT = asNodeId('workspace');
const SIDE = asNodeId('sidebar');
const MAIN = asNodeId('main');

const VIEWPORT = { w: 720, h: 320 };
const SIDE_WIDTH = 220;
const ROW = { axis: 'x', fill: true, gap: 8 };
const COLUMN = { axis: 'y', fill: true, gap: 8, padding: 8 };

const PANES: [id: NodeId, parentId: NodeId, title: string][] = [
  [asNodeId('files'), SIDE, 'Files'],
  [asNodeId('editor'), MAIN, 'Editor'],
  [asNodeId('terminal'), MAIN, 'Terminal'],
];

/** Every policy here answers for the sidebar alone: handed to the store as it
 *  is, `collapse()` would shut any group that emptied, `main` included. */
const sidebarOnly =
  (policy: CollapsePolicy): CollapsePolicy =>
  (input) =>
    input.id === SIDE ? policy(input) : undefined;

const POLICIES: Record<string, { label: string; policy: CollapsePolicy }> = {
  reopen: {
    label: `collapse({ dragTo: ${SIDE_WIDTH} })`,
    policy: sidebarOnly(collapse({ dragTo: SIDE_WIDTH })),
  },
  shut: { label: 'collapse()', policy: sidebarOnly(collapse()) },
  rail: { label: 'collapse({ to: 24 })', policy: sidebarOnly(collapse({ to: 24 })) },
  stay: { label: 'stay', policy: stay },
};

function renderPane(node: Node) {
  return (
    <DragHandle nodeId={node.id} className="ap-pane">
      <header className="ap-pane__title" data-testid={`pane-${node.id}`}>
        {String(node.meta?.title ?? node.id)}
        <span className="ap-pane__grip" aria-hidden="true">
          ⋮⋮
        </span>
      </header>
      <div className="ap-pane__body">Drag me across.</div>
    </DragHandle>
  );
}

/** The width the sidebar was dragged to, which a collapse leaves where it was. */
function StoredWidth() {
  const store = useStore();
  const subscribe = useCallback((cb: () => void) => store.subscribe(cb), [store]);
  const snapshot = useCallback(() => {
    const size = store.getNode(SIDE)?.membership?.placement?.size as { w?: number } | undefined;
    return size?.w === undefined ? '(none)' : String(Math.round(size.w));
  }, [store]);
  const text = useSyncExternalStore(subscribe, snapshot, snapshot);
  return (
    <code className="cp-readout__value" data-testid="stored-width">
      {text}
    </code>
  );
}

function Workspace() {
  const store = useStore();
  useEffect(() => {
    if (!store.getNode(SIDE) || !store.getNode(MAIN)) return;
    for (const [id, parentId, title] of PANES) {
      if (store.getNode(id)) continue;
      store.registerNode(createNode({ kind: 'panel', focus: true, id, parentId, meta: { title } }));
      store.showNode(id);
    }
    // Written once rather than declared: a declared placement is re-asserted
    // on every render, which would undo a seam drag.
    if (!store.getNode(SIDE)?.membership?.placement?.size) {
      store.patchPlacement(SIDE, { size: { w: SIDE_WIDTH } });
    }
  }, [store]);

  return (
    <>
      <div className="cp-frame">
        <Zone id={ROOT} strategyId="strip" config={ROW} viewport={VIEWPORT} affordances>
          <Zone
            id={SIDE}
            kind="group"
            strategyId="strip"
            config={COLUMN}
            acceptsDrops
            className="cp-group"
            data-testid="sidebar"
            renderImperative={renderPane}
          />
          <Zone
            id={MAIN}
            kind="group"
            strategyId="strip"
            config={COLUMN}
            acceptsDrops
            className="cp-group"
            data-testid="main"
            renderImperative={renderPane}
          />
        </Zone>
      </div>
      <p className="cp-readout">
        sidebar <code>placement.size.w</code>: <StoredWidth />
      </p>
    </>
  );
}

export const SidebarThatShuts: Story = () => {
  const [chosen, setChosen] = useState('reopen');
  // The policy is a constructor option, so choosing another builds a new store.
  const store = useMemo(
    () => new Store({ collapsePolicy: (POLICIES[chosen] ?? POLICIES.reopen!).policy }),
    [chosen],
  );

  return (
    <Provider store={store} key={chosen}>
      <StrategyRegistryProvider strategies={STRATEGIES}>
        <DragProvider>
          <label className="cp-controls">
            collapsePolicy
            <select data-testid="policy" value={chosen} onChange={(e) => setChosen(e.target.value)}>
              {Object.entries(POLICIES).map(([key, { label }]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <Workspace />
          <div className="ap-prose">
            <p>
              Drag Files out of the sidebar and into the main column. The sidebar is now an empty
              container, so the store&apos;s <code>collapsePolicy</code> is asked what it should do
              with the room, and the row is laid out again with the answer.
            </p>
            <p>
              Under <code>collapse()</code> it shuts to nothing and cannot be reopened by hand:
              there is nothing to drop on. <code>dragTo</code> is the way back in. Pick up any pane
              and the sidebar opens for as long as the drag lasts, then shuts again if the pane
              lands somewhere else. <code>to: 24</code> leaves a rail wide enough to drop on.{' '}
              <code>stay</code> is what a store with no policy does.
            </p>
            <p>
              The width under the workspace is what the sidebar was last dragged to. No policy
              writes it, which is why the sidebar comes back at that width when a pane returns.
            </p>
          </div>
        </DragProvider>
      </StrategyRegistryProvider>
    </Provider>
  );
};
