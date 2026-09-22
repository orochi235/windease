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

export interface PoolCard {
  id: string;
  name: string;
  land: boolean;
  power: string;
  cost: string;
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

/** `count` cards, the same ones every time for a given `seed`. */
export function cardPool(count = 320, seed = 20260921): PoolCard[] {
  const r = rng(seed);
  const out: PoolCard[] = [];
  for (let i = 0; i < count; i++) {
    const land = r() < 0.36;
    const rarity = land ? 'common' : pick(r, RARITIES);
    const p = 1 + Math.floor(r() * 6);
    const t = 1 + Math.floor(r() * 6);
    out.push({
      id: `c${i}`,
      land,
      name: land ? pick(r, LAND_NAMES) : nameOf(r),
      power: land ? '' : `${p}/${t}`,
      cost: land ? '' : String(1 + Math.floor(r() * 7)),
      type: land ? 'Land' : pick(r, TYPES),
      text: land ? `Turn for one. ${pick(r, FARM_LINES)}` : textOf(r),
      rarity,
      foil: r() < 0.04,
      hue: Math.floor(r() * 360),
    });
  }
  return out;
}
