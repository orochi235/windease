import type { Size } from '../../layout-types.js';
import type { Scenario } from './invariants.js';
import { prng } from './invariants.js';
import { type Preset, type PresetNode, presetScenario } from './preset.js';

export const PACKERS = ['shelf', 'skyline', 'column'] as const;
export type PackerId = (typeof PACKERS)[number];

/** `[w, h]`, `[w, h, title]`, or `null` for an item not measured yet. */
type Box = readonly [number, number] | readonly [number, number, string] | null;

interface PackPresetInput {
  id: string;
  source: string;
  stress: string;
  viewport: Size;
  strategy: PackerId;
  config?: Record<string, unknown>;
  boxes: readonly Box[];
}

function packPreset({
  id,
  source,
  stress,
  viewport,
  strategy,
  config,
  boxes,
}: PackPresetInput): Preset {
  const children: PresetNode[] = boxes.map((box, i) => {
    const node: PresetNode = { id: `${id}#${i}` };
    if (box) {
      node.hints = { preferredSize: { w: box[0], h: box[1] } };
      if (box[2] !== undefined) node.meta = { title: box[2] };
    }
    return node;
  });
  return {
    id,
    source,
    stress,
    viewport,
    root: { id: `${id}:root`, kind: 'zone', strategy, config: config ?? {}, children },
  };
}

/** `preset` with its root packed by `strategy` instead — how one preset is run through every packer. */
export function withStrategy(preset: Preset, strategy: PackerId): Preset {
  return { ...preset, root: { ...preset.root, strategy } };
}

/** stb_rect_pack's `rect_height_compare`: tallest first, then widest. */
const byHeightDesc = (boxes: [number, number][]): [number, number][] =>
  [...boxes].sort((a, b) => b[1] - a[1] || b[0] - a[0]);

function texturePackerPow2(): Preset {
  const rand = prng(2048);
  // Skewed toward small: most sprites in a UI or particle sheet are icons.
  const pow2 = () => [8, 8, 16, 16, 16, 32, 32, 64, 128, 256][rand(0, 9)]!;
  const boxes = byHeightDesc(
    Array.from({ length: 320 }, () => [pow2(), pow2()] as [number, number]),
  );
  return packPreset({
    id: 'texturepacker-pow2-sheet',
    source:
      'TexturePacker "Size constraints: POT" sheet, 320 power-of-two sprites 8–256px, stb order',
    stress:
      'power-of-two sizes tile exactly, so any waste is the packer’s; skyline should beat shelf',
    viewport: { w: 1024, h: 1024 },
    strategy: 'skyline',
    boxes,
  });
}

function stbStripAmongTiles(): Preset {
  const boxes: [number, number][] = Array.from({ length: 1200 }, () => [4, 4]);
  boxes.splice(600, 0, [2048, 8]);
  return packPreset({
    id: 'stb-strip-among-tiles',
    source:
      'stb_rect_pack lightmap/gradient atlas: one 2048×8 ramp texture among 1200 4×4 tiles, file order',
    stress:
      'a full-width strip mid-list lands on the skyline’s highest point and caps everything under it',
    viewport: { w: 2048, h: 2048 },
    strategy: 'skyline',
    boxes,
  });
}

function kenneySpriteSheet(): Preset {
  const rand = prng(1337);
  const boxes: [number, number][] = Array.from({ length: 300 }, () => {
    const roll = rand(0, 99);
    if (roll < 80) return [rand(16, 48), rand(16, 48)];
    if (roll < 95) return [rand(64, 128), rand(64, 128)];
    return [rand(192, 512), rand(96, 384)];
  });
  return packPreset({
    id: 'kenney-sprite-sheet',
    source:
      'Kenney-style 2D game asset pack: 80% tiles/icons, 15% characters, 5% backdrops, unsorted file order',
    stress:
      'skewed size distribution in arrival order; big backdrops arrive late and sit on a ragged outline',
    viewport: { w: 1024, h: 1024 },
    strategy: 'skyline',
    boxes,
  });
}

/** Approximate em-relative advance of a proportional sans (Roboto-like) for printable ASCII. */
function advance(ch: string): number {
  if ("iljI!|.,:;'`".includes(ch)) return 0.28;
  if ('frt()[]{}"'.includes(ch)) return 0.38;
  if ('mwMW@%'.includes(ch)) return 0.85;
  if (ch >= 'A' && ch <= 'Z') return 0.64;
  if (ch === ' ') return 0.25;
  return 0.54;
}

