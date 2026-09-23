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

/**
 * A set's expansion symbol, printed on the type line and tinted by the card's
 * rarity the way a real one is.
 *
 * Most are one glyph. The alchemical and astrological ones are text
 * presentation, so they take the tint; an emoji is drawn in its own colors and
 * ignores it, which is why the emoji are the occasional intruders here rather
 * than the whole bank. `marks` is for a symbol no font draws — closed paths in
 * a 100 x 100 box. A path with no `fill` takes `currentColor` and so tints
 * like a glyph; one that names a color keeps it, like an emoji.
 */
export interface Expansion {
  id: string;
  /** The set's name, as it would read on a checklist. */
  label: string;
  glyph?: string;
  marks?: Array<{ d: string; fill?: string }>;
  /** Lettering over the marks, for a mark that is mostly letters. Drawn in the
   *  same 100 x 100 box, centered on `x`. */
  letters?: Array<{ s: string; x: number; y: number; size: number; fill?: string }>;
}

export const EXPANSIONS: Expansion[] = [
  { id: 'second-harvest', label: 'Second Harvest', glyph: '\u{1F346}' },
  { id: 'joint-filing', label: 'Joint Filing', glyph: '\u{1F587}\uFE0F' },
  { id: 'pilcrow', label: 'Pilcrow', glyph: '\u00B6' },
  {
    id: 'keep-dry',
    label: 'Keep Dry',
    // The shipping pictogram, tinting with the rarity like a glyph.
    marks: [
      { d: 'M 50 14 C 22 14 12 38 12 48 L 88 48 C 88 38 78 14 50 14 Z' },
      { d: 'M 46 48 L 54 48 L 54 82 C 54 90 40 90 40 82 L 48 82 L 48 48 Z' },
    ],
  },
  {
    id: 'flame-broiled',
    label: 'Flame Broiled',
    // Two bun halves around a patty, tinting with the rarity like a glyph.
    marks: [
      { d: 'M 12 44 C 12 18, 88 18, 88 44 L 12 44 Z' },
      { d: 'M 15 50 L 85 50 L 85 60 L 15 60 Z' },
      { d: 'M 12 66 L 88 66 C 88 90, 12 90, 12 66 Z' },
    ],
  },
  {
    id: 'this-way-out',
    label: 'This Way Out',
    // ISO 7010 E002. Keeps the green, because a running man that is not green
    // is not the sign — it is a man running.
    marks: [
      { d: 'M 2 18 L 98 18 L 98 82 L 2 82 Z', fill: '#00843d' },
      { d: 'M 34 22 A 8 8 0 1 0 50 22 A 8 8 0 1 0 34 22 Z', fill: '#ffffff' },
      { d: 'M 40 32 L 50 34 L 46 54 L 38 52 Z', fill: '#ffffff' },
      { d: 'M 46 54 L 58 68 L 52 74 L 38 58 Z', fill: '#ffffff' },
      { d: 'M 38 52 L 30 66 L 22 62 L 30 48 Z', fill: '#ffffff' },
      { d: 'M 48 36 L 62 42 L 59 49 L 45 43 Z', fill: '#ffffff' },
      { d: 'M 40 36 L 28 32 L 26 39 L 38 43 Z', fill: '#ffffff' },
      { d: 'M 70 26 L 92 26 L 92 74 L 70 74 L 70 67 L 85 67 L 85 33 L 70 33 Z', fill: '#ffffff' },
    ],
  },
  {
    id: 'combo-number-two',
    label: 'Combo Number Two',
    // A globe of one brand wearing the arches of another. Keeps both liveries,
    // because the whole joke is that you recognise each of them instantly.
    marks: [
      { d: 'M 8 50 A 42 42 0 0 1 92 50 C 76 41 60 45 50 47 C 33 50 20 45 8 50 Z', fill: '#e32934' },
      {
        d: 'M 8 50 C 20 45 33 50 50 47 C 66 44 80 41 92 50 C 80 55 66 60 50 58 C 33 56 20 56 8 50 Z',
        fill: '#f5f5f5',
      },
      { d: 'M 8 50 C 20 56 33 56 50 58 C 66 60 80 55 92 50 A 42 42 0 0 1 8 50 Z', fill: '#0f4d92' },
      {
        d: 'M 28 74 L 28 44 C 28 32 44 30 50 42 C 56 30 72 32 72 44 L 72 74 L 63 74 L 63 46 C 63 39 55 40 54 48 L 54 74 L 46 74 L 46 48 C 45 40 37 39 37 46 L 37 74 Z',
        fill: '#ffc72c',
      },
    ],
  },
  {
    id: 'mature-audiences',
    label: 'Mature Audiences',
    // The TV Parental Guidelines box. Black and white whatever the rarity, the
    // way it is on the corner of the screen for the first fifteen seconds.
    marks: [
      { d: 'M 10 18 L 90 18 L 90 82 L 10 82 Z', fill: '#101014' },
      { d: 'M 10 18 L 90 18 L 90 24 L 10 24 Z', fill: '#f2f2f2' },
      { d: 'M 16 48 L 84 48 L 84 52 L 16 52 Z', fill: '#f2f2f2' },
    ],
    letters: [
      { s: 'TV', x: 50, y: 45, size: 26, fill: '#f2f2f2' },
      { s: 'MA', x: 50, y: 75, size: 26, fill: '#f2f2f2' },
    ],
  },
  {
    id: 'special-hazard',
    label: 'Special Hazard',
    // NFPA 704, quadrant for quadrant: health, flammability, reactivity, and
    // the white square that says which way it reacts. It keeps its own colors,
    // so it is one of the intruders rather than a tinting sigil.
    marks: [
      { d: 'M 50 8 L 71 29 L 50 50 L 29 29 Z', fill: '#d8202a' },
      { d: 'M 29 29 L 50 50 L 29 71 L 8 50 Z', fill: '#1f5fbf' },
      { d: 'M 71 29 L 92 50 L 71 71 L 50 50 Z', fill: '#f2c318' },
      { d: 'M 50 50 L 71 71 L 50 92 L 29 71 Z', fill: '#f4f1e8' },
    ],
  },
];

