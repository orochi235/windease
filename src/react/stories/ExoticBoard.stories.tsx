export default { title: 'Exotic / Board' };

import type { Story } from '@ladle/react';
import { type CSSProperties, useMemo, useSyncExternalStore } from 'react';
import {
  asNodeId,
  bow,
  createNode,
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
const CAMERA = { tilt: 0.55, horizon: 0.08 };

const STRATEGIES = {
  /**
   * The table itself. The bands are its children, so projecting *here* is what
   * makes the table converge: each band's own rect narrows and shortens with
   * depth, and the cards inside it then lay out against the width it really
   * has. Tilting each band separately only shrinks the cards within it, which
   * looks like a mistake rather than a table.
   */
  tableau: warp(stripStrategy, [tilt(CAMERA)]) as never,
  /** The near player's hand: bent onto a curve, then parted under the cursor. */
  hand: warp(stripStrategy, [bow(0.35), swell({ reach: 150, gain: 1.18, lift: 26 })]) as never,
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

const CARD = { w: 86, h: 120 };

interface Card {
  id: string;
  name: string;
  parent: NodeId;
  land?: boolean;
  power?: string;
}

/** Invented names for invented cards. Nothing here is anyone's property. */
const CARDS: Card[] = [
  { id: 'o1', name: 'Hollow Warden', parent: OPP_FIELD, power: '3/4' },
  { id: 'o2', name: 'Silt Harrier', parent: OPP_FIELD, power: '2/1' },
  { id: 'o3', name: 'Reed Diviner', parent: OPP_FIELD, power: '1/3' },
  { id: 'ol1', name: 'Saltflat', parent: OPP_LAND, land: true },
  { id: 'ol2', name: 'Deepwood', parent: OPP_LAND, land: true },
  { id: 'ol3', name: 'Wellspring', parent: OPP_LAND, land: true },
  { id: 'ol4', name: 'Ember Vent', parent: OPP_LAND, land: true },
  { id: 'y1', name: 'Thornback Drake', parent: YOUR_FIELD, power: '4/4' },
  { id: 'y2', name: 'Glass Sentinel', parent: YOUR_FIELD, power: '0/6' },
  { id: 'yl1', name: 'Wellspring', parent: YOUR_LAND, land: true },
  { id: 'yl2', name: 'Wellspring', parent: YOUR_LAND, land: true },
  { id: 'yl3', name: 'Marshpath', parent: YOUR_LAND, land: true },
  { id: 'yl4', name: 'Marshpath', parent: YOUR_LAND, land: true },
  { id: 'yl5', name: 'Ember Vent', parent: YOUR_LAND, land: true },
  { id: 'h1', name: 'Cinder Adept', parent: YOUR_HAND, power: '2/2' },
  { id: 'h2', name: 'Gale Runner', parent: YOUR_HAND, power: '3/1' },
  { id: 'h3', name: 'Ash Pilgrim', parent: YOUR_HAND, power: '1/1' },
  { id: 'h4', name: 'Stone Vigil', parent: YOUR_HAND, power: '0/5' },
  { id: 'h5', name: 'Tidecaller', parent: YOUR_HAND, power: '2/3' },
  { id: 'h6', name: 'Marshpath', parent: YOUR_HAND, land: true },
  { id: 'h7', name: 'Ember Sprite', parent: YOUR_HAND, power: '1/2' },
];

/** A band of the table, wide enough for a row of cards and no taller. */
const bandConfig = (extra: Record<string, unknown> = {}) => ({
  axis: 'x',
  gap: 10,
  padding: 8,
  justify: 'center',
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
        config: { axis: 'y', gap: 8, padding: 4, resizable: false },
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
      container: { strategyId: 'hand', config: bandConfig({ peek: 44, padding: 28 }) },
      meta: { title: 'Your hand' },
      placement: { size: { h: 170 } },
    }),
  );
  s.showNode(YOUR_HAND);

  // Far to near, and each band is an ordinary strip: the convergence is the
  // tableau's doing, not theirs.
  const bands: Array<[NodeId, string, Record<string, unknown>]> = [
    [OPP_HAND, "Opponent's hand", bandConfig({ peek: 26 })],
    [OPP_LAND, "Opponent's lands", bandConfig()],
    [OPP_FIELD, "Opponent's units", bandConfig()],
    [YOUR_FIELD, 'Your units', bandConfig()],
    [YOUR_LAND, 'Your lands', bandConfig()],
  ];
  for (const [id, title, config] of bands) {
    s.registerNode(
      createNode({
        kind: 'zone',
        id,
        parentId: TABLEAU,
        container: { strategyId: 'strip', config },
        meta: { title },
        placement: { share: 1 },
      }),
    );
    s.showNode(id);
  }

  for (const [id, label] of [
    ['library', 'Library'],
    ['graveyard', 'Graveyard'],
    ['exile', 'Exile'],
  ] as const) {
    const nid = asNodeId(id);
    s.registerNode(
      createNode({
        kind: 'pile',
        id: nid,
        parentId: RAIL,
        meta: { title: label },
        placement: { size: { h: 96 } },
      }),
    );
    s.showNode(nid);
  }

  for (const card of CARDS) {
    const nid = asNodeId(card.id);
    s.registerNode(
      createNode({
        kind: 'card',
        focus: true,
        id: nid,
        parentId: card.parent,
        meta: { title: card.name, land: card.land === true, power: card.power ?? '' },
        hints: { preferredSize: { ...CARD } },
      }),
    );
    s.showNode(nid);
  }
  // The far player's hand is a count, not a list: seven backs.
  for (let i = 0; i < 7; i++) {
    const nid = asNodeId(`ob${i + 1}`);
    s.registerNode(
      createNode({
        kind: 'back',
        id: nid,
        parentId: OPP_HAND,
        hints: { preferredSize: { w: 58, h: 80 } },
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
  if (!channels) return {};
  const style: CSSProperties & Record<string, string | number> = {};
  if (channels.angle) style.transform = `rotate(${channels.angle}deg)`;
  // Distance shrank the card's box; shrink what is printed on it to match.
  if (channels.scale !== undefined) style['--xb-scale'] = channels.scale;
  if (channels.focus) style['--xb-focus'] = channels.focus;
  return style;
}

/** A card turned a quarter is a card whose preferred size is on its side. */
function isTapped(w: number, h: number): boolean {
  return w > h;
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
  const size = node.hints?.preferredSize ?? CARD;
  const tapped = isTapped(size.w, size.h);
  const className = [
    'xb-card',
    land ? 'xb-card--land' : '',
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
        style={cardStyle(channels)}
        data-testid={`xb-card-${nodeId}`}
        data-tapped={tapped ? 'true' : undefined}
        onClick={() => store.setHints(nodeId, { preferredSize: { w: size.h, h: size.w } })}
      >
        <span className="xb-card__name">{String(node.meta?.title ?? nodeId)}</span>
        <span className="xb-card__art" aria-hidden="true" />
        <span className="xb-card__foot">
          <span>{land ? 'Land' : 'Unit'}</span>
          <span>{String(node.meta?.power ?? '')}</span>
        </span>
      </button>
    </DragHandle>
  );
}

function Band({ id }: { id: NodeId }) {
  const drag = useDragState();
  const store = useStore();
  // The tableau projected this band and said by how much. A band sits at one
  // depth, so its cards are uniformly smaller rather than each shrinking on
  // its own — which is what a container `view` is for, and it keeps drags
  // tracking because windease divides pointer deltas by the scale.
  const scale = useChannelsForSelf(id)?.scale ?? 1;
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
        view={{ x: 0, y: 0, scale }}
        pointer={id === YOUR_HAND}
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

const CHROME: ChromeMap = {
  zone: ({ node }) =>
    node.id === TABLEAU || node.id === MAIN || node.id === RAIL ? (
      <div className="xb-nest">
        <Container parentId={node.id} chrome={CHROME} />
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
  return (
    <Provider store={store}>
      <StrategyRegistryProvider strategies={STRATEGIES}>
        <DragProvider>
          <GeometryProvider>
            <FocusProvider>
              <div className="xb-root" data-testid="xb-root">
                <div className="xb-table">
                  <div className="xb-main">
                    <Container parentId={MAIN} chrome={CHROME} />
                  </div>
                  <div className="xb-rail">
                    <Container parentId={RAIL} chrome={CHROME} />
                  </div>
                </div>
                <p className="xb-hint">
                  Drag a card out of your hand onto one of your two bands, or back. The far half of
                  the table refuses your cards, and so does the opponent's hand. Click any card to
                  turn it a quarter — its preferred size swaps, and the band reflows around the new
                  footprint. Sweep the pointer across your hand and the fan parts under it.
                </p>
              </div>
            </FocusProvider>
          </GeometryProvider>
        </DragProvider>
      </StrategyRegistryProvider>
    </Provider>
  );
};