function glyphHeight(ch: string): number {
  if ('gjpqy'.includes(ch)) return 0.95;
  if (ch >= 'a' && ch <= 'z' && !'bdfhklt'.includes(ch)) return 0.72;
  if ('.,-_~\'"`^*'.includes(ch)) return 0.45;
  return 1;
}

/** The printable ASCII glyph boxes an SDF generator emits at `em` px, `pad` px each side. */
export function asciiGlyphBoxes(em: number, pad: number, seed: number): [number, number, string][] {
  const rand = prng(seed);
  const out: [number, number, string][] = [];
  for (let code = 33; code < 127; code++) {
    const ch = String.fromCharCode(code);
    // ±1px: hinting and the bounds rounding msdf-atlas-gen applies per glyph.
    const jitter = () => rand(0, 2) - 1;
    out.push([
      Math.round(advance(ch) * em) + 2 * pad + jitter(),
      Math.round(glyphHeight(ch) * em * 1.2) + 2 * pad + jitter(),
      ch,
    ]);
  }
  return out;
}

function sdfGlyphAtlas(): Preset {
  return packPreset({
    id: 'msdf-ascii-glyph-atlas',
    source:
      'msdf-atlas-gen, printable ASCII at 32px em with pxrange 4, glyph boxes in codepoint order',
    stress:
      'near-identical sizes with ±1px jitter: a one-pixel change to one glyph should not reshuffle the atlas',
    viewport: { w: 512, h: 512 },
    strategy: 'shelf',
    config: { gap: 2 },
    boxes: asciiGlyphBoxes(32, 4, 95),
  });
}

function cjkGlyphAtlas(): Preset {
  const rand = prng(3755);
  const boxes: [number, number][] = Array.from({ length: 3755 }, () => [
    34 + rand(0, 2) - 1,
    34 + rand(0, 2) - 1,
  ]);
  return packPreset({
    id: 'troika-cjk-glyph-atlas',
    source:
      'troika-three-text SDF atlas for the 3755 GB2312 level-1 hanzi, 26px glyphs + 4px padding',
    stress:
      'thousands of square-ish glyphs jittered ±1px: segment churn for skyline, 1px-narrower columns for masonry',
    viewport: { w: 2048, h: 2048 },
    strategy: 'skyline',
    config: { gap: 1 },
    boxes,
  });
}

/** Pinterest's pin width is 236px; its images keep their aspect, plus a ~50px caption footer. */
function pinterestFeed(): Preset {
  const rand = prng(236);
  const boxes: Box[] = Array.from({ length: 48 }, (_, i) => [
    236,
    rand(150, 700) + 50,
    `pin ${i + 1}`,
  ]);
  boxes.splice(9, 0, [1200, 320, 'shopping spotlight (full bleed)']);
  return packPreset({
    id: 'pinterest-home-feed',
    source:
      'Pinterest home feed at 1020px: 236px pins, 16px gutter, with a full-bleed shopping module',
    stress:
      'one module wider than the whole feed: masonry must clamp its span to the column count and start it at x 0',
    viewport: { w: 1020, h: 900 },
    strategy: 'column',
    config: { columnWidth: 236, gap: 16 },
    boxes,
  });
}

function unsplashGrid(): Preset {
  const rand = prng(416);
  // Common Unsplash aspect ratios at the 416px column width: 3:2, 2:3, 4:5, 16:9, 1:1.
  const heights = [277, 624, 520, 234, 416];
  const boxes: Box[] = Array.from({ length: 45 }, (_, i) => [
    416,
    heights[rand(0, 4)]!,
    `photo ${i + 1}`,
  ]);
  return packPreset({
    id: 'unsplash-three-column',
    source:
      'Unsplash search results at 1296px: three 416px columns, 24px gutter, real aspect-ratio mix',
    stress:
      'container exactly 3 columns + 2 gutters wide: an off-by-one in the column count drops to two',
    viewport: { w: 1296, h: 1200 },
    strategy: 'column',
    config: { gap: 24 },
    boxes,
  });
}

