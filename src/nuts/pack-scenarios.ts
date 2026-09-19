import { columnStrategy } from '../layout/column.js';
import { justifiedStrategy } from '../layout/justified.js';
import { shelfStrategy } from '../layout/shelf.js';
import { skylineStrategy } from '../layout/skyline.js';
import type { LayoutStrategy, Size } from '../layout-types.js';
import type { Scenario } from './invariants.js';
import { prng } from './invariants.js';
import { type Preset, type PresetNode, presetScenario } from './preset.js';

export const PACKERS = ['shelf', 'skyline', 'column'] as const;
export type PackerId = (typeof PACKERS)[number];

/** Every strategy a pack preset may name: the three packers, and justified rows. */
export type PackStrategyId = PackerId | 'justified';

export const PACK_STRATEGIES: Record<PackStrategyId, LayoutStrategy<void, string>> = {
  shelf: shelfStrategy,
  skyline: skylineStrategy,
  column: columnStrategy,
  justified: justifiedStrategy,
};

/** `[w, h]`, `[w, h, title]`, or `null` for an item not measured yet. */
type Box = readonly [number, number] | readonly [number, number, string] | null;

interface PackPresetInput {
  id: string;
  source: string;
  stress: string;
  description: string;
  viewport: Size;
  strategy: PackStrategyId;
  config?: Record<string, unknown>;
  boxes: readonly Box[];
  /** Per box, the shape the content reports as `hints.aspect`. */
  aspects?: readonly number[];
  /** The product look, as `data.css`. */
  css?: string;
}

function packPreset({
  id,
  source,
  stress,
  description,
  viewport,
  strategy,
  config,
  boxes,
  aspects,
  css,
}: PackPresetInput): Preset {
  const children: PresetNode[] = boxes.map((box, i) => {
    const node: PresetNode = { id: `${id}#${i}` };
    const aspect = aspects?.[i];
    if (box) {
      node.hints = { preferredSize: { w: box[0], h: box[1] } };
      if (box[2] !== undefined) node.meta = { title: box[2] };
    }
    if (aspect !== undefined) node.hints = { ...node.hints, aspect };
    return node;
  });
  return {
    id,
    source,
    stress,
    description,
    viewport,
    mechanics: { id: `${id}:root`, kind: 'zone', strategy, config: config ?? {} },
    data: { children: { [`${id}:root`]: children }, ...(css === undefined ? {} : { css }) },
  };
}

/** The strategy `preset` names for its root. */
export function ownStrategy(preset: Preset): PackStrategyId {
  return preset.mechanics.strategy as PackStrategyId;
}

/** `preset` with its root packed by `strategy` instead — how one preset is run through every packer. */
export function withStrategy(preset: Preset, strategy: PackStrategyId): Preset {
  return { ...preset, mechanics: { ...preset.mechanics, strategy } };
}

/** How many items the content packs into `preset`'s root. */
export function packItemCount(preset: Preset): number {
  return preset.data?.children?.[preset.mechanics.id]?.length ?? 0;
}

function texturePackerPow2(): Preset {
  const rand = prng(2048);
  // Skewed toward small: most sprites in a UI or particle sheet are icons.
  const pow2 = () => [8, 8, 16, 16, 16, 32, 32, 64, 128, 256][rand(0, 9)]!;
  const boxes = Array.from({ length: 320 }, () => [pow2(), pow2()] as [number, number]);
  return packPreset({
    id: 'texturepacker-pow2-sheet',
    css: ATLAS_CSS,
    source:
      'TexturePacker "Size constraints: POT" 1024×1024 sheet, rotation allowed, 320 power-of-two sprites 8–256px in file order',
    stress:
      'power-of-two sizes tile exactly, so any waste is the packer’s; skyline should beat shelf',
    description:
      'TexturePacker is a tool game developers use to combine hundreds of small images (sprites: icons, particles, interface pieces) into one large texture called a sprite sheet, so the game can load and draw them together. Here every sprite has power-of-two sides (8, 16, 32 pixels and so on), and the "POT" size constraint makes the sheet a power of two as well, which older graphics hardware required. The tool arranges the sprites to waste as little of the sheet as it can.',
    viewport: { w: 1024, h: 1024 },
    strategy: 'skyline',
    // TexturePacker's default "Sort by: Best" tries several orders and keeps the tightest;
    // max-side ties area for the tightest of ours on this sheet.
    config: { sort: 'max-side', rotate: true, overflowMode: 'unplaced' },
    boxes,
  });
}

