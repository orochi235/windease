export default { title: 'Exotic / Board' };

import type { Story } from '@ladle/react';
import { type CSSProperties, useEffect, useMemo, useSyncExternalStore } from 'react';
import {
  asNodeId,
  bow,
  createNode,
  driveWithRaf,
  type NodeId,
  Store,
  stripStrategy,
  swell,
  tilt,
  warp,
} from '../../index.js';
import {
  type ChromeMap,
  Container,
  DragHandle,
  DragProvider,
  FocusProvider,
  GeometryProvider,
  Provider,
  StrategyRegistryProvider,
  useChannelsForSelf,
  useDragState,
  useStore,
} from '../index.js';
import { cardPool, type PoolCard } from './board-cards.js';
import './windease.css';
import './exotic-board.css';

/**
 * A duel board for a card game that does not exist: two players facing each
 * other across a table drawn in perspective, a hand fanned at the near edge,
 * and three piles on a rail. Nothing here knows the rules — it is the layout
 * that is being shown.
 *
 * Every band is `stripStrategy` under `warp`. The table bands add `tilt`, so
 * their rects arrive already in screen space and a drop lands in the band the
 * card looks like it is over. The hand adds `bow` and `swell` and asks for the
 * `pointer` input, so it fans and parts under the cursor.
 */

/** The camera the whole table shares, so the four bands agree on one horizon. */
/**
 * A gentle camera on purpose. `tilt` is perspective strength, and `horizon`
 * is how far the far edge converges: push the horizon up and the projection
 * compresses height much harder than it scales width, which leaves each row
 * fitted into a box far shorter than the one it was placed in, and the table
 * grows gaps between its rows.
 */
const CAMERA = { tilt: 0.42, horizon: 0.45 };

const STRATEGIES = {
  /**
   * The table: one surface carrying every row, projected once. All four rows
   * are children of it, so they converge together on a single plane. Each row
   * then lays out in the same logical box (`BAND_W` × `BAND_H`) and is fitted
   * uniformly into the width the projection left it, which is what makes a far
   * card smaller than a near one without being a different shape.
   */
  tableau: warp(stripStrategy, [tilt(CAMERA)]) as never,
  /** The near player's hand: bent onto a curve, then parted under the cursor. */
  hand: warp(stripStrategy, [bow(0.3), swell({ reach: 210, gain: 1.75, lift: 22 })]) as never,
  /** Bands, columns and the pile rail, which are ordinary strips. */
  strip: stripStrategy as never,
};

const TABLE = asNodeId('table');
const MAIN = asNodeId('main');
const TABLEAU = asNodeId('tableau');
const RAIL = asNodeId('rail');
const OPP_HAND = asNodeId('opp-hand');
const OPP_FIELD = asNodeId('opp-field');
const OPP_LAND = asNodeId('opp-land');
const YOUR_FIELD = asNodeId('your-field');
const YOUR_LAND = asNodeId('your-land');
const YOUR_HAND = asNodeId('your-hand');

/** The bands a card of yours may be dropped into. */
const YOURS: NodeId[] = [YOUR_FIELD, YOUR_LAND, YOUR_HAND];

const CARD = { w: 60, h: 84 };
/** A band's inner padding, and the height that gives its cards `CARD`'s aspect.
 *  A strip fills its cross axis, so the band's height *is* the card height —
 *  every band is this tall so no card is drawn to a different shape. */
const BAND_PAD = 8;
const BAND_H = CARD.h + 2 * BAND_PAD;
/** The logical width every band lays out in, whatever width it is drawn at. */
const BAND_W = 462;

/** How many cards each band is dealt, far to near. The rest stay in the deck,
 *  which is what the library pile counts. */
const DEAL: Array<[NodeId, number, 'unit' | 'land' | 'any']> = [
  [OPP_FIELD, 3, 'unit'],
  [OPP_LAND, 4, 'land'],
  [YOUR_FIELD, 2, 'unit'],
  [YOUR_LAND, 5, 'land'],
  [YOUR_HAND, 7, 'any'],
];

const POOL = cardPool();