export const EXPANSION_IDS = EXPANSIONS.map((e) => e.id);

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
  /** Which set it was printed in — an `EXPANSIONS` id. */
  expansion: string;
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

/** The same weights with `land` taken out and the rest renormalized, for a
 *  themed card: a land is a place, and none of the runs are about places. */
function kindOfNonLand(r: () => number): CardKind {
  for (let i = 0; i < 12; i++) {
    const kind = kindOf(r);
    if (kind !== 'land') return kind;
  }
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

/**
 * A run of cards that are all about one thing, printed in one set.
 *
 * A themed card takes its name, type line and rules text whole rather than
 * from the generators — the joke is in the specific phrasing, and a name
 * assembled from parts lands on the wrong side of it about half the time.
 * `share` is the fraction of the pool it takes.
 */
interface Theme {
  id: string;
  share: number;
  expansion: string;
  names: string[];
  types: string[];
  lines: string[];
}

const THEMES: Theme[] = [
  {
    id: 'dating',
    share: 0.08,
    expansion: 'second-harvest',
    names: [
      'Unprompted Voice Memo',
      'Second Photo Is A Dog',
      'Bathroom Mirror, Flash On',
      'Group Photo, No Arrow',
      'Left On Read',
      'Six Years Out Of Date',
      'Opening Line, Copied',
      'Sunset, Someone Cropped Out',
      'Three Drinks In',
      'Unmatched Mid-Sentence',
      'Height In The Bio',
      'The Fish',
      'Same Bar, Different Face',
      'Prompt Answered "lol"',
      'Ghost, Returning',
      'Mutual Friend, Regrettably',
      'Read At Two In The Morning',
      'Airport Lounge Energy',
    ],
    types: [
      'Match',
      'Match — Regret',
      'Notification',
      'Profile',
      'Profile — Archived',
      'Encounter',
      'Encounter — Brief',
    ],
    lines: [
      'Enters unmatched. You may not look at it again.',
      'It has a dog. The dog is not its dog.',
      'Cannot block, cannot be blocked, simply stops replying.',
      'Gets -1/-1 for every photo after the first.',
      'When this arrives, discard your opening line.',
      'Return it to its owner at end of turn. It does not remember you.',
      'Costs one less to play if you have already met.',
      'You may reveal this only once, and only in a group photo.',
      'Sacrifice a beverage: draw a card.',
      'If unanswered by the weekend, exile it.',
      'Whenever you tap this, it is seen and not answered.',
      'Its controller may not mention the other app.',
    ],
  },
  {
    id: 'dad-jokes',
    share: 0.13,
    expansion: 'mature-audiences',
    names: [
      "Hi Hungry, I'm Dad",
      'Nacho Cheese',
      'A Roamin\u2019 Soldier',
      'Deja Moo',
      'The Impasta',
      'Because It Was Two Tired',
      'Dam, Said The Fish',
      'A Can\u2019t-Elope',
      'The Elevator Business',
      'Sofa King Tired',
      'A Brief Case',
      'Pasture Bedtime',
      'Nothing, It Just Waved',
      'Drawn Butter',
      'The Pier Pressure',
      'Seoul Food',
      'Bison, Said The Buffalo',
      'Gravity, Undefeated',
    ],
    types: [
      'Groaner',
      'Groaner — Recurring',
      'Setup',
      'Punchline',
      'Dad — Ordinary',
      'Dad — Off Duty',
    ],
    lines: [
      'Whenever this is played, each opponent sighs. This has no other effect.',
      'You may tell this again. Its controller alone finds it funny.',
      'If a player says they are hungry, this enters untapped.',
      'Cannot be countered. It has already started.',
      'Whenever another groaner enters, this gets +1/+0.',
      'Its controller may not stop at the punchline.',
      'Exile this. Return it at the next family gathering.',
      'Gets +2/+2 for as long as a teenager is embarrassed.',
      'Whenever this deals damage, groan.',
      'Costs one less if somebody left the door open.',
      'Untap this whenever anyone says they are done.',
      'When this enters, say it again to the next person who arrives.',
    ],
  },
  {
    id: 'provisions',
    share: 0.12,
    expansion: 'combo-number-two',
    names: [
      'The Thrice-Stacked Sigil',
      'Vessel Of Frozen Sun',
      'The Everlasting Sponge',
      'The Nine-Piece Reliquary',
      'Sacrament Of Orange Dust',
      'Chalice Of Endless Refill',
      'The Long Meat',
      'The Unbroken Ring',
      'Golden Fry, Unsalted',
      'The Cold Rectangle',
      'Font Of Cheese Product',
      'The Glazed Ordinal',
      'Ember Of The Flame-Broiled',
      'Relic Of The Value Menu',
      'The Sundered Bun',
      'Wafer Of The Blue Box',
      'Oracle Of The Soft Serve',
      'The Anointed Curly',
      'Crown Of Wax Paper',
      'The Bottomless Basket',
    ],
    types: [
      'Relic',
      'Relic — Consumable',
      'Sacrament',
      'Provision',
      'Provision — Legendary',
      'Vessel',
    ],
    lines: [
      'Tap: gain one life. The taste is remembered for a generation.',
      'When this enters, all who stand near it fall silent.',
      'It does not spoil. It has never spoiled.',
      'Sacrifice this: draw a card. You will want another.',
      'Its wrapper is kept. No player can say why.',
      'Cannot be countered by anyone who has eaten.',
      'When revealed, each player recalls a car park after dark.',
      'Gets +1/+1 for each hour past midnight.',
      'Its controller may not share it, though they will offer.',
      'Exile at end of turn. Something of it remains on the fingers.',
      'While this is on the table, no player may leave.',
      'It was better before. Both players agree; neither is sure when.',
    ],
  },
  {
    id: 'marginalia',
    share: 0.05,
    expansion: 'pilcrow',
    names: [
      'Track Changes, Accepted',
      'Reply All',
      'The Second Reviewer',
      'Comment Resolved',
      'Per My Last Message',
      'Stet',
      'The Circulated Draft',
      'Version Final Final',
      'A Note In The Margin',
      'Redline, Unmerged',
      'The Long Thread',
      'Someone Has Edited This',
    ],
    types: ['Notation', 'Correspondence', 'Draft', 'Draft — Circulated', 'Revision'],
    lines: [
      'Return this to its author with one change and no explanation.',
      'Each player must respond. Nobody may be removed.',
      'Whenever this is revised, make a copy and lose the original.',
      'It was resolved. It is open again.',
      'Cannot be destroyed while anyone is still typing.',
      'Its controller has read the thread. Its controller has not read the thread.',
      'Exile this at end of turn. A copy remains in the folder.',
    ],
  },
  {
    id: 'damp',
    share: 0.05,
    expansion: 'keep-dry',
    names: [
      'The Coat That Never Dries',
      'Standing Water, Again',
      'A Towel From The Boot',
      'Condensation On The Inside',
      'The Fourth Wet Day',
      'Socks, Committed',
      'The Dehumidifier',
      'Wallpaper, Lifting',
      'Rain On The Skylight',
      'The Smell In The Hall',
      'A Bucket Under The Leak',
      'Grey, Until Thursday',
    ],
    types: ['Weather', 'Weather — Persistent', 'Condition', 'Damp', 'Damp — Structural'],
    lines: [
      'It will pass. It has not passed.',
      'Whenever this enters, all permanents get -0/-1 and feel it.',
      'Cannot be removed, only moved to another room.',
      'Each upkeep, put a water counter on this. It never leaves.',
      'Costs one less if something is already wet.',
      'Its controller may not open a window.',
      'While this is on the table, nothing dries.',
    ],
  },
  {
    id: 'cookout',
    share: 0.05,
    expansion: 'flame-broiled',
    names: [
      'The Man Who Owns The Tongs',
      'Charcoal, Not Gas',
      'Lighter Fluid, Generous',
      'The Second Beer',
      'Nobody Asked For Medium',
      'The Folding Chair',
      'A Cooler, Mostly Ice',
      'Hose Down The Patio',
      'The Long Silence At Dusk',
      'Citronella, Failing',
      'One More Burger',
      'The Neighbor Comes Over',
    ],
    types: ['Cookout', 'Cookout — Annual', 'Host', 'Host — Undisputed', 'Provision'],
    lines: [
      'Only its controller may turn it. This is not negotiable.',
      'Whenever this enters, every player is offered one and takes it.',
      'Gets +1/+1 for each guest who has stopped talking.',
      'Tap: char something. It was going to be done anyway.',
      'Cannot be countered by anyone standing near it.',
      'At end of turn, its controller says they should do this more often.',
      'Sacrifice a beer: untap this.',
    ],
  },
  {
    id: 'departures',
    share: 0.05,
    expansion: 'this-way-out',
    names: [
      'The Last Train',
      'Coat Already On',
      'The Long Goodbye At The Door',
      'Leaving Without Saying',
      'One Stop Early',
      'The Car Is Running',
      'A Reason To Go',
      'Back In Five Minutes',
      'The Late Bus',
      'Keys, Found At Last',
      'Standing In The Hallway',
      'The Door Held Open',
    ],
    types: ['Departure', 'Departure — Quiet', 'Exit', 'Exit — Marked', 'Absence'],
    lines: [
      'Return this to its owner. It will not be back tonight.',
      'Whenever this leaves, each other player remembers something they meant to say.',
      'Cannot be blocked. It has its coat on.',
      'Its controller says goodbye, then does not leave for twenty minutes.',
      'Exile this. It was going that way anyway.',
      'Costs one less to play after eleven.',
      'While this is on the table, nobody sits back down.',
    ],
  },
  {
    id: 'under-the-sink',
    share: 0.05,
    expansion: 'special-hazard',
    names: [
      'Do Not Mix',
      'The Unlabeled Bottle',
      'Bleach, Decanted',
      'A Sponge Of Uncertain History',
      'The Yellow Gloves',
      'Fumes In A Small Room',
      'Something Called Degreaser',
      'The Cupboard Under The Sink',
      'Half A Bottle Of Something',
      'Ammonia, Nearby',
      'The Rag Kept For This',
      'Ventilate The Area',
    ],
    types: ['Solvent', 'Solvent — Unlabeled', 'Hazard', 'Hazard — Household', 'Compound'],
    lines: [
      'Do not combine this with another solvent. A player who does loses the game.',
      'Its controller may not read the label. There is no label.',
      'Whenever this enters, open a window.',
      'Destroy target permanent. Destroy the surface under it too.',
      'It has been under there since before you moved in.',
      'Tap: remove anything. Ask no further questions.',
      'Gets +2/+0 in an enclosed space.',
    ],
  },
  {
    id: 'divorce',
    share: 0.07,
    expansion: 'joint-filing',
    names: [
      'The Good Knives',
      'Joint Custody Of A Sofa',
      'Storage Unit, Month Eleven',
      'Her Mother\u2019s China',
      'Undivided Record Collection',
      'Boxes In The Hall',
      'Mediation, Second Session',
      'Two Christmases',
      'The Signature Page',
      'Forwarding Address',
      'Half The Garage',
      'Photographs, Sorted',
      'The Wedding Video',
      'Mutual Friends, Divided',
      'Copies Of Everything',
      'The House, Briefly',
    ],
    types: [
      'Asset',
      'Asset — Contested',
      'Proceeding',
      'Chattel',
      'Settlement',
      'Effect — Ongoing',
    ],
    lines: [
      'Divide your permanents into two piles. Your opponent chooses one.',
      'You may keep this or the sofa. Not both.',
      'Whenever this changes control, both players lose two life.',
      'At end of turn, return half of this to its owner.',
      'Costs two more for each year you have controlled it.',
      'Cannot be sacrificed. It has to be signed.',
      'Exile the record collection. Neither player may look at it.',
      'When this enters, each player draws separately.',
      'Its controller keeps the dog.',
      'If this would be destroyed, it is stored instead.',
      'Both players remember this differently.',
    ],
  },
];

/**
 * The sets a run owns outright, so a card outside the run never wears one: the
 * eggplant set *is* the dating set, not a set that happens to contain some.
 *
 * Every set is spoken for now, so what is left over is the lands — and a land
 * is a place, printed in whichever set needed one. They draw from the whole
 * bank rather than from nothing.
 */
const THEMED_EXPANSIONS = new Set(THEMES.map((t) => t.expansion));
const OPEN_EXPANSIONS = (() => {
  const open = EXPANSIONS.map((e) => e.id).filter((id) => !THEMED_EXPANSIONS.has(id));
  return open.length > 0 ? open : EXPANSIONS.map((e) => e.id);
})();

/**
 * The share of the pool that stays a place. Held out of the theme split rather
 * than left to fall out of it: a themed card is never a land, so dealing the
 * runs first drove the land supply down with every run added, and a deck you
 * cannot pay for is not a pool.
 */
const LAND_SHARE = 0.31;

/** What a card is before it is generated: a place, a run, or neither. */
interface Slot {
  land: boolean;
  theme?: Theme;
}

/**
 * One slot per card, with each run's count fixed and then dealt out.
 *
 * Rolling a share per card would land within a couple of points of it and stay
 * there, because the pool is deterministic — the noise is baked into the seed
 * rather than averaging out over runs. Asking for 13% and shipping 10.9% is
 * not a rounding difference anybody can see, but it is one anybody can count.
 */
function themePlan(count: number, r: () => number): Slot[] {
  const slots: Slot[] = [];
  for (let i = 0; i < Math.round(count * LAND_SHARE); i++) slots.push({ land: true });
  for (const theme of THEMES) {
    for (let i = 0; i < Math.round(count * theme.share); i++) slots.push({ land: false, theme });
  }
  while (slots.length < count) slots.push({ land: false });
  if (slots.length > count) slots.length = count;
  // Fisher-Yates on the seeded stream, so the runs are spread through the pool
  // rather than sitting in a block at the front of it.
  for (let i = slots.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    const a = slots[i] as Slot;
    slots[i] = slots[j] as Slot;
    slots[j] = a;
  }
  return slots;
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
  const themes = themePlan(count, r);
  const out: PoolCard[] = [];
  for (let i = 0; i < count; i++) {
    // Dealt, not rolled, so every run's share is exactly its share of the pool
    // and the land supply is a share too rather than a leftover.
    const slot = themes[i] ?? { land: false };
    const theme = slot.theme;
    const kind = slot.land ? 'land' : kindOfNonLand(r);
    const land = kind === 'land';
    const rarity = land ? 'common' : pick(r, RARITIES);
    const p = 1 + Math.floor(r() * 6);
    const t = 1 + Math.floor(r() * 6);
    out.push({
      id: `c${i}`,
      kind,
      land,
      mana: pick(r, MANA_TYPES),
      name: theme ? pick(r, theme.names) : nameFor(r, kind),
      power: kind === 'unit' ? `${p}/${t}` : '',
      cost: land ? 0 : 1 + Math.floor(r() * 6),
      type: theme ? pick(r, theme.types) : typeLineFor(r, kind),
      text: theme ? pick(r, theme.lines) : textFor(r, kind),
      rarity,
      expansion: theme ? theme.expansion : pick(r, OPEN_EXPANSIONS),
      foil: r() < 0.04,
      hue: Math.floor(r() * 360),
    });
  }
  return out;
}