function googleKeep(): Preset {
  const rand = prng(240);
  const boxes: Box[] = Array.from({ length: 40 }, (_, i) => [240, rand(60, 400), `note ${i + 1}`]);
  boxes.splice(3, 0, [240, 4000, 'packing checklist (212 items)']);
  return packPreset({
    id: 'google-keep-notes',
    source: 'Google Keep grid view at 1024px: 240px notes, 16px gutter, one 212-item checklist',
    stress: 'one note twenty times taller than the rest: every later note must avoid its column',
    viewport: { w: 1024, h: 900 },
    strategy: 'column',
    config: { gap: 16 },
    boxes,
  });
}

function newspaperMobile(): Preset {
  const boxes: Box[] = [
    [840, 560, 'lead story photo'],
    [400, 267, 'second story photo'],
    [400, 120, 'second story brief'],
    [260, 173, 'opinion photo'],
    [260, 90, 'opinion brief'],
    [260, 90, 'opinion brief'],
    [620, 349, 'video module (16:9)'],
    [180, 120, 'weather'],
    [180, 180, 'crossword promo'],
    [400, 267, 'third story photo'],
    [300, 250, 'ad: medium rectangle'],
    [320, 50, 'ad: mobile banner'],
    [970, 250, 'ad: billboard'],
  ];
  return packPreset({
    id: 'newspaper-front-on-phone',
    source:
      'Broadsheet homepage modules sized for a 1280px desktop grid, fixed-aspect, dropped into a 375px phone',
    stress:
      'most tiles wider than the container: each must sit alone at x 0 and report width overflow',
    viewport: { w: 375, h: 800 },
    strategy: 'shelf',
    config: { gap: 12 },
    boxes,
  });
}

function flickrJustified(): Preset {
  const rand = prng(320);
  const aspects = [1.5, 0.667, 1.333, 0.75, 1.778, 1, 2.4];
  const boxes: Box[] = Array.from({ length: 40 }, (_, i) => [
    Math.round(aspects[rand(0, aspects.length - 1)]! * 320),
    320,
    `photo ${i + 1}`,
  ]);
  return packPreset({
    id: 'flickr-justified-rows',
    source:
      'flickr/justified-layout defaults: containerWidth 1060, targetRowHeight 320, boxSpacing 10',
    stress: 'justified rows need scaling a shelf can’t do: rows come out ragged on the right',
    viewport: { w: 1060, h: 1400 },
    strategy: 'shelf',
    config: { gap: 10 },
    boxes,
  });
}

function googlePhotos(): Preset {
  const rand = prng(180);
  const aspects = [1.333, 0.75, 1.778, 0.5625, 1];
  const boxes: Box[] = Array.from({ length: 36 }, (_, i) => [
    Math.round(aspects[rand(0, aspects.length - 1)]! * 180),
    180,
    `photo ${i + 1}`,
  ]);
  boxes.splice(7, 0, [720, 180, 'panorama 4:1']);
  boxes.splice(20, 0, [2160, 180, 'phone panorama 12:1']);
  return packPreset({
    id: 'google-photos-panoramas',
    source:
      'Google Photos web grid at 1280px, 180px rows, 4px spacing, with a 4:1 and a 12:1 phone panorama',
    stress:
      'a panorama wider than the viewport mid-feed: rows before and after must not collide with it',
    viewport: { w: 1280, h: 1400 },
    strategy: 'shelf',
    config: { gap: 4 },
    boxes,
  });
}

function isoPallets(): Preset[] {
  const eur: Box[] = Array.from({ length: 11 }, (_, i) => [80, 120, `EUR pallet ${i + 1}`]);
  const industrial: Box[] = Array.from({ length: 22 }, (_, i) => [100, 120, `ISO pallet ${i + 1}`]);
  return [
    packPreset({
      id: 'iso-20ft-eur-pallets',
      source:
        '20ft ISO dry container floor, 235×590cm inside; EUR pallets 80×120cm, all long side along the length',
      stress:
        'no rotation: 2 across × 4 deep = 8 fit, against the 11 a loader gets by turning some — 3 overflow',
      viewport: { w: 235, h: 590 },
      strategy: 'shelf',
      boxes: eur,
    }),
    packPreset({
      id: 'iso-40ft-industrial-pallets',
      source: '40ft ISO dry container floor, 235×1203cm inside; 100×120cm ISO pallets',
      stress:
        'the published 20-pallet single-stack figure: 2 across × 10 deep, the last 2 overflow',
      viewport: { w: 235, h: 1203 },
      strategy: 'column',
      boxes: industrial,
    }),
  ];
}