/** The deal: take from the pool in order, honoring each band's want. */
function deal(): { hands: Map<NodeId, PoolCard[]>; left: number } {
  const hands = new Map<NodeId, PoolCard[]>();
  let next = 0;
  for (const [band, n, want] of DEAL) {
    const taken: PoolCard[] = [];
    while (taken.length < n && next < POOL.length) {
      const card = POOL[next++]!;
      if (want === 'unit' && card.land) continue;
      if (want === 'land' && !card.land) continue;
      taken.push(card);
    }
    hands.set(band, taken);
  }
  return { hands, left: POOL.length - next };
}

/** A band of the table, wide enough for a row of cards and no taller. */
const bandConfig = (extra: Record<string, unknown> = {}) => ({
  axis: 'x',
  gap: 10,
  padding: BAND_PAD,
  justify: 'center',
  // A card that declares a turn takes the box the turn needs rather than the
  // band's full height, and sits centered in the slack the rest of the time.
  crossAlign: 'center',
  resizable: false,
  overflowMode: 'overlap',
  peek: 34,
  ...extra,
});

function makeStore(): Store {
  const s = new Store();
  s.registerNode(
    createNode({
      kind: 'zone',
      id: TABLE,
      container: { strategyId: 'strip', config: { axis: 'x', gap: 12, resizable: false } },
    }),
  );
  s.registerNode(
    createNode({
      kind: 'zone',
      id: MAIN,
      parentId: TABLE,
      container: { strategyId: 'strip', config: { axis: 'y', gap: 6, resizable: false } },
      placement: { share: 1 },
    }),
  );
  s.showNode(MAIN);
  s.registerNode(
    createNode({
      kind: 'zone',
      id: RAIL,
      parentId: TABLE,
      container: { strategyId: 'strip', config: { axis: 'y', gap: 8, resizable: false } },
      placement: { size: { w: 96 } },
    }),
  );
  s.showNode(RAIL);

  // The table is everything the camera sees. The hand is not on the table —
  // it sits at the near edge, unprojected, which is where a player holds it.
  s.registerNode(
    createNode({
      kind: 'zone',
      id: TABLEAU,
      parentId: MAIN,
      container: {
        strategyId: 'tableau',
        config: { axis: 'y', gap: 12, padding: 6, resizable: false },
      },
      placement: { share: 1 },
    }),
  );
  s.showNode(TABLEAU);
  s.registerNode(
    createNode({
      kind: 'zone',
      id: YOUR_HAND,
      parentId: MAIN,
      container: { strategyId: 'hand', config: bandConfig({ peek: 46 }) },
      meta: { title: 'Your hand' },
      placement: { size: { h: BAND_H } },
    }),
  );
  s.showNode(YOUR_HAND);

  // Far to near on one surface, every row the same height so no card is
  // drawn to a different shape than any other.
  const bands: Array<[NodeId, string, Record<string, unknown>, number]> = [
    [OPP_HAND, "Opponent's hand", bandConfig({ peek: 26 }), 62],
    [OPP_LAND, "Opponent's lands", bandConfig(), BAND_H],
    [OPP_FIELD, "Opponent's units", bandConfig(), BAND_H],
    [YOUR_FIELD, 'Your units', bandConfig(), BAND_H],
    [YOUR_LAND, 'Your lands', bandConfig(), BAND_H],
  ];
  for (const [id, title, config, h] of bands) {
    s.registerNode(
      createNode({
        kind: 'zone',
        id,
        parentId: TABLEAU,
        container: { strategyId: 'strip', config },
        meta: { title },
        placement: { size: { h } },
      }),
    );
    s.showNode(id);
  }

  const { hands, left } = deal();

  for (const [id, label, count] of [
    ['library', 'Library', left],
    ['graveyard', 'Graveyard', 0],
    ['exile', 'Exile', 0],
  ] as const) {
    const nid = asNodeId(id);
    s.registerNode(
      createNode({
        kind: 'pile',
        id: nid,
        parentId: RAIL,
        meta: { title: label, count },
        placement: { size: { h: 80 } },
      }),
    );
    s.showNode(nid);
  }

  for (const [band, cards] of hands) {
    // Positional ids rather than the pool's own, so a band's third card is
    // addressable whatever the pool deals into it.
    for (const [i, card] of cards.entries()) {
      const nid = asNodeId(`${band}-${i}`);
      s.registerNode(
        createNode({
          kind: 'card',
          focus: true,
          id: nid,
          parentId: band,
          meta: {
            title: card.name,
            land: card.land,
            power: card.power,
            cost: card.cost,
            type: card.type,
            text: card.text,
            rarity: card.rarity,
            foil: card.foil,
            hue: card.hue,
          },
          hints: { preferredSize: { ...CARD } },
        }),
      );
      s.showNode(nid);
    }
  }
  // The far player's hand is a count, not a list: seven backs.
  for (let i = 0; i < 7; i++) {
    const nid = asNodeId(`ob${i + 1}`);
    s.registerNode(
      createNode({
        kind: 'back',
        id: nid,
        parentId: OPP_HAND,
        hints: { preferredSize: { w: 40, h: 56 } },
      }),
    );
    s.showNode(nid);
  }
  return s;
}

