/**
 * The card pool for the duel board story: a few hundred cards generated from a
 * name grammar and a line pool, deterministically, so the board looks the same
 * on every render and in every screenshot.
 *
 * A generator rather than a list because a list of three hundred cards is three
 * hundred things to keep in step with the `Card` shape. Nothing here is anyone's
 * property: the words are ordinary demonyms, household objects and invented
 * fantasy terms, deliberately colliding.
 */

export type Rarity = 'common' | 'uncommon' | 'rare' | 'mythic';

/**
 * What a card is, which decides where it may be played. `aura` is the one that
 * does not go to a band at all: it attaches to a unit already on the table.
 */
export type CardKind = 'land' | 'unit' | 'artifact' | 'enchantment' | 'aura' | 'spell';

/**
 * The set's eight mana types. No two of them are the same kind of thing — a
 * suit, a country, an allium, a fuel, a silence, an insect, a feeling and an
 * absence — which is the joke, and also why nobody has ever agreed on the
 * order to print them in. `frame` is the card border it takes, `panel` the tint under its
 * text, `ink` the color its art is drawn in.
 */
export const MANA = {
  clubs: { label: 'Clubs', glyph: '♣', frame: '#2b2f33', panel: '#d9dcd8', ink: '#15181b' },
  america: { label: 'America', glyph: '★', frame: '#2f4570', panel: '#dfe3ee', ink: '#8c2b33' },
  garlic: { label: 'Garlic', glyph: '✿', frame: '#7a6f86', panel: '#efe9dd', ink: '#584a63' },
  peat: { label: 'Peat', glyph: '●', frame: '#4a3a29', panel: '#e3d9c6', ink: '#2c2015' },
  hush: { label: 'Hush', glyph: '◐', frame: '#5d5f72', panel: '#dfe0e6', ink: '#3b3d4d' },
  bees: { label: 'Bees', glyph: '⬣', frame: '#8a6a1c', panel: '#f0e4c2', ink: '#3b2c08' },
  love: { label: 'Love', glyph: '♥', frame: '#8c2f4a', panel: '#f2dde3', ink: '#5e1a2e' },
  /** Not a color at all. A Hole card is printed with one punched through it,
   *  and you pay for it with what you can see of the table underneath. */
  hole: { label: 'Hole', glyph: '○', frame: '#6e6a63', panel: '#e2e0da', ink: '#3a3833' },
} as const;

export type Mana = keyof typeof MANA;
export const MANA_TYPES = Object.keys(MANA) as Mana[];

export interface PoolCard {
  id: string;
  name: string;
  kind: CardKind;
  /** `kind === 'land'`, kept as its own field because almost everything that
   *  reads a card asks this one question. */
  land: boolean;
  mana: Mana;
  /** Empty for anything without a fight in it. */
  power: string;
  /** What it costs to play. Zero for a land, which is the thing you play to
   *  afford the rest. */
  cost: number;
  type: string;
  text: string;
  rarity: Rarity;
  foil: boolean;
  hue: number;
}

/** Deterministic PRNG, so the pool is a pure function of its seed. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DEMONYMS = [
  'Belgian',
  'Cornish',
  'Latvian',
  'Peruvian',
  'Nepalese',
  'Icelandic',
  'Bavarian',
  'Neapolitan',
  'Tasmanian',
  'Andalusian',
  'Manitoban',
  'Galician',
  'Frisian',
  'Moldovan',
  'Cantonese',
  'Gujarati',
  'Ligurian',
  'Faroese',
  'Yorkshire',
  'Alsatian',
  'Swabian',
  'Kentish',
  'Wallonian',
  'Estonian',
  'Sardinian',
  'Silesian',
  'Anatolian',
  'Basque',
  'Flemish',
  'Corsican',
  'Piedmontese',
  'Jutlandic',
  'Carpathian',
  'Appalachian',
];

const HOUSEHOLD = [
  'Stepladder',
  'Dish Rack',
  'Trouser Press',
  'Colander',
  'Draining Board',
  'Bread Box',
  'Coat Hook',
  'Nail Brush',
  'Doorstop',
  'Extension Cord',
  'Dish Towel',
  'Sock Drawer',
  'Ironing Board',
  'Trash Bag',
  'Fuse Box',
  'Baseboard',
  'Draft Stopper',
  'Attic Hatch',
  'Cake Tin',
  'Gravy Boat',
  'Egg Cup',
  'Spirit Level',
  'Trash Can',
  'Bath Mat',
  'Shoe Horn',
  'Letter Rack',
  'Napkin Ring',
  'Lampshade',
  'Mop Bucket',
  'Drying Rack',
  'Pillowcase',
  'Hot Water Bottle',
  'Radiator Key',
  'Rolling Pin',
  'Casserole Dish',
  'Lint Trap',
  'Box Fan',
  'Storm Door',
  'Slow Cooker',
  'Weed Whacker',
  'Screen Door',
  'Garden Hose',
  'Wheelbarrow',
  'Milk Crate',
  'Broom Closet',
  'Junk Drawer',
];

const FANTASY_ADJ = [
  'Spectral',
  'Void-touched',
  'Eldritch',
  'Sunken',
  'Gilded',
  'Thorned',
  'Weeping',
  'Hallowed',
  'Rimebound',
  'Ashen',
  'Verdant',
  'Wretched',
  'Radiant',
  'Gloom-fed',
  'Mireborn',
  'Star-cursed',
  'Bramblewrought',
  'Duskclad',
  'Emberlit',
  'Hollow',
  'Grave-warm',
  'Saltbitten',
  'Moonsick',
  'Unbudgeted',
];

const FANTASY_NOUN = [
  'Wyrm',
  'Revenant',
  'Covenant',
  'Sigil',
  'Reliquary',
  'Bastion',
  'Warden',
  'Herald',
  'Oracle',
  'Effigy',
  'Grimoire',
  'Bulwark',
  'Thrall',
  'Seraph',
  'Basilisk',
  'Geas',
  'Cairn',
  'Wight',
  'Idol',
  'Rite',
  'Ossuary',
  'Lament',
  'Aegis',
  'Doom',
];

const TYPES = [
  'Sentinel',
  'Skirmisher',
  'Adept',
  'Drake',
  'Pilgrim',
  'Runner',
  'Sprite',
  'Revenant',
  'Beast',
  'Yeoman',
  'Harvester',
  'Cooper',
  'Reeve',
  'Artifact Sentinel',
  'Spirit Beast',
  'Thresher',
  'Hedge Knight',
  'Drover',
];

/** A fifth of the lands are cities. */
const CITY_LANDS = [
  'Mumbai',
  'Nairobi',
  'Lagos',
  'Manila',
  'Rio de Janeiro',
  'Cape Town',
  'Karachi',
  'Mexico City',
  'Caracas',
  'Port-au-Prince',
  'Jakarta',
  'Dhaka',
];