function vanLoad(): Preset {
  // Approximate flat-pack package footprints (cm), width across the van, length along it.
  const boxes: Box[] = [
    [60, 202, 'wardrobe frame box'],
    [60, 202, 'wardrobe frame box'],
    [41, 149, 'cube shelf 2×4'],
    [41, 149, 'cube shelf 2×4'],
    [80, 158, 'bed base'],
    [34, 202, 'bookcase 80'],
    [34, 202, 'bookcase 80'],
    [28, 202, 'bookcase 40'],
    [55, 110, 'desk top'],
    [37, 77, 'chest of drawers'],
    [48, 60, 'office chair'],
    [36, 36, 'lamp'],
    [58, 58, 'nightstand'],
    [58, 58, 'nightstand'],
  ];
  return packPreset({
    id: 'flat-pack-van-floor',
    source:
      'Flat-pack furniture order on a long-wheelbase cargo van floor, ~178×330cm, approximate package footprints',
    stress: 'long thin boxes of near-equal length: shelf rows waste the width a skyline fills',
    viewport: { w: 178, h: 330 },
    strategy: 'skyline',
    boxes,
  });
}

function explorerAt125(): Preset {
  const rand = prng(125);
  // 96px icon tiles at 125% scaling are 76.8 CSS px; labels wrap to 1–3 lines of 19.2px.
  const boxes: Box[] = Array.from({ length: 40 }, (_, i) => [
    76.8,
    96 + rand(0, 2) * 19.2,
    `file ${i + 1}`,
  ]);
  return packPreset({
    id: 'explorer-icons-125pct',
    source: 'Windows Explorer "Large icons" view at 125% display scaling in a 768 CSS px pane',
    stress: 'fractional sizes that tile the width exactly: ten 76.8px tiles must share a row',
    viewport: { w: 768, h: 600 },
    strategy: 'shelf',
    boxes,
  });
}

/** Real software, one preset per layout. */
export const PRESETS: Preset[] = [
  texturePackerPow2(),
  stbStripAmongTiles(),
  kenneySpriteSheet(),
  sdfGlyphAtlas(),
  cjkGlyphAtlas(),
  pinterestFeed(),
  unsplashGrid(),
  googleKeep(),
  newspaperMobile(),
  flickrJustified(),
  googlePhotos(),
  ...isoPallets(),
  vanLoad(),
  explorerAt125(),
];

const repeat = (n: number, box: Box): Box[] => Array.from({ length: n }, () => box);

