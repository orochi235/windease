import type { LayoutItem } from '../../layout-types.js';
import type { Scenario } from './invariants.js';
import { type Preset, type PresetNode, presetNodes, presetScenario } from './preset.js';

/** A child covering `cols × rows` cells. */
const tile = (id: string, cols = 1, rows = 1, title = id): PresetNode => ({
  id,
  placement: cols === 1 && rows === 1 ? {} : { span: { cols, rows } },
  meta: { title },
});

/** An invisible cell-filler: grid packs densely and has no explicit positions,
 *  so a deliberate hole has to be a child that occupies it. */
const spacer = (id: string, cols: number): PresetNode => ({
  id,
  placement: { span: { cols } },
  meta: { spacer: true },
});

const icons = (prefix: string, n: number, names: readonly string[] = []): PresetNode[] =>
  Array.from({ length: n }, (_, i) => tile(`${prefix}-${i + 1}`, 1, 1, names[i] ?? `App ${i + 1}`));

// Windows 10 Start: small 1×1, medium 2×2, wide 4×2, large 4×4, in small-tile units.
const small = (id: string, title = id) => tile(id, 1, 1, title);
const medium = (id: string, title = id) => tile(id, 2, 2, title);
const wide = (id: string, title = id) => tile(id, 4, 2, title);
const large = (id: string, title = id) => tile(id, 4, 4, title);

const WIN10_TILE_GAP = 4;

function win10Start(groupCols: 6 | 8): PresetNode {
  const group = (id: string, title: string, children: PresetNode[]): PresetNode => ({
    id,
    kind: 'group',
    strategy: 'grid',
    config: { cols: groupCols, gap: WIN10_TILE_GAP, resizable: true },
    meta: { title },
    children,
  });
  return {
    id: 'start',
    strategy: 'strip',
    config: { axis: 'x', fill: true, gap: 24, padding: 12 },
    children: [
      group('productivity', 'Productivity', [
        large('news', 'News'),
        medium('calendar', 'Calendar'),
        wide('mail', 'Mail'),
        medium('weather', 'Weather'),
        medium('xbox', 'Xbox Console Companion'),
        wide('store', 'Microsoft Store'),
        small('calc', 'Calculator'),
        small('alarms', 'Alarms & Clock'),
        small('maps', 'Maps'),
        small('camera', 'Camera'),
      ]),
      group('explore', 'Explore', [
        wide('edge', 'Microsoft Edge'),
        wide('photos', 'Photos'),
        wide('movies', 'Movies & TV'),
        small('groove', 'Groove Music'),
      ]),
    ],
  };
}

// Pixel Launcher: a 4×5 workspace, a 4-slot hotseat, and the widget picker.
const PIXEL_APPS = [
  'Phone',
  'Messages',
  'Chrome',
  'Camera',
  'Gmail',
  'Maps',
  'Photos',
  'YouTube',
  'Drive',
  'Calendar',
  'Clock',
  'Settings',
  'Play Store',
  'Files',
  'Keep',
  'Meet',
  'Wallet',
  'Fit',
  'News',
  'Podcasts',
] as const;

function pixelHome(page: PresetNode[]): PresetNode {
  return {
    id: 'launcher',
    strategy: 'strip',
    config: { axis: 'y', fill: true, gap: 8, padding: 8 },
    children: [
      {
        id: 'page',
        kind: 'group',
        strategy: 'grid',
        config: { cols: 4, maxRows: 5, gap: 8 },
        meta: { title: 'Home screen' },
        children: page,
      },
      {
        id: 'hotseat',
        kind: 'group',
        strategy: 'grid',
        config: { cols: 4, maxRows: 1, gap: 8 },
        placement: { size: { h: 72 } },
        meta: { title: 'Hotseat' },
        children: icons('dock', 4, ['Phone', 'Messages', 'Chrome', 'Camera']),
      },
      {
        id: 'picker',
        kind: 'group',
        strategy: 'grid',
        config: { cols: 4, gap: 8 },
        placement: { size: { h: 96 } },
        meta: { title: 'Widgets and apps to drag in' },
        children: [tile('widget-weather', 4, 2, 'Weather 4×2'), tile('new-app', 1, 1, 'Recorder')],
      },
    ],
  };
}

