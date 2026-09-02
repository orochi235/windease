export default { title: 'Controlled' };

import type { Story } from '@ladle/react';
import { useCallback, useMemo, useState, useSyncExternalStore } from 'react';
import { asNodeId, createNode, type NodeId, Store, stripStrategy } from '../../index.js';
import {
  type ChromeMap,
  Container,
  DragHandle,
  DragProvider,
  defaultDragOverlay,
  Panel,
  Provider,
  StrategyRegistryProvider,
  useStore,
  Zone,
} from '../index.js';
import '../styles.css';
import './capabilities.css';

const STRATEGIES = { strip: stripStrategy as never };

const ROOT = asNodeId('controlled');
const LEFT = asNodeId('left');
const RIGHT = asNodeId('right');
const VIEWPORT = { w: 640, h: 180 };
const STRIP_X = { axis: 'x', gap: 6, padding: 6, fill: true };

const START_W = 220;

/**
 * A controlled pane: the host owns the width, the seam only proposes one.
 * Declaring `placement` without `onPlacementChange` re-forces the declared
 * value on every render, so a drag would snap back — this is the pairing that
 * makes the round trip work.
 */
export const Placement: Story = () => {
  const store = useMemo(() => new Store(), []);
  const [w, setW] = useState(START_W);
  const [commit, setCommit] = useState(true);
  const [proposal, setProposal] = useState<string>('none');
  return (
    <Provider store={store}>
      <StrategyRegistryProvider strategies={STRATEGIES}>
        <div className="cap-bar">
          <label>
            <input
              type="checkbox"
              checked={commit}
              data-testid="commit"
              onChange={(e) => setCommit(e.target.checked)}
            />{' '}
            commit what the seam proposes
          </label>
          <button type="button" data-testid="reset" onClick={() => setW(START_W)}>
            reset to {START_W}
          </button>
        </div>
        <div className="cap-stage cap-stage--strip">
          <Zone
            id={ROOT}
            strategyId="strip"
            config={STRIP_X}
            viewport={VIEWPORT}
            className="windease-zone"
            affordances
          >
            <Panel
              id={LEFT}
              title="Left (controlled)"
              className="cap-pane"
              placement={{ size: { w } }}
              onPlacementChange={(next, change) => {
                const width = (next.size as { w?: number } | undefined)?.w;
                setProposal(
                  `${change.affordanceId} → ${width === undefined ? '—' : Math.round(width)}`,
                );
                if (commit && width !== undefined) setW(Math.round(width));
              }}
            />
            <Panel id={RIGHT} title="Right" className="cap-pane" />
          </Zone>
        </div>
        <p className="cap-readout">
          host width: <span data-testid="host-width">{w}</span> · last proposal:{' '}
          <span data-testid="proposal">{proposal}</span>
        </p>
        <p className="cap-hint">
          Drag the seam. With the box ticked the pane follows, because the host wrote the width it
          was handed; untick it and the seam still proposes on every pointermove while the pane
          stays put — nothing reached the store. <b>Reset</b> proves ownership the other way: the
          host can put the width back without touching the layout.
        </p>
      </StrategyRegistryProvider>
    </Provider>
  );
};

const ORDER_ZONE = asNodeId('order-zone');
const ORDER_PANES: Array<[NodeId, string]> = [
  [asNodeId('alpha'), 'Alpha'],
  [asNodeId('bravo'), 'Bravo'],
  [asNodeId('charlie'), 'Charlie'],
];

function makeOrderStore(): Store {
  const s = new Store();
  s.registerNode(
    createNode({
      kind: 'zone',
      id: ORDER_ZONE,
      container: { strategyId: 'strip', config: { axis: 'y', gap: 6, padding: 6, fill: true } },
    }),
  );
  s.showNode(ORDER_ZONE);
  for (const [id, title] of ORDER_PANES) {
    s.registerNode(
      createNode({
        kind: 'panel',
        focus: true,
        id,
        parentId: ORDER_ZONE,
        hints: { minSize: { w: 0, h: 40 } },
        meta: { title },
      }),
    );
    s.showNode(id);
  }
  return s;
}

const orderChrome: ChromeMap = {
  panel: ({ node }) => (
    <DragHandle nodeId={node.id} className="cap-pane">
      <header className="cap-pane__title" data-testid={`grip-${node.id}`}>
        {String(node.meta?.title ?? node.id)}
      </header>
    </DragHandle>
  ),
};

/** The store's own order, which a controlled container only ever reaches
 *  through the host. */
function StoreOrder() {
  const store = useStore();
  const subscribe = useCallback((cb: () => void) => store.subscribe(cb), [store]);
  const snapshot = useCallback(
    () => (store.getContainerView(ORDER_ZONE)?.childOrder ?? []).join(','),
    [store],
  );
  const text = useSyncExternalStore(subscribe, snapshot, snapshot);
  return <span data-testid="store-order">{text}</span>;
}

/**
 * A controlled child order: the drop hands over the list it would have written
 * and writes nothing itself, so refusing it is just not calling the store.
 */
export const ChildOrder: Story = () => {
  const store = useMemo(makeOrderStore, []);
  const [commit, setCommit] = useState(true);
  const [proposal, setProposal] = useState<string>('none');
  return (
    <Provider store={store}>
      <StrategyRegistryProvider strategies={STRATEGIES}>
        <DragProvider dragOverlay={defaultDragOverlay}>
          <div className="cap-bar">
            <label>
              <input
                type="checkbox"
                checked={commit}
                data-testid="commit"
                onChange={(e) => setCommit(e.target.checked)}
              />{' '}
              commit what the drop proposes
            </label>
            <button
              type="button"
              data-testid="reverse"
              onClick={() => {
                const now = store.getContainerView(ORDER_ZONE)?.childOrder ?? [];
                store.setChildOrder(ORDER_ZONE, [...now].reverse() as NodeId[]);
              }}
            >
              reverse from the host
            </button>
          </div>
          <div className="cap-stage cap-stage--column">
            <Container
              parentId={ORDER_ZONE}
              chrome={orderChrome}
              viewport={{ w: 260, h: 300 }}
              className="windease-zone"
              onChildOrderChange={(next, change) => {
                setProposal(`${change.movedId} → ${next.join(',')}`);
                if (commit) store.setChildOrder(ORDER_ZONE, next);
              }}
            />
          </div>
          <p className="cap-readout">
            store order: <StoreOrder /> · last proposal:{' '}
            <span data-testid="proposal">{proposal}</span>
          </p>
          <p className="cap-hint">
            Drag a pane past another. Ticked, the host writes the proposed order and the panes
            settle into it; unticked, the proposal is recorded and the store keeps the order it had.
            <b>Reverse</b> writes the store directly — a host acting on itself is never intercepted,
            only library-mediated gestures are.
          </p>
        </DragProvider>
      </StrategyRegistryProvider>
    </Provider>
  );
};