/** Edge cases a real feed reaches, each named for where it does. */
export const PATHOLOGY_PRESETS: Preset[] = [
  packPreset({
    id: 'identical-squares',
    source:
      'App launcher grid (iOS home screen, GNOME app grid): 500 identical 64px icons, 8px gap',
    stress: 'identical sizes: all three packers should agree on one row-major grid',
    viewport: { w: 1000, h: 600 },
    strategy: 'skyline',
    config: { gap: 8 },
    boxes: repeat(500, [64, 64]),
  }),
  packPreset({
    id: 'vertical-needles',
    source: 'Sparkline/bar-chart atlas: 400 1×10000 column textures',
    stress: '1px-wide items: masonry’s default column width becomes 1, so 300 columns',
    viewport: { w: 300, h: 1000 },
    strategy: 'column',
    boxes: repeat(400, [1, 10000]),
  }),
  packPreset({
    id: 'horizontal-needles',
    source: 'Log-viewer line textures: 10000×1 rows interleaved with 1×1 dots',
    stress: 'every other item is 12× wider than the container; dots must not tuck under a needle',
    viewport: { w: 800, h: 400 },
    strategy: 'skyline',
    boxes: Array.from({ length: 100 }, (_, i): Box => (i % 2 ? [1, 1] : [10000, 1])),
  }),
  packPreset({
    id: 'exact-container-width',
    source:
      'Settings list rows (macOS System Settings, Android preferences): full-width 800×30 rows, 8px gap',
    stress: 'every item exactly the container width: one per row, no width overflow',
    viewport: { w: 800, h: 400 },
    strategy: 'shelf',
    config: { gap: 8 },
    boxes: repeat(20, [800, 30]),
  }),
  packPreset({
    id: 'width-plus-gap-fits',
    source: 'Bootstrap-style 4-up card row: 4×244 + 3×8 = 1000 exactly',
    stress: 'n·w + (n−1)·gap equals the width: n per row, not n−1',
    viewport: { w: 1000, h: 600 },
    strategy: 'shelf',
    config: { gap: 8 },
    boxes: repeat(12, [244, 100]),
  }),
  packPreset({
    id: 'width-plus-gap-one-over',
    source: 'The same 4-up card row with cards one pixel too wide',
    stress: 'n·w + (n−1)·gap exceeds the width by 1px: n−1 per row',
    viewport: { w: 1000, h: 600 },
    strategy: 'shelf',
    config: { gap: 8 },
    boxes: repeat(12, [245, 100]),
  }),
  packPreset({
    id: 'equal-sixths',
    source: 'A toolbar of six tiles each computed as width / 6 (flex: 1 1 0 measured back into px)',
    stress: 'six 100/6 widths sum past 100 in floating point: the last must not wrap',
    viewport: { w: 100, h: 100 },
    strategy: 'shelf',
    boxes: repeat(6, [100 / 6, 20]),
  }),
  packPreset({
    id: 'gap-dominates',
    source: 'Material spacing token misapplied: 16px chips with a 64px gap',
    stress: 'gap four times the item size: the gap, not the items, sets the pitch',
    viewport: { w: 400, h: 400 },
    strategy: 'column',
    config: { gap: 64 },
    boxes: repeat(100, [16, 16]),
  }),
  packPreset({
    id: 'masonry-images-loading',
    source: 'Masonry.js before imagesLoaded fires: every third tile has no measured size yet',
    stress:
      'unsized items interleaved: they go to unplaced, and never shift or drop the sized ones',
    viewport: { w: 800, h: 600 },
    strategy: 'column',
    config: { gap: 10 },
    boxes: Array.from(
      { length: 30 },
      (_, i): Box => (i % 3 === 2 ? null : [250, 100 + ((i * 37) % 200)]),
    ),
  }),
  packPreset({
    id: 'ascending-heights',
    source: 'Chronological photo feed that happens to grow taller: the order NFDH sorts away from',
    stress: 'next-fit shelf with heights ascending: each row’s tallest item arrives last',
    viewport: { w: 1000, h: 1000 },
    strategy: 'shelf',
    config: { gap: 4 },
    boxes: Array.from({ length: 60 }, (_, i): Box => [100 + ((i * 53) % 90), 10 + i * 10]),
  }),
  packPreset({
    id: 'staircase-widths',
    source:
      'Skyline worst case from Jylänki, “A Thousand Ways to Pack the Bin” (2010): widths stepping down by 1px',
    stress:
      'every item leaves a new outline segment: skyline’s segment list grows toward the width',
    viewport: { w: 1000, h: 1000 },
    strategy: 'skyline',
    boxes: Array.from({ length: 300 }, (_, i): Box => [300 - i, 1 + (i % 7)]),
  }),
  packPreset({
    id: 'narrower-than-a-pin',
    source: 'Pinterest feed in a 200px split-screen pane, narrower than one 236px pin',
    stress: 'container narrower than the column width: one column, every pin overflows by 36px',
    viewport: { w: 200, h: 800 },
    strategy: 'column',
    config: { columnWidth: 236, gap: 16 },
    boxes: repeat(12, [236, 300]),
  }),
];

function tenThousand(): Preset {
  const rand = prng(10_000);
  return packPreset({
    id: 'ten-thousand-thumbnails',
    source: 'A 10,000-image library grid (Lightroom, Photos) with thumbnails 40–200px on each side',
    stress: 'scale: every packer must finish 10k items well inside a frame budget’s worst case',
    viewport: { w: 1920, h: 1080 },
    strategy: 'skyline',
    config: { gap: 4 },
    boxes: Array.from({ length: 10_000 }, (): Box => [rand(40, 200), rand(40, 200)]),
  });
}

/** Too big to render node-by-node in a story; tests only. */
export const HEAVY_PRESETS: Preset[] = [tenThousand()];

export const ALL_PRESETS: Preset[] = [...PRESETS, ...PATHOLOGY_PRESETS, ...HEAVY_PRESETS];

/** Each preset's root as a flat scenario, run by `packer`. */
export function packScenario(preset: Preset, packer: PackerId): Scenario {
  return presetScenario(withStrategy(preset, packer));
}

/** Presets small enough to render through the React layer. */
export const STORY_PRESETS: Preset[] = [...PRESETS, ...PATHOLOGY_PRESETS].filter(
  (p) => (p.root.children?.length ?? 0) <= 1500,
);