const MAC_APPS = Array.from({ length: 40 }, (_, i) => `App ${i + 1}`);

/** One Launchpad page above a Dock to drag apps in from. */
function launchpad(n: number, fill: boolean): PresetNode {
  return {
    id: 'launchpad-root',
    strategy: 'strip',
    config: { axis: 'y', fill: true, gap: 12, padding: 12 },
    children: [
      {
        id: 'lp-page',
        kind: 'group',
        strategy: 'grid',
        config: { maxCols: 7, maxRows: 5, gap: 16, padding: 24, fill },
        meta: { title: `Launchpad page, ${n} apps` },
        children: icons('lp-app', n, MAC_APPS),
      },
      {
        id: 'mac-dock',
        kind: 'group',
        strategy: 'grid',
        config: { cols: 6, maxRows: 1, gap: 8 },
        placement: { size: { h: 80 } },
        meta: { title: 'Dock' },
        children: icons('dock-app', 3, ['Finder', 'Safari', 'Mail']),
      },
    ],
  };
}

// Periodic table, 118 elements, 18 groups.
const ELEMENTS = (
  'H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se ' +
  'Br Kr Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy ' +
  'Ho Er Tm Yb Lu Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np Pu Am Cm Bk Cf ' +
  'Es Fm Md No Lr Rf Db Sg Bh Hs Mt Ds Rg Cn Nh Fl Mc Lv Ts Og'
).split(' ');
const el = (sym: string): PresetNode => ({ id: `el-${sym}`, meta: { title: sym } });
const els = (from: string, to: string) =>
  ELEMENTS.slice(ELEMENTS.indexOf(from), ELEMENTS.indexOf(to) + 1).map(el);

function periodicTable(): PresetNode {
  return {
    id: 'periodic',
    strategy: 'strip',
    config: { axis: 'y', fill: true, gap: 16, padding: 8 },
    children: [
      {
        id: 'main-table',
        kind: 'group',
        strategy: 'grid',
        config: { cols: 18, gap: 2 },
        meta: { title: 'Periods 1–7' },
        children: [
          el('H'),
          spacer('gap-p1', 16),
          el('He'),
          ...els('Li', 'Be'),
          spacer('gap-p2', 10),
          ...els('B', 'Ne'),
          ...els('Na', 'Mg'),
          spacer('gap-p3', 10),
          ...els('Al', 'Ar'),
          ...els('K', 'Kr'),
          ...els('Rb', 'Xe'),
          ...els('Cs', 'Ba'),
          { id: 'lanthanides-ref', meta: { title: '57–71' } },
          ...els('Hf', 'Rn'),
          ...els('Fr', 'Ra'),
          { id: 'actinides-ref', meta: { title: '89–103' } },
          ...els('Rf', 'Og'),
        ],
      },
      {
        id: 'f-block',
        kind: 'group',
        strategy: 'grid',
        config: { cols: 18, gap: 2 },
        placement: { size: { h: 96 } },
        meta: { title: 'f-block' },
        children: [
          spacer('f-lead-1', 2),
          ...els('La', 'Lu'),
          spacer('f-tail-1', 1),
          spacer('f-lead-2', 2),
          ...els('Ac', 'Lr'),
          spacer('f-tail-2', 1),
        ],
      },
    ],
  };
}

/** One key, `u` wide in quarter units (1u = 4 cells). */
const key = (id: string, quarters = 4, title = id): PresetNode => ({
  id: `key-${id}`,
  placement: { span: { cols: quarters } },
  meta: { title },
});
const letterKeys = (s: string) => [...s].map((c) => key(c, 4, c.toUpperCase()));

