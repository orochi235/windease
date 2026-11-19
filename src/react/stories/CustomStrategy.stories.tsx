export default { title: 'Custom Strategy' };

import type { Story } from '@ladle/react';
import { useMemo, useState, useSyncExternalStore } from 'react';
import {
  asNodeId,
  createNode,
  deserialize,
  type LayoutItem,
  type LayoutStrategy,
  type NodeId,
  type PlacedRect,
  type SerializedStore,
  Store,
  serialize,
  stripStrategy,
} from '../../index.js';
import {
  type ChromeMap,
  Container,
  DragProvider,
  Provider,
  StrategyRegistryProvider,
} from '../index.js';
import '../styles.css';
import './custom-strategy.css';

type Lane = 'now' | 'later';
const LANES: readonly Lane[] = ['now', 'later'];
const ROW = 36;
const GAP = 8;
const CAP = 5;

const laneOf = (item: LayoutItem): Lane => (item.placement?.lane === 'later' ? 'later' : 'now');

/**
 * Two columns, chosen per child by a placement key of its own, `lane`. It
 * refuses a drop that would hold more than `CAP` cards, and gives a card that
 * arrives from elsewhere the `now` lane in the move's own undo step.
 */
const lanesStrategy: LayoutStrategy<undefined, string> = {
  name: 'lanes',
  layout({ items, container }) {
    const w = (container.w - GAP) / 2;
    const rows: Record<Lane, number> = { now: 0, later: 0 };
    const placements = new Map<string, PlacedRect>();
    for (const item of items) {
      const lane = laneOf(item);
      const col = LANES.indexOf(lane);
      placements.set(item.id, { x: col * (w + GAP), y: rows[lane] * (ROW + GAP), z: 0, w, h: ROW });
      rows[lane]++;
    }
    return { placements, affordances: [] };
  },
  canAccept: (items) => items.length <= CAP,
  land({ ids, store, state }) {
    for (const id of ids) {
      if (store.getNode(id)?.membership?.placement.lane === undefined) {
        store.patchPlacement(id, { lane: 'now' });
      }
    }
    return state;
  },
};

const STRATEGIES = { strip: stripStrategy as never, lanes: lanesStrategy as never };

const INBOX = asNodeId('inbox');
const BOARD = asNodeId('board');

function makeStore(): Store {
  const s = new Store();
  s.registerNode(
    createNode({
      kind: 'zone',
      id: INBOX,
      container: { strategyId: 'strip', config: { axis: 'y', gap: GAP, reorder: true } },
    }),
  );
  s.registerNode(
    createNode({
      kind: 'zone',
      id: BOARD,
      container: { strategyId: 'lanes', config: { reorder: true } },
    }),
  );
  const seed: Array<[string, NodeId, Lane | undefined]> = [
    ['invoice', INBOX, undefined],
    ['refund', INBOX, undefined],
    ['receipt', INBOX, undefined],
    ['audit', BOARD, 'now'],
    ['payroll', BOARD, 'later'],
    ['taxes', BOARD, 'later'],
  ];
  for (const [id, parentId, lane] of seed) {
    const nid = asNodeId(id);
    s.registerNode(
      createNode({
        kind: 'card',
        id: nid,
        parentId,
        meta: { title: id },
        hints: { preferredSize: { w: 180, h: ROW } },
        ...(lane ? { placement: { lane } } : {}),
      }),
    );
    s.showNode(nid);
  }
  return s;
}

/** Each board card's lane, in child order, as the store holds it. */
function lanesIn(store: Store, snap?: SerializedStore): string {
  const ids = snap
    ? (snap.nodes.find((n) => n.id === BOARD)?.container?.childOrder ?? [])
    : (store.getContainerView(BOARD)?.childOrder ?? []);
  const laneFor = (id: string) =>
    snap
      ? snap.nodes.find((n) => n.id === id)?.membership?.placement?.lane
      : store.getNode(asNodeId(id))?.membership?.placement.lane;
  return ids.map((id) => `${id}:${String(laneFor(id))}`).join(', ') || '(empty)';
}

/**
 * A strategy written against the public API only. Each card on the board
 * carries a placement key the library has never heard of, `lane`, which the
 * strategy reads from `item.placement` to pick a column. Drag a card from the
 * inbox onto the board and it lands in `now`; the board refuses a sixth.
 * The button on a card flips its lane. Save and Restore round-trip the store
 * through `serialize` / `deserialize`, custom key and all.
 */
export const PlacementKeys: Story = () => {
  const store = useMemo(() => makeStore(), []);
  const [saved, setSaved] = useState<SerializedStore | null>(null);
  const live = useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => lanesIn(store),
  );

  const chrome: ChromeMap = useMemo(
    () => ({
      card: ({ node }) => {
        const lane = node.membership?.placement.lane;
        return (
          <div className="cs-card" data-testid={`card-${node.id}`}>
            <span>{String(node.meta?.title ?? node.id)}</span>
            {node.membership?.parentId === BOARD ? (
              <button
                type="button"
                data-testid={`flip-${node.id}`}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() =>
                  store.patchPlacement(node.id, { lane: lane === 'later' ? 'now' : 'later' })
                }
              >
                {lane === 'later' ? '← now' : 'later →'}
              </button>
            ) : null}
          </div>
        );
      },
    }),
    [store],
  );

  return (
    <Provider store={store}>
      <StrategyRegistryProvider strategies={STRATEGIES}>
        <DragProvider>
          <div className="cs-root">
            <section aria-label="Inbox">
              <div className="cs-lanes">Inbox</div>
              <div className="cs-frame" data-testid="inbox">
                <Container parentId={INBOX} chrome={chrome} className="cs-frame__inner" />
              </div>
            </section>
            <section aria-label="Board">
              <div className="cs-lanes">
                <span>now</span>
                <span>later</span>
              </div>
              <div className="cs-frame" data-testid="board">
                <Container parentId={BOARD} chrome={chrome} className="cs-frame__inner" />
              </div>
            </section>
          </div>
          <div className="cs-controls">
            <button type="button" data-testid="save" onClick={() => setSaved(serialize(store))}>
              Save
            </button>
            <button
              type="button"
              data-testid="restore"
              disabled={saved === null}
              onClick={() => saved && deserialize(store, saved)}
            >
              Restore
            </button>
          </div>
          <p className="cs-readout">
            Board: <output data-testid="lanes">{live}</output>
          </p>
          <p className="cs-readout">
            Saved:{' '}
            <output data-testid="saved">{saved ? lanesIn(store, saved) : '(nothing)'}</output>
          </p>
        </DragProvider>
      </StrategyRegistryProvider>
    </Provider>
  );
};