function stbStripAmongTiles(): Preset {
  const boxes: [number, number][] = Array.from({ length: 1200 }, () => [4, 4]);
  boxes.splice(600, 0, [2048, 8]);
  return packPreset({
    id: 'stb-strip-among-tiles',
    css: ATLAS_CSS,
    source:
      'stb_rect_pack lightmap/gradient atlas, 2048×2048: one 2048×8 ramp texture 600th among 1200 4×4 tiles',
    stress:
      'stb sorts tallest first, so the full-width strip listed mid-way packs first along the top instead of capping the tiles under it',
    description:
      "stb_rect_pack is a small, widely embedded C library that packs rectangles into a texture atlas, one image holding many small ones, such as font glyphs. This atlas mixes 1,200 tiny 4×4 tiles with one long 2048×8 color ramp (a gradient stored as a strip of texture) that spans the atlas's full width. stb packs into a target of fixed size, never turns a rectangle, and sorts the rectangles tallest first before placing them, whatever order the source files list them in.",
    viewport: { w: 2048, h: 2048 },
    strategy: 'skyline',
    // stb_rect_pack's `rect_height_compare`: tallest first (then widest, which `sort` cannot say).
    config: { sort: 'height', overflowMode: 'unplaced' },
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
    css: ATLAS_CSS,
    source:
      'Kenney-style 2D game asset pack, 80% tiles/icons, 15% characters, 5% backdrops, packed by TexturePacker into a 2048×2048 max sheet with rotation allowed',
    stress:
      'skewed size distribution: sorted largest first, the backdrops take the top and hundreds of small tiles fill the ragged outline they leave',
    description:
      'Kenney publishes free 2D game art packs whose images come in a few rough sizes: many small tiles and icons, fewer character sprites, and a handful of large backgrounds. The sprite sheets shipped with the packs are made with TexturePacker, which sorts the images largest first, may turn one sideways to fit it, and caps the sheet at a maximum size.',
    viewport: { w: 2048, h: 2048 },
    strategy: 'skyline',
    config: { sort: 'max-side', rotate: true, overflowMode: 'unplaced' },
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
    css: MSDF_CSS,
    source:
      'msdf-atlas-gen, printable ASCII at 32px em with pxrange 4, glyph boxes in codepoint order',
    stress:
      'near-identical sizes with ±1px jitter: a one-pixel change to one glyph should not reshuffle the atlas',
    description:
      "msdf-atlas-gen renders a font's glyphs into a texture atlas as multi-channel signed distance fields, which let a game or 3D app draw sharp text at any size from one small image. Each printable ASCII character becomes a box sized to that glyph plus a few pixels of padding, so the boxes differ only slightly, and they are packed in character-code order.",
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
    css: MSDF_CSS,
    source:
      'troika-three-text SDF atlas for the 3755 GB2312 level-1 hanzi, 26px glyphs + 4px padding',
    stress:
      'thousands of square-ish glyphs jittered ±1px: segment churn for skyline, 1px-narrower columns for masonry',
    description:
      'troika-three-text draws text in 3D scenes built with three.js, rendering each glyph it needs into a signed-distance-field atlas texture. A Chinese interface needs thousands of glyphs: the 3,755 most common characters of the GB2312 standard, all roughly square and nearly the same size.',
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
    css: PINTEREST_CSS,
    source:
      'Pinterest home feed at 1020px: 236px pins, 16px gutter, with a full-bleed shopping module',
    stress:
      'one module wider than the whole feed: masonry must clamp its span to the column count and start it at x 0',
    description:
      "Pinterest's home feed is a masonry layout: fixed-width columns of pins (images with a short caption below), each pin as tall as its image needs, with each new pin going into whichever column is currently shortest. The columns sit centered in the page, and more pins load as the user scrolls. Partway down, a shopping module runs across the whole feed.",
    viewport: { w: 1020, h: 900 },
    strategy: 'column',
    config: { columnWidth: 236, gap: 16, justify: 'center' },
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
    css: UNSPLASH_CSS,
    source:
      'Unsplash search results at 1296px: three 416px columns, 24px gutter, real aspect-ratio mix',
    stress:
      'container exactly 3 columns + 2 gutters wide: an off-by-one in the column count drops to two',
    description:
      'Unsplash, a free stock-photo site, shows search results in three columns of photos, each photo keeping its own shape (landscape, portrait or square), so the columns end at different heights. More results load as the user scrolls, and narrower windows get fewer columns.',
    viewport: { w: 1296, h: 1200 },
    strategy: 'column',
    config: { cols: 3, gap: 24 },
    boxes,
  });
}