const ANSI_60_ROWS: PresetNode[][] = [
  [
    key('grave', 4, '`'),
    ...letterKeys('1234567890'),
    key('minus', 4, '-'),
    key('equal', 4, '='),
    key('backspace', 8, 'Backspace'),
  ],
  [
    key('tab', 6, 'Tab'),
    ...letterKeys('qwertyuiop'),
    key('lbracket', 4, '['),
    key('rbracket', 4, ']'),
    key('backslash', 6, '\\'),
  ],
  [
    key('caps', 7, 'Caps'),
    ...letterKeys('asdfghjkl'),
    key('semicolon', 4, ';'),
    key('quote', 4, "'"),
    key('enter', 9, 'Enter'),
  ],
  [
    key('lshift', 9, 'Shift'),
    ...letterKeys('zxcvbnm'),
    key('comma', 4, ','),
    key('period', 4, '.'),
    key('slash', 4, '/'),
    key('rshift', 11, 'Shift'),
  ],
  [
    key('lctrl', 5, 'Ctrl'),
    key('lwin', 5, 'Win'),
    key('lalt', 5, 'Alt'),
    key('space', 25, ''),
    key('ralt', 5, 'Alt'),
    key('rwin', 5, 'Win'),
    key('menu', 5, 'Menu'),
    key('rctrl', 5, 'Ctrl'),
  ],
];

/** The same board in whole units, spans written as the keycap's own `u` size. */
const fractionalKey = (n: PresetNode): PresetNode => {
  const quarters = (n.placement as { span: { cols: number } }).span.cols;
  return { ...n, placement: { span: { cols: quarters / 4 } } };
};

const cell = (ref: string, pinnedAt?: number): PresetNode => ({
  id: `cell-${ref}`,
  placement: pinnedAt === undefined ? {} : { pinned: pinnedAt },
  meta: { title: ref },
});

/** Excel with row 1 and column A frozen: every header cell pinned to its own index. */
function frozenSheet(): PresetNode {
  const COLS = 6;
  const ROWS = 9;
  const children: PresetNode[] = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const index = r * COLS + c;
      const ref =
        r === 0
          ? c === 0
            ? 'corner'
            : String.fromCharCode(64 + c)
          : c === 0
            ? `row${r}`
            : `${String.fromCharCode(64 + c)}${r}`;
      children.push(cell(ref, r === 0 || c === 0 ? index : undefined));
    }
  }
  return {
    id: 'sheet',
    kind: 'group',
    strategy: 'grid',
    config: { cols: COLS, maxRows: 6, gap: 1 },
    meta: { title: 'Book1 — Sheet1' },
    children,
  };
}

/**
 * Real-software layouts whose containers run `grid`. Spans are in the
 * product's own cell units; viewports are CSS pixels.
 */