const LAND_NAMES = [
  'Fallow Acre',
  'Deepwood',
  'Wellspring',
  'Ember Vent',
  'The Back Forty',
  'Marshpath',
  'Bottom Meadow',
  'Saltflat',
  'Long Headland',
  'Cold Frame',
  'Stony Ridge',
  'The Nine Acre',
  'Drainage Ditch',
  'Wind Row',
  'Silage Clamp',
  'Hazel Hedge',
  'Low Paddock',
  'Turnip Field',
];

/** Roughly two in five lines are about farming, which is the rate the set's
 *  designers were thinking about their allotments. */
const FARM_LINES = [
  'Turn to harvest one row, planted or not.',
  'Whoever controls this also controls the muck spreader.',
  'Cannot block while the silage is being cut.',
  'Sacrifice a land: bale two rows.',
  'Draws a card at the first frost.',
  'Enters turned if the tractor is already out.',
  'Gets +1/+1 for each fallow acre you control.',
  'Its owner must re-hang the gate each upkeep.',
  'The heifers will not walk past it.',
  'Counts toward the herd total, for better or worse.',
  'Deals 1 damage to anything in the top field.',
  'Blocks only on the near side of the ditch.',
  'You may pay one to lime the back forty instead.',
  'Yields two if it rained in the previous turn.',
  'Somebody has to be up at four for this.',
  'Spoils if it is not turned by the weekend.',
  'Attracts crows. This is not optional.',
  'The fence was supposed to be temporary.',
];

const MUNDANE_LINES = [
  'Returns to the drawer when it leaves play.',
  'Needs descaling every third turn.',
  'Its warranty expired two turns ago.',
  'May be returned within 28 days, with the receipt.',
  'Somebody has already lost the manual.',
  'Requires two AA batteries, not included.',
  'Do not immerse this in water.',
  'Wipe clean with a damp cloth.',
  'Assembly takes longer than the box claims.',
  'Fits most standard fittings.',
  'Was on offer, which is the only reason you have it.',
  'Comes with a spare part nobody can place.',
  'Sits in the hall until someone deals with it.',
];

const ABSURD_LINES = [
  'Remembers a door that was never installed.',
  'Whispers the wrong name at dawn.',
  'Cannot be looked at directly on a Tuesday.',
  'Its shadow arrives one turn after it does.',
  'Counts as two things at once, inconveniently.',
  'Owes a favor to something under the stairs.',
  'Is, technically, still in the mail.',
  'Has opinions about the other cards in your hand.',
  'Ages in the wrong direction while untapped.',
  'Only the youngest player may read this line.',
];

const RARITIES: Rarity[] = ['common', 'common', 'common', 'uncommon', 'uncommon', 'rare', 'mythic'];

const pick = <T>(r: () => number, xs: T[]): T => xs[Math.floor(r() * xs.length)]!;