function googleKeep(): Preset {
  const rand = prng(240);
  const boxes: Box[] = Array.from({ length: 40 }, (_, i) => [240, rand(60, 400), `note ${i + 1}`]);
  boxes.splice(3, 0, [240, 4000, 'packing checklist (212 items)']);
  return packPreset({
    id: 'google-keep-notes',
    css: KEEP_CSS,
    source: 'Google Keep grid view at 1024px: 240px notes, 16px gutter, one 212-item checklist',
    stress: 'one note twenty times taller than the rest: every later note must avoid its column',
    description:
      'Google Keep, a note-taking app, shows notes as cards in its grid view: every card is the same width and as tall as its content, and the cards fill columns like a masonry wall. Users drag a card to reorder it. A long checklist becomes one very tall card among short ones.',
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
    css: NEWSPAPER_CSS,
    source:
      'Broadsheet homepage modules sized for a 1280px desktop grid, fixed-aspect, dropped into a 375px phone',
    stress:
      'most tiles wider than the container: each must sit alone at x 0 and report width overflow',
    description:
      'A newspaper homepage is built from modules, such as a lead photo, story briefs, a video and ads in standard sizes like the 300×250 medium rectangle and the 970×250 billboard, each designed at a fixed width for a desktop grid. Sites normally switch to a separate one-column layout on phones; this is the case where the desktop modules reach a 375-pixel-wide phone screen unchanged.',
    viewport: { w: 375, h: 800 },
    strategy: 'shelf',
    config: { gap: 12 },
    boxes,
  });
}

function flickrJustified(): Preset {
  const rand = prng(320);
  const shapes = [1.5, 0.667, 1.333, 0.75, 1.778, 1, 2.4];
  const aspects = Array.from({ length: 40 }, () => shapes[rand(0, shapes.length - 1)]!);
  const boxes: Box[] = aspects.map((a, i) => [Math.round(a * 320), 320, `photo ${i + 1}`]);
  return packPreset({
    id: 'flickr-justified-rows',
    css: FLICKR_CSS,
    source:
      'flickr/justified-layout defaults: containerWidth 1060, targetRowHeight 320 ±25%, boxSpacing 10, widows left at the target height',
    stress:
      'every row but the last must end exactly at the right edge, each photo keeping its aspect',
    description:
      'Flickr shows photos in justified rows: each row holds photos at a shared height, scaled so the row runs exactly the width of the page, and every photo keeps its shape. Flickr published the algorithm as the open-source justified-layout library, whose defaults aim for 320-pixel rows in a 1060-pixel-wide container with 10 pixels between photos.',
    viewport: { w: 1060, h: 1400 },
    strategy: 'justified',
    // targetRowHeightTolerance 0.25 caps a row at 400px; justified has no key for its 240px floor.
    config: { rowHeight: 320, gap: 10, maxRowHeight: 400 },
    boxes,
    aspects,
  });
}

function googlePhotos(): Preset {
  const rand = prng(180);
  const shapes = [1.333, 0.75, 1.778, 0.5625, 1];
  const aspects = Array.from({ length: 36 }, () => shapes[rand(0, shapes.length - 1)]!);
  aspects.splice(7, 0, 4);
  aspects.splice(20, 0, 12);
  const boxes: Box[] = aspects.map((a, i) => [
    Math.round(a * 180),
    180,
    i === 7 ? 'panorama 4:1' : i === 20 ? 'phone panorama 12:1' : `photo ${i + 1}`,
  ]);
  return packPreset({
    id: 'google-photos-panoramas',
    css: PHOTOS_CSS,
    source:
      'Google Photos web grid at 1280px, 180px rows, 4px spacing, with a 4:1 and a 12:1 phone panorama',
    stress:
      'a panorama wider than the viewport mid-feed: it takes a row alone, scaled down to the width, and the rows around it still fill the width',
    description:
      'Google Photos on the web shows a library as rows of photos at a shared height, each photo keeping its own shape, grouped by date in one long scrolling timeline. A panorama shot on a phone can be many times wider than it is tall, so at row height it is wider than the whole window.',
    viewport: { w: 1280, h: 1400 },
    strategy: 'justified',
    config: { rowHeight: 180, gap: 4 },
    boxes,
    aspects,
  });
}