export const PRESETS: Preset[] = [
  {
    id: 'win10-start-6',
    source: 'Windows 10 Start menu, two live-tile groups at the default 6-small-tile width',
    stress:
      'mixed 1×1/2×2/4×2/4×4 spans; three wide tiles in a 6-wide group leave 2-column holes nothing can fill',
    viewport: { w: 760, h: 560 },
    root: win10Start(6),
  },
  {
    id: 'win10-start-8',
    source: 'Windows 10 Start menu with "Show more tiles" on (8-small-tile groups)',
    stress: 'the same tiles reflowed to 8 columns: wide tiles now pair up and the holes close',
    viewport: { w: 960, h: 560 },
    root: win10Start(8),
  },
  {
    id: 'win8-start-screen',
    source:
      'Windows 8.1 Start screen: tiles flow in columns under a fixed row count and scroll sideways',
    stress: 'fixed `rows` with no column cap, so wide and large tiles must grow the grid sideways',
    viewport: { w: 1366, h: 768 },
    root: {
      id: 'start8',
      kind: 'group',
      strategy: 'grid',
      config: { rows: 4, gap: 8, padding: 40 },
      meta: { title: 'Start' },
      children: [
        wide('desktop', 'Desktop'),
        medium('ie', 'Internet Explorer'),
        medium('store8', 'Store'),
        large('people', 'People'),
        wide('weather8', 'Weather'),
        medium('skydrive', 'SkyDrive'),
        small('mail8', 'Mail'),
        small('calendar8', 'Calendar'),
      ],
    },
  },
  {
    id: 'grafana-node-exporter',
    source: 'Grafana "Node Exporter Full" dashboard (24-column gridPos, 30px row unit)',
    stress:
      'panel w/h spans in a 24-column grid, full-width row headers, a panel at the right edge, and a w:30 panel wider than the grid',
    viewport: { w: 1440, h: 900 },
    root: {
      id: 'dashboard',
      kind: 'group',
      strategy: 'grid',
      config: { cols: 24, gap: 4, padding: 8, resizable: true },
      meta: { title: 'Node Exporter Full' },
      children: [
        tile('row-quick', 24, 1, 'Quick CPU / Mem / Disk'),
        tile('pressure', 3, 4, 'Pressure'),
        tile('cpu-busy', 3, 4, 'CPU Busy'),
        tile('sys-load', 3, 4, 'Sys Load'),
        tile('ram-used', 3, 4, 'RAM Used'),
        tile('swap-used', 3, 4, 'SWAP Used'),
        tile('root-fs', 3, 4, 'Root FS Used'),
        tile('cpu-cores', 2, 2, 'CPU Cores'),
        tile('uptime', 4, 2, 'Uptime'),
        tile('rootfs-total', 2, 2, 'RootFS Total'),
        tile('ram-total', 2, 2, 'RAM Total'),
        tile('swap-total', 2, 2, 'SWAP Total'),
        tile('row-basic', 24, 1, 'Basic CPU / Mem / Net / Disk'),
        tile('cpu-basic', 12, 7, 'CPU Basic'),
        tile('mem-basic', 12, 7, 'Memory Basic'),
        tile('net-basic', 12, 7, 'Network Traffic Basic'),
        tile('disk-basic', 8, 7, 'Disk Space Used Basic'),
        tile('edge-panel', 4, 7, 'Right-edge panel'),
        tile('imported-w30', 30, 3, 'Imported panel with w: 30'),
      ],
    },
  },
  {
    id: 'android-full-by-cells',
    source: 'Pixel Launcher (Android 14) 4×5 home screen with At a Glance and a 2×2 weather widget',
    stress:
      'page full by cells (20/20) but only 14 children; a 4×2 widget arriving must be refused by cell count, not item count',
    viewport: { w: 412, h: 915 },
    root: pixelHome([
      tile('glance', 4, 1, 'At a Glance'),
      tile('weather-2x2', 2, 2, 'Weather'),
      ...icons('app', 12, PIXEL_APPS.slice(4)),
    ]),
  },
  {
    id: 'android-full-by-count',
    source: 'Pixel Launcher (Android 14) 4×5 home screen packed with 20 app icons',
    stress: 'page full by count; any arrival, icon or widget, has nowhere to go',
    viewport: { w: 412, h: 915 },
    root: pixelHome(icons('app', 20, PIXEL_APPS)),
  },
  {
    id: 'android-fragmented',
    source: 'Pixel Launcher 4×5 home screen with three icons above a 4×2 clock widget',
    stress:
      'nine free cells, but no three contiguous rows: a 3×3 widget fits by count and not by shape',
    viewport: { w: 412, h: 915 },
    root: pixelHome([...icons('app', 3, PIXEL_APPS), tile('clock-4x2', 4, 2, 'Clock')]),
  },
  {
    id: 'ios-dock',
    source: 'iPhone home screen: a 4×6 page above a one-row, four-slot dock holding three apps',
    stress:
      'maxCols 4 × maxRows 1 underfilled — the auto-balance must not pick a square and drop the third app',
    viewport: { w: 390, h: 844 },
    root: {
      id: 'springboard',
      strategy: 'strip',
      config: { axis: 'y', fill: true, gap: 8, padding: 8 },
      children: [
        {
          id: 'ios-page',
          kind: 'group',
          strategy: 'grid',
          config: { cols: 4, maxRows: 6, gap: 12 },
          meta: { title: 'Home Screen' },
          children: icons('ios-app', 8, [
            'Mail',
            'Notes',
            'Maps',
            'Photos',
            'Clock',
            'Weather',
            'Music',
            'Podcasts',
          ]),
        },
        {
          id: 'ios-dock',
          kind: 'group',
          strategy: 'grid',
          config: { maxCols: 4, maxRows: 1, gap: 12, padding: 12 },
          placement: { size: { h: 96 } },
          meta: { title: 'Dock' },
          children: icons('ios-dock-app', 3, ['Phone', 'Safari', 'Messages']),
        },
      ],
    },
  },
  {
    id: 'launchpad-full',
    source: 'macOS Launchpad, one 7×5 page holding exactly 35 apps',
    stress:
      'a page full to the cap must place all 35 — the auto-balance picks 6 columns for 26–36 items',
    viewport: { w: 1440, h: 900 },
    root: launchpad(35, true),
  },
  {
    id: 'launchpad-overflow',
    source: 'macOS Launchpad, 40 apps against a fixed 7×5 page',
    stress: 'exactly 35 placed and the other 5 in `unplaced`, the pagination signal',
    viewport: { w: 1440, h: 900 },
    root: launchpad(40, false),
  },
  {
    id: 'launchpad-thirty',
    source: 'macOS Launchpad, a fixed 7×5 page holding 30 apps',
    stress: 'five cells free, so an app dragged in from the Dock must be accepted',
    viewport: { w: 1440, h: 900 },
    root: launchpad(30, false),
  },
  {
    id: 'excel-frozen-panes',
    source: 'Excel with row 1 and column A frozen, scrolled so only 6 rows fit',
    stress:
      'header cells pinned to their childOrder index; capacity trims data rows, and a pin is an index, not a cell',
    viewport: { w: 720, h: 180 },
    root: frozenSheet(),
  },
  {
    id: 'periodic-table',
    source:
      'IUPAC periodic table: 18 groups, the gap over groups 3–12 in periods 1–3, and the detached f-block',
    stress:
      'holes expressed as spacer spans (16, 10, 10), and a second grid aligned to the first by leading spacers',
    viewport: { w: 1080, h: 600 },
    root: periodicTable(),
  },
  {
    id: 'keyboard-ansi-60',
    source:
      'ANSI 60% keyboard (1.25u/1.5u/1.75u/2.25u/2.75u/6.25u keys) at quarter-unit resolution',
    stress:
      'fractional key widths as integer spans of a 60-column grid; every row must sum to exactly 15u',
    viewport: { w: 900, h: 300 },
    root: {
      id: 'keyboard',
      kind: 'group',
      strategy: 'grid',
      config: { cols: 60, gap: 2, padding: 6 },
      meta: { title: 'ANSI 60%' },
      children: ANSI_60_ROWS.flat(),
    },
  },
  {
    id: 'keyboard-ansi-60-units',
    source:
      'ANSI 60% keyboard written with keycap `u` sizes as spans (Tab 1.5, Enter 2.25, Space 6.25)',
    stress:
      'fractional spans: grid floors them to whole cells, so the rows no longer sum to 15 and keys wrap onto the wrong row',
    viewport: { w: 900, h: 300 },
    root: {
      id: 'keyboard-u',
      kind: 'group',
      strategy: 'grid',
      config: { cols: 15, gap: 2, padding: 6 },
      meta: { title: 'ANSI 60%, u spans' },
      children: ANSI_60_ROWS.flat().map(fractionalKey),
    },
  },
  {
    id: 'win11-snap-left-tall',
    source: 'Windows 11 Snap Layouts, "one tall left, two stacked right"',
    stress: 'a 1×2 span in a 2×2 capped grid; a fourth window must be refused',
    viewport: { w: 1280, h: 720 },
    root: {
      id: 'snap',
      kind: 'group',
      strategy: 'grid',
      config: { maxCols: 2, maxRows: 2 },
      meta: { title: 'Snap layout' },
      children: [
        tile('snap-left', 1, 2, 'Edge'),
        tile('snap-tr', 1, 1, 'Terminal'),
        tile('snap-br', 1, 1, 'Explorer'),
      ],
    },
  },
];