/**
 * The worked example the library deliberately does not ship: `channels` carries
 * numbers, and what they mean is the host's business.
 *
 * Only `angle` becomes a transform. `tilt` and `swell` already moved the rects
 * — that is the rule, rect when it changes where a child is or how big it is —
 * so translating or scaling here would apply their deformation twice. What is
 * left is what a rect cannot say: the card's tangential rotation in the fan,
 * its keystone for a host that wants a true trapezoid, and how far the cursor
 * has singled it out.
 */
function cardStyle(channels: Record<string, number> | undefined): CSSProperties {
  const style: CSSProperties & Record<string, string | number> = {};
  // Only the fan's own angle. A tapped card's quarter is `hints.turn`, which
  // the strategy reserved a box for and the Container rotates the wrapper by,
  // so the two rotations compose without this having to add them.
  const angle = channels?.angle ?? 0;
  if (angle !== 0) style.transform = `rotate(${angle}deg)`;
  if (!channels) return style;
  // Distance shrank the card's box; shrink what is printed on it to match.
  if (channels.scale !== undefined) style['--xb-scale'] = channels.scale;
  if (channels.focus) style['--xb-focus'] = channels.focus;
  return style;
}

/** Tapped past the halfway point of its turn, for the styling that should flip
 *  once rather than ease — the desaturation, and the test hook. */
function isTapped(turn: number | undefined): boolean {
  return (turn ?? 0) >= 45;
}

function CardFace({ nodeId }: { nodeId: NodeId }) {
  const store = useStore();
  const node = useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getNode(nodeId),
  );
  const channels = useChannelsForSelf(nodeId);
  if (!node) return null;
  const land = node.meta?.land === true;
  const tapped = isTapped(node.hints?.turn);
  const className = [
    'xb-card',
    `xb-card--${String(node.meta?.rarity ?? 'common')}`,
    land ? 'xb-card--land' : '',
    node.meta?.foil === true ? 'xb-card--foil' : '',
    tapped ? 'xb-card--tapped' : '',
    channels?.focus ? 'xb-card--focus' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <DragHandle nodeId={nodeId} className="xb-card-drag">
      <button
        type="button"
        className={className}
        style={
          {
            ...cardStyle(channels),
            '--xb-hue': String(node.meta?.hue ?? 200),
          } as CSSProperties
        }
        data-testid={`xb-card-${nodeId}`}
        data-tapped={tapped ? 'true' : undefined}
        onClick={() => store.turnTo(nodeId, tapped ? 0 : 90, { ms: 220 })}
      >
        <span className="xb-card__title">
          <span className="xb-card__name">{String(node.meta?.title ?? nodeId)}</span>
          {node.meta?.cost ? <span className="xb-card__cost">{String(node.meta.cost)}</span> : null}
        </span>
        <span className={`xb-card__art${land ? ' xb-card__art--land' : ''}`} aria-hidden="true">
          <span className="xb-card__sky" />
          <span className="xb-card__hills" />
          <span className="xb-card__figure" />
        </span>
        <span className="xb-card__type">
          <span>{String(node.meta?.type ?? (land ? 'Land' : 'Unit'))}</span>
          <span className="xb-card__set" aria-hidden="true">
            ◈
          </span>
        </span>
        <span className="xb-card__rules">{String(node.meta?.text ?? '')}</span>
        {node.meta?.power ? (
          <span className="xb-card__power">{String(node.meta.power)}</span>
        ) : null}
      </button>
    </DragHandle>
  );
}