function isoPallets(): Preset[] {
  const eur: Box[] = Array.from({ length: 11 }, (_, i) => [80, 120, `EUR pallet ${i + 1}`]);
  const industrial: Box[] = Array.from({ length: 22 }, (_, i) => [100, 120, `ISO pallet ${i + 1}`]);
  return [
    packPreset({
      id: 'iso-20ft-eur-pallets',
      css: PALLET_CSS,
      source:
        '20ft ISO dry container floor, 235×590cm inside; EUR pallets 80×120cm, turned wherever that fits more',
      stress:
        'upright, 2 across × 4 deep = 8 fit; a loader gets 11 with a lengthwise row of 4 beside a turned row of 7',
      description:
        "A standard 20-foot shipping container has a floor about 2.35 meters wide and 5.9 meters long. Europe's standard EUR pallet measures 0.8 by 1.2 meters, and loaders get 11 of them onto that floor by turning some sideways.",
      viewport: { w: 235, h: 590 },
      strategy: 'skyline',
      config: { rotate: true, overflowMode: 'unplaced' },
      boxes: eur,
    }),
    packPreset({
      id: 'iso-40ft-industrial-pallets',
      css: PALLET_CSS,
      source:
        '40ft ISO dry container floor, 235×1203cm inside; 100×120cm ISO pallets, turned wherever that fits more',
      stress:
        'upright, 2 across × 10 deep gives the published 20; turning one row fits 100 + 120 across and 22 in all',
      description:
        'A 40-foot shipping container has a floor about 2.35 meters wide and 12 meters long. The 1.0 by 1.2 meter pallet common in industry fits two across, and shipping guides quote about 20 of them per container, stacked one high.',
      viewport: { w: 235, h: 1203 },
      strategy: 'skyline',
      config: { rotate: true, overflowMode: 'unplaced' },
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
    css: VAN_CSS,
    source:
      'Flat-pack furniture order on a long-wheelbase cargo van floor, ~178×330cm, approximate package footprints',
    stress:
      'long thin boxes of near-equal length on a bounded floor: shelf rows waste the width a skyline fills, and a box turned crosswise wastes it too',
    description:
      "A long-wheelbase cargo van has a load floor roughly 1.8 meters wide and 3.3 meters long. A flat-pack furniture delivery fills it with long, narrow boxes, such as wardrobe panels, bookcases and a bed base, laid flat along the van's length, with smaller boxes like nightstands and a chair in the gaps. The loader may turn a box crosswise, and what does not fit waits for the next trip.",
    viewport: { w: 178, h: 330 },
    strategy: 'skyline',
    config: { rotate: true, overflowMode: 'unplaced' },
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
    css: EXPLORER_CSS,
    source: 'Windows Explorer "Large icons" view at 125% display scaling in a 768 CSS px pane',
    stress: 'fractional sizes that tile the width exactly: ten 76.8px tiles must share a row',
    description:
      'Windows File Explorer\'s "Large icons" view shows each file as a fixed-width tile, its icon above its name, with long names wrapping onto up to three lines so tiles in a row can differ in height. Resizing the window reflows the tiles into more or fewer per row. At 125% display scaling Windows draws everything 1.25 times larger, so sizes measured in unscaled pixels come out fractional.',
    viewport: { w: 768, h: 600 },
    strategy: 'shelf',
    boxes,
  });
}

const ATLAS_CSS = `
.windease-zone {
  border: 0;
  border-radius: 0;
  background: repeating-conic-gradient(#cfcfcf 0 25%, #fff 0 50%) 0 0 / 16px 16px;
}
.exotic-pack__box { border: 1px solid rgb(0 0 0 / 35%); background: rgb(255 120 60 / 75%); }
[data-node]:nth-child(5n + 2) .exotic-pack__box { background: rgb(80 170 255 / 75%); }
[data-node]:nth-child(5n + 3) .exotic-pack__box { background: rgb(110 200 90 / 75%); }
[data-node]:nth-child(5n + 4) .exotic-pack__box { background: rgb(250 200 50 / 75%); }
[data-node]:nth-child(5n) .exotic-pack__box { background: rgb(190 110 230 / 75%); }
`;

const MSDF_CSS = `
.windease-zone { border: 0; border-radius: 0; background: #000; }
.exotic-pack__box {
  display: grid;
  place-items: center;
  border: 0;
  background: radial-gradient(#f0f 0 30%, #0ff 45%, #ff0 60%, #0000 70%);
}
.exotic-pack__label { color: #fff; font: bold 14px monospace; mix-blend-mode: difference; }
`;

const PINTEREST_CSS = `
.windease-zone { border: 0; background: #fff; }
.exotic-pack__box { border: 0; border-radius: 16px; background: #e9e4dc; }
[data-node]:nth-child(4n + 2) .exotic-pack__box { background: #c9d6cf; }
[data-node]:nth-child(4n + 3) .exotic-pack__box { background: #e2c7c0; }
[data-node]:nth-child(4n) .exotic-pack__box { background: #cfd3e3; }
.exotic-pack__label { padding: 8px 12px; color: #111; font: 600 14px system-ui, sans-serif; }
`;

const UNSPLASH_CSS = `
.windease-zone { border: 0; border-radius: 0; background: #fff; }
.exotic-pack__box { border: 0; background: linear-gradient(160deg, #8a9bb0, #3e4a57); }
[data-node]:nth-child(3n + 2) .exotic-pack__box { background: linear-gradient(160deg, #d8c3a5, #7a6048); }
[data-node]:nth-child(3n) .exotic-pack__box { background: linear-gradient(160deg, #a7c4a0, #3f5e3a); }
.exotic-pack__label { color: #fff; font: 14px system-ui, sans-serif; }
`;

const KEEP_CSS = `
.windease-zone { border: 0; background: #fff; }
.exotic-pack__box {
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  background: #fff;
  font: 14px Roboto, system-ui, sans-serif;
}
[data-node]:nth-child(5n + 2) .exotic-pack__box { border-color: #0000; background: #fff8b8; }
[data-node]:nth-child(5n + 4) .exotic-pack__box { border-color: #0000; background: #e2f6d3; }
[data-node]:nth-child(7n) .exotic-pack__box { border-color: #0000; background: #faafa8; }
.exotic-pack__label { padding: 12px 16px 0; color: #202124; font-weight: 500; }
`;

const NEWSPAPER_CSS = `
.windease-zone { border: 0; border-radius: 0; background: #f9f7f1; }
.exotic-pack__box {
  border: 0;
  border-top: 1px solid #121212;
  background: linear-gradient(#0000 0 26px, #d9d4c7 26px) padding-box;
}
.exotic-pack__label {
  padding: 4px 0;
  color: #121212;
  font: bold 15px Georgia, 'Times New Roman', serif;
}
`;

const FLICKR_CSS = `
.windease-zone { border: 0; border-radius: 0; background: #f3f5f6; }
.exotic-pack__box { border: 0; background: linear-gradient(135deg, #5d7a8c, #1d2b36); }
[data-node]:nth-child(3n + 2) .exotic-pack__box { background: linear-gradient(135deg, #e0a96d, #7b3f1f); }
[data-node]:nth-child(3n) .exotic-pack__box { background: linear-gradient(135deg, #9fc5a8, #2c5236); }
.exotic-pack__label { color: #fff; font: 12px 'Helvetica Neue', Arial, sans-serif; }
`;

const PHOTOS_CSS = `
.windease-zone { border: 0; border-radius: 0; background: #fff; }
.exotic-pack__box { border: 0; background: linear-gradient(#9fc3e7, #e8d6b9 55%, #6d8a5b 56%); }
[data-node]:nth-child(2n) .exotic-pack__box { background: linear-gradient(135deg, #d9a6a1, #6e4a6a); }
.exotic-pack__label { color: #fff; font: 12px 'Google Sans', Roboto, system-ui, sans-serif; }
`;

const PALLET_CSS = `
.windease-zone {
  border: 3px solid #6b7b85;
  border-radius: 0;
  background: repeating-linear-gradient(90deg, #7a5536 0 30px, #5f412a 30px 32px);
}
.exotic-pack__box {
  border: 1px solid #6e4f2c;
  background: repeating-linear-gradient(#e0bd85 0 12px, #8a6a45 12px 16px);
}
.exotic-pack__label { color: #3b2a16; font: bold 11px system-ui, sans-serif; }
`;

const VAN_CSS = `
.windease-zone {
  border: 0;
  border-radius: 6px;
  background: repeating-linear-gradient(#4a4d50 0 10px, #3d4043 10px 12px);
}
.exotic-pack__box {
  border: 1px solid #8a6a3c;
  background: linear-gradient(90deg, #0000 calc(50% - 6px), #d8c9a6 0 calc(50% + 6px), #0000 0), #c49a5c;
}
.exotic-pack__label { color: #3b2a16; font: bold 11px system-ui, sans-serif; }
`;

const EXPLORER_CSS = `
.windease-zone { border: 0; border-radius: 0; background: #fff; }
.exotic-pack__box {
  display: flex;
  flex-direction: column;
  align-items: center;
  border: 1px solid #0000;
  background: none;
}
.exotic-pack__box:hover { border-color: #cce8ff; background: #e5f3ff; }
.exotic-pack__box::before {
  content: '';
  width: 48px;
  height: 38px;
  margin: 6px 0 4px;
  border-radius: 2px 8px 3px 3px;
  background: linear-gradient(#ffe38a, #f4b73f);
}
.exotic-pack__label { white-space: normal; text-align: center; color: #000; font: 12px 'Segoe UI', system-ui, sans-serif; }
`;

const GNOME_GRID_CSS = `
.windease-zone { border: 0; border-radius: 0; background: #242424; }
.exotic-pack__box { border: 0; border-radius: 14px; background: linear-gradient(#62a0ea, #1c71d8); }
[data-node]:nth-child(5n + 2) .exotic-pack__box { background: linear-gradient(#8ff0a4, #26a269); }
[data-node]:nth-child(5n + 3) .exotic-pack__box { background: linear-gradient(#ffbe6f, #e66100); }
[data-node]:nth-child(5n + 4) .exotic-pack__box { background: linear-gradient(#dc8add, #813d9c); }
[data-node]:nth-child(5n) .exotic-pack__box { background: linear-gradient(#f6f5f4, #9a9996); }
`;

const SPARKLINE_CSS = `
.windease-zone { border: 0; border-radius: 0; background: #0d1117; }
.exotic-pack__box { border: 0; background: #3fb950; }
[data-node]:nth-child(2n) .exotic-pack__box { background: #238636; }
`;

const LOG_CSS = `
.windease-zone { border: 0; border-radius: 0; background: #1e1e1e; }
.exotic-pack__box { border: 0; background: #d4d4d4; }
[data-node]:nth-child(2n) .exotic-pack__box { background: #569cd6; }
`;

const SETTINGS_CSS = `
.windease-zone { border: 0; border-radius: 0; background: #f2f2f7; }
.exotic-pack__box {
  display: flex;
  align-items: center;
  border: 0;
  border-radius: 8px;
  background: #fff;
  box-shadow: 0 0 0 0.5px rgb(0 0 0 / 12%);
}
.exotic-pack__box::after { content: '›'; margin: 0 12px 0 auto; color: #c7c7cc; font: 20px system-ui; }
.exotic-pack__label { padding: 0 12px; color: #000; font: 13px -apple-system, system-ui, sans-serif; }
`;

const BOOTSTRAP_CSS = `
.windease-zone { border: 0; border-radius: 0; background: #fff; }
.exotic-pack__box {
  border: 1px solid rgb(0 0 0 / 17.5%);
  border-radius: 6px;
  background: linear-gradient(#e9ecef 0 45%, #fff 45%);
}
.exotic-pack__label { color: #212529; font: 16px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; }
`;

const TOOLBAR_CSS = `
.windease-zone { border: 0; border-radius: 0; background: #f3f3f3; }
.exotic-pack__box {
  border: 1px solid #c4c4c4;
  border-radius: 4px;
  background: linear-gradient(#fff, #ececec);
}
.exotic-pack__box:hover { background: #e5f1fb; border-color: #0078d4; }
`;

const CHIPS_CSS = `
.windease-zone { border: 0; border-radius: 0; background: #fef7ff; }
.exotic-pack__box { border: 1px solid #79747e; border-radius: 8px; background: #e8def8; }
`;

const MASONRY_CSS = `
.windease-zone { border: 0; border-radius: 0; background: #fff; }
.exotic-pack__box { border: 2px solid rgb(0 0 0 / 50%); border-radius: 5px; background: #d26; }
[data-node]:nth-child(3n + 2) .exotic-pack__box { background: #c25; }
[data-node]:nth-child(3n) .exotic-pack__box { background: #e14; }
`;

const FEED_CSS = `
.windease-zone { border: 0; border-radius: 0; background: #fafafa; }
.exotic-pack__box { border: 1px solid #dbdbdb; border-radius: 4px; background: linear-gradient(160deg, #e8c39e, #b0766a); }
[data-node]:nth-child(2n) .exotic-pack__box { background: linear-gradient(160deg, #a1c4fd, #c2e9fb); }
`;

const PAPER_CSS = `
.windease-zone { border: 1px solid #000; border-radius: 0; background: #fff; }
.exotic-pack__box { border: 1px solid #000; background: #d9d9d9; }
[data-node]:nth-child(2n) .exotic-pack__box { background: #bfbfbf; }
.exotic-pack__label { font: 11px 'Times New Roman', Times, serif; }
`;

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
    css: GNOME_GRID_CSS,
    source:
      'App launcher grid (iOS home screen, GNOME app grid): 500 identical 64px icons, 8px gap',
    stress: 'identical sizes: all three packers should agree on one row-major grid',
    description:
      'An app launcher grid, like the iPhone home screen or the GNOME app grid, where every icon is the same 64-pixel square. Icons fill each row left to right and wrap to the next, and hundreds of installed apps make one long, perfectly regular grid.',
    viewport: { w: 1000, h: 600 },
    strategy: 'skyline',
    config: { gap: 8 },
    boxes: repeat(500, [64, 64]),
  }),
  packPreset({
    id: 'vertical-needles',
    css: SPARKLINE_CSS,
    source: 'Sparkline/bar-chart atlas: 400 1×10000 column textures',
    stress: '1px-wide items: masonry’s default column width becomes 1, so 300 columns',
    description:
      'A charting app that stores each bar of a bar chart or sparkline as its own texture, every one a single pixel wide and thousands of pixels tall. Four hundred of them go into a texture only a few hundred pixels wide.',
    viewport: { w: 300, h: 1000 },
    strategy: 'column',
    boxes: repeat(400, [1, 10000]),
  }),
  packPreset({
    id: 'horizontal-needles',
    css: LOG_CSS,
    source: 'Log-viewer line textures: 10000×1 rows interleaved with 1×1 dots',
    stress: 'every other item is 12× wider than the container; dots must not tuck under a needle',
    description:
      'A log viewer that renders each log line to its own texture, one pixel tall and far wider than the screen, with tiny one-pixel marks between the lines. All of them go into one atlas narrower than any single line.',
    viewport: { w: 800, h: 400 },
    strategy: 'skyline',
    boxes: Array.from({ length: 100 }, (_, i): Box => (i % 2 ? [1, 1] : [10000, 1])),
  }),
  packPreset({
    id: 'exact-container-width',
    css: SETTINGS_CSS,
    source:
      'Settings list rows (macOS System Settings, Android preferences): full-width 800×30 rows, 8px gap',
    stress: 'every item exactly the container width: one per row, no width overflow',
    description:
      "A settings screen, like macOS System Settings or Android's preferences, is a list of rows that each span the full width of the window. Nothing sits beside a row, so each one starts a new line.",
    viewport: { w: 800, h: 400 },
    strategy: 'shelf',
    config: { gap: 8 },
    boxes: repeat(20, [800, 30]),
  }),
  packPreset({
    id: 'width-plus-gap-fits',
    css: BOOTSTRAP_CSS,
    source: 'Bootstrap-style 4-up card row: 4×244 + 3×8 = 1000 exactly',
    stress: 'n·w + (n−1)·gap equals the width: n per row, not n−1',
    description:
      'A web page row of cards, Bootstrap style, whose widths were chosen so that four cards plus the three gaps between them come to exactly the width of the 1000-pixel container.',
    viewport: { w: 1000, h: 600 },
    strategy: 'shelf',
    config: { gap: 8 },
    boxes: repeat(12, [244, 100]),
  }),
  packPreset({
    id: 'width-plus-gap-one-over',
    css: BOOTSTRAP_CSS,
    source: 'The same 4-up card row with cards one pixel too wide',
    stress: 'n·w + (n−1)·gap exceeds the width by 1px: n−1 per row',
    description:
      'The same row of cards, but each card is one pixel too wide, so four cards and their gaps overshoot the 1000-pixel container by 4 pixels and the fourth card wraps to the next row.',
    viewport: { w: 1000, h: 600 },
    strategy: 'shelf',
    config: { gap: 8 },
    boxes: repeat(12, [245, 100]),
  }),
  packPreset({
    id: 'equal-sixths',
    css: TOOLBAR_CSS,
    source: 'A toolbar of six tiles each computed as width / 6 (flex: 1 1 0 measured back into px)',
    stress: 'six 100/6 widths sum past 100 in floating point: the last must not wrap',
    description:
      "A toolbar of six equal buttons laid out with CSS flexbox, each told to take an equal share of the width, then measured back into pixel widths. One sixth of the toolbar is a width a computer's floating-point numbers cannot store exactly.",
    viewport: { w: 100, h: 100 },
    strategy: 'shelf',
    boxes: repeat(6, [100 / 6, 20]),
  }),
  packPreset({
    id: 'gap-dominates',
    css: CHIPS_CSS,
    source: 'Material spacing token misapplied: 16px chips with a 64px gap',
    stress: 'gap four times the item size: the gap, not the items, sets the pitch',
    description:
      'A row of small 16-pixel chips, such as compact tags or status dots, where a designer applied a 64-pixel spacing token meant for page sections, so the space between chips is four times the size of the chips themselves.',
    viewport: { w: 400, h: 400 },
    strategy: 'column',
    config: { gap: 64 },
    boxes: repeat(100, [16, 16]),
  }),
  packPreset({
    id: 'masonry-images-loading',
    css: MASONRY_CSS,
    source: 'Masonry.js before imagesLoaded fires: every third tile has no measured size yet',
    stress:
      'unsized items interleaved: they go to unplaced, and never shift or drop the sized ones',
    description:
      'A Masonry.js image wall on a web page that has just loaded: the images have not finished downloading, so a third of the tiles have no known size yet. Pages usually wait for the imagesLoaded library to report each image ready and then lay the wall out again.',
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
    css: FEED_CSS,
    source: 'Chronological photo feed that happens to grow taller: the order NFDH sorts away from',
    stress: 'next-fit shelf with heights ascending: each row’s tallest item arrives last',
    description:
      'A photo feed shown in the order the photos were taken, where the photos happen to get steadily taller as the feed goes on. Photos fill rows left to right in feed order, without being sorted by size first.',
    viewport: { w: 1000, h: 1000 },
    strategy: 'shelf',
    config: { gap: 4 },
    boxes: Array.from({ length: 60 }, (_, i): Box => [100 + ((i * 53) % 90), 10 + i * 10]),
  }),
  packPreset({
    id: 'staircase-widths',
    css: PAPER_CSS,
    source:
      'Skyline worst case from Jylänki, “A Thousand Ways to Pack the Bin” (2010): widths stepping down by 1px',
    stress:
      'every item leaves a new outline segment: skyline’s segment list grows toward the width',
    description:
      'A texture atlas whose images arrive widest first, each one pixel narrower than the one before, with short heights that repeat in a cycle. It is a constructed worst case for rectangle packing rather than a real asset set.',
    viewport: { w: 1000, h: 1000 },
    strategy: 'skyline',
    boxes: Array.from({ length: 300 }, (_, i): Box => [300 - i, 1 + (i % 7)]),
  }),
  packPreset({
    id: 'narrower-than-a-pin',
    css: PINTEREST_CSS,
    source: 'Pinterest feed in a 200px split-screen pane, narrower than one 236px pin',
    stress: 'container narrower than the column width: one column, every pin overflows by 36px',
    description:
      "Pinterest's feed opened in a split-screen pane only 200 pixels wide, narrower than a single pin, which is 236 pixels wide in the desktop feed.",
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
    description:
      'A photo library of 10,000 images, as in Adobe Lightroom or Apple Photos, shown as a grid of thumbnails of mixed sizes between 40 and 200 pixels on a side. Users scroll through the whole library as one continuous grid.',
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
export function packScenario(preset: Preset, packer: PackStrategyId): Scenario {
  return presetScenario(withStrategy(preset, packer));
}

/** Presets small enough to render through the React layer. */
export const STORY_PRESETS: Preset[] = [...PRESETS, ...PATHOLOGY_PRESETS].filter(
  (p) => packItemCount(p) <= 1500,
);