/** Ids of every container in `preset` that runs `grid`. */
export function gridContainerIds(preset: Preset): string[] {
  return presetNodes(preset)
    .filter(({ node }) => node.strategy === 'grid')
    .map(({ node }) => node.id);
}

/** Every grid container of every preset, flattened to a strategy scenario. */
export function presetGridScenarios(): Scenario[] {
  return PRESETS.flatMap((p) => gridContainerIds(p).map((id) => presetScenario(p, id)));
}

const n1 = (n: number, prefix = 'i'): LayoutItem[] =>
  Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}` }));
const spanned = (id: string, cols: number, rows = 1): LayoutItem => ({
  id,
  placement: { span: { cols, rows } },
});

/** Pathological inputs no product ships on purpose but a corrupt snapshot or a bad config can. */
export const PATHOLOGICAL: Scenario[] = [
  {
    id: 'span-zero-and-negative',
    source: 'a persisted span of 0 / -3 (e.g. a dashboard JSON hand-edited to hide a panel)',
    stress: 'spans below 1 must clamp to one cell, never vanish',
    container: { w: 400, h: 200 },
    items: [spanned('zero', 0, 0), spanned('negative', -3, -3), ...n1(2)],
    options: { cols: 4 },
  },
  {
    id: 'span-fractional',
    source: 'a span computed from pixels (w / cellWidth) without rounding',
    stress: 'fractional spans floor to whole cells',
    container: { w: 400, h: 200 },
    items: [spanned('two-point-nine', 2.9, 1.5), ...n1(3)],
    options: { cols: 4 },
  },
  {
    id: 'span-nan-capped',
    source: 'a span of NaN from `parseInt` on an empty field, in a row-capped grid',
    stress: 'NaN should clamp like any other nonsense span, not unplace the item',
    container: { w: 400, h: 300 },
    items: [{ id: 'nan', placement: { span: { cols: Number.NaN, rows: Number.NaN } } }, ...n1(2)],
    options: { cols: 2, maxRows: 3 },
  },
  {
    id: 'span-huge',
    source: 'a span of 1e9 columns and rows under a row cap',
    stress: 'both axes clamp to the grid rather than overflowing or allocating',
    container: { w: 400, h: 300 },
    items: [spanned('huge', 1e9, 1e9), ...n1(2)],
    options: { cols: 3, maxRows: 3 },
  },
  {
    id: 'one-cell',
    source: 'watchOS Smart Stack: one widget visible at a time',
    stress: 'a 1×1 capped grid with three children and a 2×2 span',
    container: { w: 184, h: 224 },
    items: [spanned('big', 2, 2), ...n1(2)],
    options: { maxCols: 1, maxRows: 1 },
  },
  {
    id: 'zero-container',
    source: 'a grid mounted inside a collapsed (display: none → 0×0) parent',
    stress: 'padding and gap larger than the container',
    container: { w: 0, h: 0 },
    items: n1(3),
    options: { cols: 2, gap: 10, padding: 10 },
  },
  {
    id: 'thousand-tiles',
    source: 'a photo-library contact sheet of 1000 thumbnails',
    stress: 'first-fit reservation over a large child list',
    container: { w: 1200, h: 800 },
    items: n1(1000, 'photo'),
    options: { cols: 40, gap: 1 },
  },
  {
    id: 'cols-infinite',
    source: 'a config of `cols: Infinity` from `Math.max(...[])` on an empty width list, negated',
    stress: 'an unbounded column count',
    container: { w: 400, h: 200 },
    items: n1(3),
    options: { cols: Number.POSITIVE_INFINITY },
  },
];

/** 10k children, with a 2×2 every 97th, for cost tests. */
export const TEN_THOUSAND: LayoutItem[] = Array.from({ length: 10_000 }, (_, i) =>
  i % 97 === 0 ? spanned(`t${i}`, 2, 2) : { id: `t${i}` },
);