function Band({ id }: { id: NodeId }) {
  const drag = useDragState();
  const store = useStore();
  // Every band lays out in the same logical box, so a card is the same shape
  // wherever it sits, and `fit="width"` scales that box uniformly into the
  // width the projection left this row. Reading the projected height instead
  // would foreshorten the cards, since perspective compresses y harder than
  // it scales x — a real table does that to a card lying on it, but it reads
  // as a squashed card rather than a tilted one.
  const isTarget = drag?.hover?.targetId === id;
  const accepted = isTarget && drag?.hover?.accepted === true;
  const className = [
    'xb-band',
    id === YOUR_HAND || id === OPP_HAND ? 'xb-band--hand' : 'xb-band--field',
    isTarget && accepted ? 'xb-band--accept' : '',
    isTarget && !accepted ? 'xb-band--reject' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div className={className} data-testid={`xb-band-${id}`}>
      <Container
        parentId={id}
        chrome={CHROME}
        viewport={{ w: BAND_W, h: BAND_H }}
        fit="contain"
        pointer={id === YOUR_HAND}
        // The hand re-lays out on every pointermove. A settle transition
        // animates toward each new position and never arrives, which reads as
        // jitter; the swell is already continuous, so it needs no easing.
        settleMs={id === YOUR_HAND ? 0 : undefined}
        // `sourceId` is the card being dragged, so the side it belongs to is
        // its parent band, not the card itself.
        acceptPolicy={({ sourceId }) => {
          if (!YOURS.includes(id)) return false;
          const from = store.getNode(sourceId)?.membership?.parentId;
          return from !== undefined && YOURS.includes(from);
        }}
      />
    </div>
  );
}

/**
 * A card belongs in a band, never in the scaffolding that arranges the bands.
 * Without this the tableau, the column and the pile rail all accept by default,
 * so a card could be dropped into the gap between two bands or onto the rail
 * and would sit there as a sibling of the piles.
 */
const REFUSE = () => false;

const CHROME: ChromeMap = {
  zone: ({ node }) =>
    node.id === TABLEAU || node.id === MAIN || node.id === RAIL ? (
      <div className="xb-nest">
        <Container parentId={node.id} chrome={CHROME} acceptPolicy={REFUSE} />
      </div>
    ) : (
      <Band id={node.id} />
    ),
  card: ({ node }) => <CardFace nodeId={node.id} />,
  back: () => <div className="xb-card xb-card--back" aria-hidden="true" />,
  pile: ({ node }) => (
    <div className="xb-pile" data-testid={`xb-pile-${node.id}`}>
      <span className="xb-pile__count">{String(node.meta?.count ?? 0)}</span>
      <span>{String(node.meta?.title ?? node.id)}</span>
    </div>
  ),
};

export const DuelBoard: Story = () => {
  const store = useMemo(() => makeStore(), []);
  // The library interpolates a turn; something has to give it frames. A host
  // with its own loop calls `store.tick(now)` from there instead.
  useEffect(() => driveWithRaf(store), [store]);
  return (
    <Provider store={store}>
      <StrategyRegistryProvider strategies={STRATEGIES}>
        <DragProvider>
          <GeometryProvider>
            <FocusProvider>
              <div className="xb-root" data-testid="xb-root">
                <div className="xb-table">
                  <div className="xb-main">
                    <Container parentId={MAIN} chrome={CHROME} acceptPolicy={REFUSE} />
                  </div>
                  <div className="xb-rail">
                    <Container parentId={RAIL} chrome={CHROME} acceptPolicy={REFUSE} />
                  </div>
                </div>
                <p className="xb-hint">
                  Drag a card out of your hand onto one of your two bands, or back. The far half of
                  the table refuses your cards, and so does the opponent's hand. Click any card to
                  turn it a quarter — the band reserves the box the rotation needs and reflows
                  around it as the card turns. Sweep the pointer across your hand and the fan parts
                  under it.
                </p>
              </div>
            </FocusProvider>
          </GeometryProvider>
        </DragProvider>
      </StrategyRegistryProvider>
    </Provider>
  );
};
