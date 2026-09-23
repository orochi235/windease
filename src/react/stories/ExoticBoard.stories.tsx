export default { title: 'Exotic / Board' };

import type { Story } from '@ladle/react';
import {
  type CSSProperties,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
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
import { motifFor } from './board-art.js';
import {
  type CardKind,
  cardPool,
  MANA,
  MANA_TYPES,
  type Mana,
  type PoolCard,
} from './board-cards.js';
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

/** Magic's own proportion: a card is 63mm by 88mm. Every card on this board is
 *  drawn to it, and none of them derives a height from the box it landed in —
 *  each carries `aspect`, so `crossAlign` sizes the cross axis from the ratio
 *  rather than stretching the card to fill its row. */
const CARD_RATIO = 63 / 88;
const card = (h: number) => ({ w: Math.round(h * CARD_RATIO), h });

/** On the table. */
const CARD = card(150);
/**
 * In your hand. Sized so the card the cursor magnifies still fits the band:
 * `bow` turns it ~13.5° and `swell` grows it by `gain` and lifts it, which at
 * `HAND_BAND_H` leaves `(216 - 22) / (1.139 · 1.75)`. Raise `gain` or the band
 * and this can grow with it; the three move together.
 */
const HAND_CARD = card(96);
/** The opponent's hand, seen across the table. */
const BACK = card(62);

const BAND_PAD = 8;
/** A table row: one card tall plus its padding. */
const BAND_H = CARD.h + 2 * BAND_PAD;
const OPP_HAND_H = BACK.h + 2 * BAND_PAD;
/**
 * Your hand needs headroom the table rows do not, and it is drawn at this
 * height rather than scaled into it: `bow` turns the outermost cards about
 * 13.5°, and `swell` magnifies and lifts whichever one the cursor is under.
 * Room for the card that grew, not just the one at rest.
 */
const HAND_BAND_H = 216;

/** The logical width a table row lays out in, whatever width it is drawn at. */
const BAND_W = 700;
/**
 * How much of a covered card stays showing once the hand is fanning. It is the
 * floor `overflowMode: 'overlap'` will not shorten the step past, so it is also
 * the point at which the hand stops fanning and starts scrolling: past it the
 * row reports overflow and the wrapper has something to scroll.
 */
const HAND_PEEK = 26;

/** How many cards each band is dealt, far to near. The rest stay in the deck,
 *  which is what the library pile counts. */
/** What each band will take, far to near. A hand takes anything. */
const DEAL: Array<[NodeId, number, CardKind[] | 'any']> = [
  [OPP_FIELD, 3, ['unit', 'artifact']],
  [OPP_LAND, 4, ['land']],
  [YOUR_FIELD, 2, ['unit', 'artifact', 'enchantment']],
  [YOUR_LAND, 5, ['land']],
  [YOUR_HAND, 7, 'any'],
];

/** The opening hand is stacked on purpose: one of each kind, so every card
 *  type in the set is one drag away without having to draw for it. */
const HAND_WANTS: CardKind[] = ['land', 'unit', 'aura', 'artifact', 'spell', 'enchantment', 'unit'];

const POOL = cardPool();

/** The deal: take from the pool in order, honoring each band's want. */
function deal(): { hands: Map<NodeId, PoolCard[]>; left: number } {
  const hands = new Map<NodeId, PoolCard[]>();
  let next = 0;
  for (const [band, n, want] of DEAL) {
    const taken: PoolCard[] = [];
    if (band === YOUR_HAND) {
      // Scan the rest of the pool for one of each wanted kind rather than
      // taking in order, so a stacked hand does not eat the library.
      const used = new Set<number>();
      for (const kind of HAND_WANTS) {
        for (let i = next; i < POOL.length; i++) {
          if (used.has(i) || POOL[i]!.kind !== kind) continue;
          used.add(i);
          taken.push(POOL[i]!);
          break;
        }
      }
      next = Math.max(next, ...used) + 1;
      hands.set(band, taken);
      continue;
    }
    while (taken.length < n && next < POOL.length) {
      const card = POOL[next++]!;
      // A hand may hold an aura; a band may not, because an aura is played
      // onto a unit rather than into a row.
      if (want === 'any' ? false : !want.includes(card.kind)) continue;
      taken.push(card);
    }
    hands.set(band, taken);
  }
  return { hands, left: POOL.length - next };
}

/** The deal happens once, at module scope, so `DEALT` can say where in the
 *  pool the library now starts. */
const DEALT_HANDS = deal();
const DEALT = POOL.length - DEALT_HANDS.left;

/** An aura riding on a unit is drawn as a tab on its host, not as a card. */
const CHIP = { w: 20, h: 26 };

/** An aura is the only thing a unit will take, and only on your side. */
function unitAccepts(store: Store, hostId: NodeId) {
  return ({ sourceId }: { sourceId: NodeId }) => {
    if (!YOURS.includes(store.getNode(hostId)?.membership?.parentId as NodeId)) return false;
    return store.getNode(sourceId)?.meta?.cardKind === 'aura';
  };
}

/** One card node, however it reached the table — dealt at setup or drawn. */
function cardNode(id: NodeId, parentId: NodeId, card: PoolCard) {
  return createNode({
    kind: 'card',
    focus: true,
    id,
    parentId,
    // A unit holds its own auras. That makes the card a container, so a drop
    // resolves against the creature itself rather than the row it is standing
    // in — the same `canAccept` path a zone uses.
    ...(card.kind === 'unit'
      ? {
          container: {
            strategyId: 'strip',
            config: {
              axis: 'x',
              gap: 2,
              padding: 2,
              justify: 'start',
              fill: false,
              resizable: false,
              overflowMode: 'overlap',
              peek: 8,
            },
          },
        }
      : {}),
    meta: {
      title: card.name,
      cardKind: card.kind,
      land: card.land,
      mana: card.mana,
      power: card.power,
      cost: card.cost,
      type: card.type,
      text: card.text,
      rarity: card.rarity,
      foil: card.foil,
      hue: card.hue,
    },
    hints: {
      preferredSize: { ...(parentId === YOUR_HAND ? HAND_CARD : CARD) },
      aspect: CARD_RATIO,
    },
  });
}

/** An empty pool, one entry per type, so a readout never has to guess a zero. */
const emptyMana = (): Record<Mana, number> =>
  Object.fromEntries(MANA_TYPES.map((m) => [m, 0])) as Record<Mana, number>;

const manaTotal = (pool: Record<Mana, number>): number =>
  MANA_TYPES.reduce((sum, m) => sum + pool[m], 0);

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
        config: { axis: 'y', gap: 7, padding: 4, resizable: false },
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
      container: { strategyId: 'hand', config: bandConfig({ peek: HAND_PEEK }) },
      meta: { title: 'Your hand' },
      placement: { size: { h: HAND_BAND_H } },
    }),
  );
  s.showNode(YOUR_HAND);

  // Far to near on one surface, every row the same height so no card is
  // drawn to a different shape than any other.
  const bands: Array<[NodeId, string, Record<string, unknown>, number]> = [
    [OPP_HAND, "Opponent's hand", bandConfig({ peek: 26 }), OPP_HAND_H],
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

  const { hands, left } = DEALT_HANDS;

  s.registerNode(
    createNode({
      kind: 'mana',
      id: asNodeId('mana'),
      parentId: RAIL,
      placement: { size: { h: 132 } },
    }),
  );
  s.showNode(asNodeId('mana'));
  s.registerNode(
    createNode({
      kind: 'draw',
      id: asNodeId('draw'),
      parentId: RAIL,
      placement: { size: { h: 44 } },
    }),
  );
  s.showNode(asNodeId('draw'));

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
        placement: { size: { h: 72 } },
      }),
    );
    s.showNode(nid);
  }

  for (const [band, cards] of hands) {
    // Positional ids rather than the pool's own, so a band's third card is
    // addressable whatever the pool deals into it.
    for (const [i, card] of cards.entries()) {
      const nid = asNodeId(`${band}-${i}`);
      s.registerNode(cardNode(nid, band, card));
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
        hints: { preferredSize: { ...BACK }, aspect: CARD_RATIO },
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

/**
 * The picture. A sky wash and a ground line in the card's own hue, and over
 * them the motif its name earned — a colander on a Colander, rooftops on
 * Mumbai — drawn from the shared vocabulary in `board-art`.
 */
function CardArt({ meta, land }: { meta: Record<string, unknown>; land: boolean }) {
  const motif = motifFor(String(meta.title ?? ''), String(meta.type ?? ''), land);
  return (
    <svg className="xb-art" viewBox="0 0 100 100" preserveAspectRatio="xMidYMax meet">
      <title>{String(meta.title ?? '')}</title>
      <rect className="xb-art__sky" x="0" y="0" width="100" height="100" />
      <path className="xb-art__ground" d="M0 78 Q26 70 52 76 Q78 82 100 74 L100 100 L0 100 Z" />
      {motif?.ink.map((d) => (
        <path key={d} className="xb-art__ink" d={d} />
      ))}
      {motif?.cut?.map((d) => (
        <path key={d} className="xb-art__cut" d={d} />
      ))}
    </svg>
  );
}

/** The printed face, with no drag handle and no store behind it, so the table
 *  and the lightbox draw exactly the same card. */
function CardPrint({ meta, mana }: { meta: Record<string, unknown>; mana: Mana }) {
  const land = meta.land === true;
  const cost = Number(meta.cost ?? 0);
  return (
    <>
      <span className="xb-card__title">
        <span className="xb-card__name">{String(meta.title ?? '')}</span>
        <span className="xb-card__cost">
          {cost > 0 ? <span className="xb-card__pips">{String(cost)}</span> : null}
          <span className={`xb-card__mana xb-card__mana--${mana}`} title={MANA[mana].label}>
            {MANA[mana].glyph}
          </span>
        </span>
      </span>
      <span className={`xb-card__art${land ? ' xb-card__art--land' : ''}`} aria-hidden="true">
        <CardArt meta={meta} land={land} />
      </span>
      <span className="xb-card__type">
        <span>{String(meta.type ?? (land ? 'Land' : 'Unit'))}</span>
        <span className="xb-card__set" aria-hidden="true">
          ◈
        </span>
      </span>
      <span className="xb-card__rules">{String(meta.text ?? '')}</span>
      {meta.power ? <span className="xb-card__power">{String(meta.power)}</span> : null}
    </>
  );
}

/** The classes a card wears, which the lightbox copies so the big one is the
 *  same card and not a second design. */
function cardClass(meta: Record<string, unknown>, mana: Mana, extra: string[] = []): string {
  return [
    'xb-card',
    `xb-card--${String(meta.rarity ?? 'common')}`,
    meta.land === true ? 'xb-card--land' : '',
    meta.foil === true ? 'xb-card--foil' : '',
    `xb-card--${mana}`,
    ...extra,
  ]
    .filter(Boolean)
    .join(' ');
}

/**
 * A unit's auras, and the target that lets you add one.
 *
 * The drop target is only mounted while an aura is actually in the air. A
 * container that is always there is always hit-tested, so a unit standing in
 * the row would quietly swallow every drop aimed at the row behind it — which
 * is exactly what it did the first time round. The rest of the time the
 * attached auras are drawn as plain tabs, still draggable, targeting nothing.
 */
function AuraSlot({ nodeId }: { nodeId: NodeId }) {
  const store = useStore();
  const drag = useDragState();
  const children = useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getNode(nodeId)?.container?.childOrder.join(',') ?? '',
  );
  const draggingAura = drag !== null && store.getNode(drag.draggingId)?.meta?.cardKind === 'aura';

  if (draggingAura) {
    return (
      <Container
        parentId={nodeId}
        chrome={CHROME}
        className="xb-card__auras xb-card__auras--live"
        // Container writes `position` inline, which beats the class, so the
        // box that gets registered as the drop target is placed here.
        style={{ position: 'absolute', inset: 0 }}
        acceptPolicy={unitAccepts(store, nodeId)}
      />
    );
  }
  const ids = children ? (children.split(',') as NodeId[]) : [];
  if (ids.length === 0) return null;
  return (
    <span className="xb-card__auras">
      {ids.map((id) => (
        <AuraTab key={id} nodeId={id} />
      ))}
    </span>
  );
}

/** A card riding on another card is an aura; anywhere else it is a card. The
 *  question is the parent's kind, not the id's shape. */
function CardOrAura({ nodeId }: { nodeId: NodeId }) {
  const store = useStore();
  const onCard = useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => {
      const parent = store.getNode(nodeId)?.membership?.parentId;
      return parent !== undefined && store.getNode(parent)?.kind === 'card';
    },
  );
  return onCard ? <AuraTab nodeId={nodeId} /> : <CardFace nodeId={nodeId} />;
}