/** Five name shapes, each putting the ordinary next to the invented. */
function nameOf(r: () => number): string {
  switch (Math.floor(r() * 5)) {
    case 0:
      return `${pick(r, DEMONYMS)} ${pick(r, HOUSEHOLD)}`;
    case 1:
      return `${pick(r, FANTASY_ADJ)} ${pick(r, HOUSEHOLD)}`;
    case 2:
      return `${pick(r, HOUSEHOLD)} of ${pick(r, FANTASY_NOUN)}s`;
    case 3:
      return `${pick(r, DEMONYMS)} ${pick(r, FANTASY_NOUN)}`;
    default:
      return `${pick(r, FANTASY_ADJ)} ${pick(r, DEMONYMS)} ${pick(r, HOUSEHOLD)}`;
  }
}

function textOf(r: () => number): string {
  const roll = r();
  if (roll < 0.4) return pick(r, FARM_LINES);
  if (roll < 0.72) return pick(r, MUNDANE_LINES);
  return pick(r, ABSURD_LINES);
}

/** How often each kind comes up, cumulative. Lands are a third of the deck
 *  because nothing else can be played without them. */
const KIND_WEIGHTS: Array<[CardKind, number]> = [
  ['land', 0.32],
  ['unit', 0.6],
  ['artifact', 0.76],
  ['enchantment', 0.86],
  ['aura', 0.94],
  ['spell', 1],
];

function kindOf(r: () => number): CardKind {
  const roll = r();
  for (const [kind, upto] of KIND_WEIGHTS) if (roll < upto) return kind;
  return 'spell';
}

/** An artifact is a household object with a demonym or a portent on it, which
 *  is the whole reason the household list is as long as it is. */
function artifactName(r: () => number): string {
  return r() < 0.5
    ? `${pick(r, DEMONYMS)} ${pick(r, HOUSEHOLD)}`
    : `${pick(r, FANTASY_ADJ)} ${pick(r, HOUSEHOLD)}`;
}

/** Enchantments, auras and one-shots lean on the invented half of the bank. */
function spellName(r: () => number): string {
  switch (Math.floor(r() * 3)) {
    case 0:
      return `${pick(r, FANTASY_ADJ)} ${pick(r, FANTASY_NOUN)}`;
    case 1:
      return `${pick(r, HOUSEHOLD)} of ${pick(r, FANTASY_NOUN)}s`;
    default:
      return `${pick(r, DEMONYMS)} ${pick(r, FANTASY_NOUN)}`;
  }
}

const AURA_LINES = [
  'Attached unit gets +2/+2 and a draft it cannot place.',
  'Attached unit cannot be turned while the kettle is on.',
  'Attached unit gets +1/+3 and answers to a different name.',
  'Attached unit taps for one of any type, badly.',
  'Attached unit gains reach, which nobody asked it to.',
  'Attached unit is, for rules purposes, a chair.',
];

const ENCHANT_LINES = [
  'Lands you control turn for one extra on a clear morning.',
  'Whenever anything enters, somebody sighs.',
  'Units cost one less if you have already read the manual.',
  'At the start of each turn, the hallway is longer.',
  'Nobody may mention the thing in the loft.',
];

function nameFor(r: () => number, kind: CardKind): string {
  if (kind === 'land') return r() < 0.2 ? pick(r, CITY_LANDS) : pick(r, LAND_NAMES);
  if (kind === 'artifact') return artifactName(r);
  if (kind === 'unit') return nameOf(r);
  return spellName(r);
}

function typeLineFor(r: () => number, kind: CardKind): string {
  switch (kind) {
    case 'land':
      return 'Land';
    case 'unit':
      return pick(r, TYPES);
    case 'artifact':
      return r() < 0.3 ? 'Artifact — Fixture' : 'Artifact';
    case 'enchantment':
      return 'Enchantment';
    case 'aura':
      return 'Enchantment — Aura';
    default:
      return r() < 0.5 ? 'Sorcery' : 'Instant';
  }
}

function textFor(r: () => number, kind: CardKind): string {
  switch (kind) {
    case 'land':
      return `Turn for one. ${pick(r, FARM_LINES)}`;
    case 'aura':
      return pick(r, AURA_LINES);
    case 'enchantment':
      return pick(r, ENCHANT_LINES);
    case 'artifact':
      return r() < 0.6 ? pick(r, MUNDANE_LINES) : pick(r, ABSURD_LINES);
    default:
      return textOf(r);
  }
}

/** `count` cards, the same ones every time for a given `seed`. */
export function cardPool(count = 320, seed = 20260921): PoolCard[] {
  const r = rng(seed);
  const out: PoolCard[] = [];
  for (let i = 0; i < count; i++) {
    const kind = kindOf(r);
    const land = kind === 'land';
    const rarity = land ? 'common' : pick(r, RARITIES);
    const p = 1 + Math.floor(r() * 6);
    const t = 1 + Math.floor(r() * 6);
    out.push({
      id: `c${i}`,
      kind,
      land,
      mana: pick(r, MANA_TYPES),
      name: nameFor(r, kind),
      power: kind === 'unit' ? `${p}/${t}` : '',
      cost: land ? 0 : 1 + Math.floor(r() * 6),
      type: typeLineFor(r, kind),
      text: textFor(r, kind),
      rarity,
      foil: r() < 0.04,
      hue: Math.floor(r() * 360),
    });
  }
  return out;
}