/** An aura attached to a unit: a tab down the host's edge, carrying its type
 *  and enough of its name to tell two apart. */
function AuraTab({ nodeId }: { nodeId: NodeId }) {
  const store = useStore();
  const node = useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getNode(nodeId),
  );
  const { zoom } = useGame();
  if (!node) return null;
  const meta = (node.meta ?? {}) as Record<string, unknown>;
  const mana = (meta.mana ?? 'peat') as Mana;
  return (
    <DragHandle nodeId={nodeId} className="xb-aura-drag">
      <button
        type="button"
        className={`xb-aura xb-aura--${mana}`}
        data-testid={`xb-aura-${nodeId}`}
        title={String(meta.title ?? '')}
        aria-label={String(meta.title ?? 'Aura')}
        onContextMenu={(e) => {
          e.preventDefault();
          zoom(nodeId);
        }}
      >
        {MANA[mana].glyph}
      </button>
    </DragHandle>
  );
}

function CardFace({ nodeId }: { nodeId: NodeId }) {
  const store = useStore();
  const node = useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getNode(nodeId),
  );
  const channels = useChannelsForSelf(nodeId);
  const { tapLand, zoom } = useGame();
  if (!node) return null;
  const meta = (node.meta ?? {}) as Record<string, unknown>;
  const land = meta.land === true;
  const tapped = isTapped(node.hints?.turn);
  const mana = (meta.mana ?? 'peat') as Mana;
  // Turning a land is how you make mana, so the same click does both: the
  // library moves the card, the game moves the number.
  const turn = () => {
    store.turnTo(nodeId, tapped ? 0 : 90, { ms: 220 });
    if (land && node.membership?.parentId === YOUR_LAND) tapLand(mana, !tapped);
  };
  const className = cardClass(meta, mana, [
    tapped ? 'xb-card--tapped' : '',
    channels?.focus ? 'xb-card--focus' : '',
  ]);

  return (
    <DragHandle nodeId={nodeId} className="xb-card-drag">
      <button
        type="button"
        className={className}
        style={
          {
            ...cardStyle(channels),
            '--xb-hue': String(meta.hue ?? 200),
          } as CSSProperties
        }
        data-testid={`xb-card-${nodeId}`}
        data-tapped={tapped ? 'true' : undefined}
        data-kind={String(meta.cardKind ?? 'unit')}
        data-mana={mana}
        onClick={turn}
        onContextMenu={(e) => {
          e.preventDefault();
          zoom(nodeId);
        }}
      >
        <CardPrint meta={meta} mana={mana} />
      </button>
      {node.container ? <AuraSlot nodeId={nodeId} /> : null}
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
  const hand = id === YOUR_HAND;
  const isTarget = drag?.hover?.targetId === id;
  const accepted = isTarget && drag?.hover?.accepted === true;
  const className = [
    'xb-band',
    hand || id === OPP_HAND ? 'xb-band--hand' : 'xb-band--field',
    isTarget && accepted ? 'xb-band--accept' : '',
    isTarget && !accepted ? 'xb-band--reject' : '',
  ]
    .filter(Boolean)
    .join(' ');
  if (hand) return <YourHand className={className} />;
  return (
    <div className={className} data-testid={`xb-band-${id}`}>
      <Container
        parentId={id}
        chrome={CHROME}
        viewport={{ w: BAND_W, h: BAND_H }}
        fit="contain"
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
 * Your hand is the one band that scrolls. Every other band is `fit="contain"`:
 * a fixed logical box scaled into the row the projection left it, so a card is
 * the same shape wherever it sits. The hand cannot be, because `swell` parts
 * the run around the cursor and a fitted frame would crop what it pushed out —
 * and a frame cannot both scroll on one axis and spill on the other, since an
 * `overflow-y: visible` beside an `overflow-x: auto` computes to `auto`.
 *
 * So it lays out at natural size in the width it is actually drawn at, and the
 * wrapper scrolls. `overflowMode: 'overlap'` still fans the cards first: the
 * step shortens to `peek` before anything is reported as overflow, so the
 * scrollbar appears only once fanning has run out of room.
 */
function YourHand({ className }: { className: string }) {
  const store = useStore();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [viewport, setViewport] = useState<{ w: number; h: number } | null>(null);

  // The box the Container renders grows to `viewport + overflow`, so measuring
  // the Container itself would feed its own growth back in. The scroller's
  // width is what the board gave the band, and does not move with its content.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const box = entry?.contentRect;
      if (box) setViewport({ w: Math.round(box.width), h: Math.round(box.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div className={className} data-testid={`xb-band-${YOUR_HAND}`}>
      <div className="xb-hand-scroll" ref={scrollRef} data-testid="xb-hand-scroll">
        {viewport && (
          <Container
            parentId={YOUR_HAND}
            chrome={CHROME}
            viewport={viewport}
            pointer
            scrollRef={scrollRef}
            // The hand re-lays out on every pointermove. A settle transition
            // animates toward each new position and never arrives, which reads
            // as jitter; the swell is already continuous, so it needs no easing.
            settleMs={0}
            acceptPolicy={({ sourceId }) => {
              const from = store.getNode(sourceId)?.membership?.parentId;
              return from !== undefined && YOURS.includes(from);
            }}
          />
        )}
      </div>
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

/**
 * The game state the library deliberately knows nothing about: what mana you
 * have out, and what is left in the library. Everything windease cares about —
 * where a card is, which way round it is — lives in the store; this is the
 * consumer's own business, held beside it.
 */
interface Game {
  pool: Record<Mana, number>;
  /** Turning a land face-down pays you; turning it back takes it away. */
  tapLand: (mana: Mana, on: boolean) => void;
  /** Spends `cost` from the pool, cheapest types first. False when short. */
  spend: (cost: number) => boolean;
  affordable: (cost: number) => boolean;
  draw: () => void;
  library: number;
  /** The card held open in the lightbox, and how to open one. */
  zoomed: NodeId | null;
  zoom: (id: NodeId | null) => void;
}

const GameContext = createContext<Game | null>(null);
const useGame = (): Game => {
  const game = useContext(GameContext);
  if (!game) throw new Error('useGame outside the board');
  return game;
};

function useGameState(store: Store): Game {
  const [pool, setPool] = useState(emptyMana);
  const [zoomed, setZoomed] = useState<NodeId | null>(null);
  const [library, setLibrary] = useState(() => POOL.length - DEALT);
  const drawn = useRef(DEALT);

  const tapLand = useCallback((mana: Mana, on: boolean) => {
    setPool((p) => ({ ...p, [mana]: Math.max(0, p[mana] + (on ? 1 : -1)) }));
  }, []);

  const affordable = useCallback((cost: number) => manaTotal(pool) >= cost, [pool]);

  const spend = useCallback((cost: number) => {
    let ok = false;
    setPool((p) => {
      if (manaTotal(p) < cost) return p;
      ok = true;
      const next = { ...p };
      let left = cost;
      for (const m of MANA_TYPES) {
        const take = Math.min(left, next[m]);
        next[m] -= take;
        left -= take;
      }
      return next;
    });
    return ok;
  }, []);

  const draw = useCallback(() => {
    const card = POOL[drawn.current];
    if (!card) return;
    drawn.current += 1;
    setLibrary((n) => Math.max(0, n - 1));
    const nid = asNodeId(`drawn-${drawn.current}`);
    store.registerNode(cardNode(nid, YOUR_HAND, card));
    store.showNode(nid);
  }, [store]);

  const zoom = useCallback((id: NodeId | null) => setZoomed(id), []);

  return { pool, tapLand, spend, affordable, draw, library, zoomed, zoom };
}

const CHROME: ChromeMap = {
  zone: ({ node }) =>
    node.id === TABLEAU || node.id === MAIN || node.id === RAIL ? (
      <div className="xb-nest">
        <Container parentId={node.id} chrome={CHROME} acceptPolicy={REFUSE} />
      </div>
    ) : (
      <Band id={node.id} />
    ),
  card: ({ node }) => <CardOrAura nodeId={node.id} />,
  back: () => <div className="xb-card xb-card--back" aria-hidden="true" />,
  pile: ({ node }) => <Pile node={node} />,
  mana: () => <ManaPool />,
  draw: () => <DrawButton />,
};

function Pile({ node }: { node: { id: NodeId; meta?: Record<string, unknown> } }) {
  const game = useGame();
  const count = node.id === asNodeId('library') ? game.library : (node.meta?.count ?? 0);
  return (
    <div className="xb-pile" data-testid={`xb-pile-${node.id}`}>
      <span className="xb-pile__count">{String(count)}</span>
      <span>{String(node.meta?.title ?? node.id)}</span>
    </div>
  );
}

/** What you have out, by type. Turning a land pays into this; playing a card
 *  spends from it. */
function ManaPool() {
  const { pool } = useGame();
  return (
    <div className="xb-mana" data-testid="xb-mana">
      <span className="xb-mana__total" data-testid="xb-mana-total">
        {manaTotal(pool)}
      </span>
      <ul className="xb-mana__list">
        {MANA_TYPES.map((m) => (
          <li
            key={m}
            className={`xb-mana__pip xb-mana__pip--${m}${pool[m] ? '' : ' xb-mana__pip--empty'}`}
            title={MANA[m].label}
            data-testid={`xb-mana-${m}`}
          >
            <span className="xb-mana__glyph">{MANA[m].glyph}</span>
            <span className="xb-mana__n">{pool[m]}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A card held up close. Right-clicking the table asks for this; Escape, or a
 *  click anywhere on the scrim, puts it down. */
function Lightbox() {
  const store = useStore();
  const { zoomed, zoom } = useGame();
  const node = useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => (zoomed ? store.getNode(zoomed) : undefined),
  );

  useEffect(() => {
    if (!zoomed) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') zoom(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [zoomed, zoom]);

  if (!zoomed || !node) return null;
  const meta = (node.meta ?? {}) as Record<string, unknown>;
  const mana = (meta.mana ?? 'peat') as Mana;
  return (
    <div className="xb-lightbox" data-testid="xb-lightbox" role="dialog" aria-modal="true">
      <button
        type="button"
        className="xb-lightbox__scrim"
        aria-label="Close"
        onClick={() => zoom(null)}
        onContextMenu={(e) => {
          e.preventDefault();
          zoom(null);
        }}
      />
      <div
        className={`${cardClass(meta, mana)} xb-card--zoomed`}
        style={{ '--xb-hue': String(meta.hue ?? 200) } as CSSProperties}
        data-mana={mana}
        data-testid="xb-lightbox-card"
      >
        <CardPrint meta={meta} mana={mana} />
      </div>
    </div>
  );
}

function DrawButton() {
  const { draw, library } = useGame();
  return (
    <button
      type="button"
      className="xb-draw"
      data-testid="xb-draw"
      onClick={draw}
      disabled={library === 0}
    >
      Draw
    </button>
  );
}

export const DuelBoard: Story = () => {
  const store = useMemo(() => makeStore(), []);
  // The library interpolates a turn; something has to give it frames. A host
  // with its own loop calls `store.tick(now)` from there instead.
  useEffect(() => driveWithRaf(store), [store]);
  const game = useGameState(store);

  // Playing a card is a move the library performs and the game pays for. The
  // cost is charged here, on the store's own event, rather than inside
  // `acceptPolicy` — that runs on every pointermove of every drag.
  const { spend } = game;
  useEffect(
    () =>
      store.events.on('node.moved', ({ id, fromParentId, toParentId }) => {
        if (fromParentId !== YOUR_HAND || toParentId === YOUR_HAND) return;
        const cost = Number(store.getNode(id)?.meta?.cost ?? 0);
        if (cost > 0) spend(cost);
      }),
    [store, spend],
  );

  // An aura is a card in your hand and a tab on its host, so its size follows
  // it across. Nothing else changes: the store moved it, this only redresses it.
  useEffect(
    () =>
      store.events.on('node.moved', ({ id, toParentId }) => {
        if (store.getNode(id)?.meta?.cardKind !== 'aura') return;
        const onCard = store.getNode(toParentId)?.kind === 'card';
        store.setHints(id, {
          preferredSize: onCard ? { ...CHIP } : { ...HAND_CARD },
          aspect: onCard ? undefined : CARD_RATIO,
        });
      }),
    [store],
  );

  return (
    <GameContext.Provider value={game}>
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
                    Drag a card out of your hand onto one of your two bands, or back. The far half
                    of the table refuses your cards, and so does the opponent's hand. Click any card
                    to turn it a quarter — the band reserves the box the rotation needs and reflows
                    around it as the card turns. Sweep the pointer across your hand and the fan
                    parts under it.
                  </p>
                  <Lightbox />
                </div>
              </FocusProvider>
            </GeometryProvider>
          </DragProvider>
        </StrategyRegistryProvider>
      </Provider>
    </GameContext.Provider>
  );
};
