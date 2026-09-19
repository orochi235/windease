import type { LayoutItem } from '../../layout-types.js';
import type { Scenario } from './invariants.js';
import {
  type Preset,
  type PresetData,
  type PresetNode,
  presetNodes,
  presetScenario,
  styled,
  titles,
} from './preset.js';

/** The two halves of a preset a builder returns, spread into the preset literal. */
type Halves = Pick<Preset, 'mechanics' | 'data'>;

/** A cell covering `cols × rows` cells, untitled. */
const span = (id: string, cols = 1, rows = 1): PresetNode => ({
  id,
  placement: cols === 1 && rows === 1 ? {} : { span: { cols, rows } },
});

/** A titled child covering `cols × rows` cells. */
const tile = (id: string, cols = 1, rows = 1, title = id): PresetNode => ({
  ...span(id, cols, rows),
  meta: { title },
});

/** `node` with its top-left corner at `col, row`. */
const at = (node: PresetNode, col: number, row: number): PresetNode => ({
  ...node,
  placement: { ...node.placement, cell: { col, row } },
});

/** A content container's children are apps unless a child says otherwise. */
const APP: NonNullable<PresetNode['item']> = { kind: 'app' };

const icons = (prefix: string, n: number, names: readonly string[] = []): PresetNode[] =>
  Array.from({ length: n }, (_, i) => tile(`${prefix}-${i + 1}`, 1, 1, names[i] ?? `App ${i + 1}`));

const widget = (id: string, cols: number, rows: number, title: string): PresetNode => ({
  ...tile(id, cols, rows, title),
  kind: 'widget',
});

/** A Grafana panel from its `gridPos`: `x, y` its cell, `w × h` its span. */
const panel = (id: string, x: number, y: number, w: number, h: number, title: string) =>
  at(tile(id, w, h, title), x, y);

/** `nodes` at the free cells of a `cols`-wide page, row-major, skipping
 *  `taken` (as `col,row` keys): where a user left them. */
function placed(nodes: PresetNode[], cols: number, taken: readonly string[] = []): PresetNode[] {
  const skip = new Set(taken);
  let i = 0;
  return nodes.map((node) => {
    while (skip.has(`${i % cols},${Math.floor(i / cols)}`)) i++;
    const out = at(node, i % cols, Math.floor(i / cols));
    i++;
    return out;
  });
}

// Windows 10 Start: small 1×1, medium 2×2, wide 4×2, large 4×4, in small-tile units.
const small = (id: string, title = id) => tile(id, 1, 1, title);
const medium = (id: string, title = id) => tile(id, 2, 2, title);
const wide = (id: string, title = id) => tile(id, 4, 2, title);
const large = (id: string, title = id) => tile(id, 4, 4, title);

const WIN10_TILE_GAP = 4;

/** The Start menu's two groups are mechanics; the tiles pinned in them are the user's. */
function win10Start(groupCols: 6 | 8): Halves {
  const group = (id: string): PresetNode => ({
    id,
    kind: 'group',
    strategy: 'grid',
    config: { cols: groupCols, gap: WIN10_TILE_GAP, resizable: true },
  });
  return {
    mechanics: {
      id: 'start',
      strategy: 'strip',
      config: { axis: 'x', fill: true, gap: 24, padding: 12, accepts: false },
      children: [group('productivity'), group('explore')],
    },
    data: {
      nodes: titles({ productivity: 'Productivity', explore: 'Explore' }),
      children: {
        productivity: [
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
        ],
        explore: [
          wide('edge', 'Microsoft Edge'),
          wide('photos', 'Photos'),
          wide('movies', 'Movies & TV'),
          small('groove', 'Groove Music'),
        ],
      },
    },
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

/**
 * The launcher's page, hotseat and picker are mechanics; the icons and widgets
 * on them are the user's, each on the page at the cell it was left in.
 * Launcher3 divides the workspace into cells rather than fixing their size,
 * so these grids do too. The hotseat takes apps only.
 */
function pixelHome(page: PresetNode[]): Halves {
  return {
    mechanics: {
      id: 'launcher',
      strategy: 'strip',
      config: { axis: 'y', fill: true, gap: 8, padding: 8, accepts: false },
      children: [
        {
          id: 'page',
          kind: 'group',
          strategy: 'grid',
          config: { cols: 4, maxRows: 5, gap: 8 },
          item: APP,
        },
        {
          id: 'hotseat',
          kind: 'group',
          strategy: 'grid',
          config: { cols: 4, maxRows: 1, gap: 8, accepts: { kinds: ['app'] } },
          placement: { size: { h: 72 } },
          item: APP,
        },
        {
          id: 'picker',
          kind: 'group',
          strategy: 'grid',
          config: { cols: 4, gap: 8 },
          placement: { size: { h: 96 } },
          item: APP,
        },
      ],
    },
    data: {
      nodes: titles({
        page: 'Home screen',
        hotseat: 'Hotseat',
        picker: 'Widgets and apps to drag in',
      }),
      children: {
        page,
        hotseat: icons('dock', 4, ['Phone', 'Messages', 'Chrome', 'Camera']),
        picker: [widget('widget-weather', 4, 2, 'Weather 4×2'), tile('new-app', 1, 1, 'Recorder')],
      },
    },
  };
}

/** An iPhone app icon, in points, which are the viewport's CSS pixels. */
const IOS_ICON = 60;

const MAC_APPS = Array.from({ length: 40 }, (_, i) => `App ${i + 1}`);

/** A Launchpad cell at 1440×900: a 96px icon over its label. */
const LAUNCHPAD_CELL = { w: 112, h: 124 };

/**
 * One Launchpad page above a Dock to drag apps in from; the apps are the
 * user's. Launchpad keeps every icon one size and spreads the 7×5 page across
 * the screen, so the page has fixed cells spaced evenly.
 */
function launchpad(n: number): Halves {
  return {
    mechanics: {
      id: 'launchpad-root',
      strategy: 'strip',
      config: { axis: 'y', fill: true, gap: 12, padding: 12, accepts: false },
      children: [
        {
          id: 'lp-page',
          kind: 'group',
          strategy: 'grid',
          config: {
            cols: 7,
            maxRows: 5,
            gap: 16,
            padding: 24,
            cell: LAUNCHPAD_CELL,
            justify: 'evenly',
          },
          item: APP,
        },
        {
          id: 'mac-dock',
          kind: 'group',
          strategy: 'grid',
          config: { cols: 6, maxRows: 1, gap: 8 },
          placement: { size: { h: 80 } },
          item: APP,
        },
      ],
    },
    data: {
      nodes: titles({ 'lp-page': `Launchpad page, ${n} apps`, 'mac-dock': 'Dock' }),
      children: {
        'lp-page': icons('lp-app', n, MAC_APPS),
        'mac-dock': icons('dock-app', 3, ['Finder', 'Safari', 'Mail']),
      },
    },
  };
}

// Periodic table, 118 elements, 18 groups.
const ELEMENTS = (
  'H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se ' +
  'Br Kr Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy ' +
  'Ho Er Tm Yb Lu Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np Pu Am Cm Bk Cf ' +
  'Es Fm Md No Lr Rf Db Sg Bh Hs Mt Ds Rg Cn Nh Fl Mc Lv Ts Og'
).split(' ');
/** A run of consecutive elements on one row: `[row, first group, from, to]`, groups 1-based. */
type Run = readonly [row: number, group: number, from: string, to: string];

const elementsAt = (runs: readonly Run[]): PresetNode[] =>
  runs.flatMap(([row, group, from, to]) =>
    ELEMENTS.slice(ELEMENTS.indexOf(from), ELEMENTS.indexOf(to) + 1).map((sym, i) =>
      at({ id: `el-${sym}` }, group - 1 + i, row),
    ),
  );

/** Periods 1–7 as rows 0–6, the f-block left out. */
const MAIN_RUNS: Run[] = [
  [0, 1, 'H', 'H'],
  [0, 18, 'He', 'He'],
  [1, 1, 'Li', 'Be'],
  [1, 13, 'B', 'Ne'],
  [2, 1, 'Na', 'Mg'],
  [2, 13, 'Al', 'Ar'],
  [3, 1, 'K', 'Kr'],
  [4, 1, 'Rb', 'Xe'],
  [5, 1, 'Cs', 'Ba'],
  [5, 4, 'Hf', 'Rn'],
  [6, 1, 'Fr', 'Ra'],
  [6, 4, 'Rf', 'Og'],
];

/** The lanthanides and actinides, from group 3 on. */
const F_RUNS: Run[] = [
  [0, 3, 'La', 'Lu'],
  [1, 3, 'Ac', 'Lr'],
];

/** Every element sits at its group and period; the symbols on them are data. */
function periodicTable(): Halves {
  const mechanics: PresetNode = {
    id: 'periodic',
    strategy: 'strip',
    config: { axis: 'y', fill: true, gap: 16, padding: 8, accepts: false },
    children: [
      {
        id: 'main-table',
        kind: 'group',
        strategy: 'grid',
        config: { cols: 18, gap: 2 },
        children: [
          ...elementsAt(MAIN_RUNS),
          at({ id: 'lanthanides-ref' }, 2, 5),
          at({ id: 'actinides-ref' }, 2, 6),
        ],
      },
      {
        id: 'f-block',
        kind: 'group',
        strategy: 'grid',
        config: { cols: 18, gap: 2 },
        placement: { size: { h: 96 } },
        children: elementsAt(F_RUNS),
      },
    ],
  };
  const nodes = titles({
    'main-table': 'Periods 1–7',
    'f-block': 'f-block',
    'lanthanides-ref': '57–71',
    'actinides-ref': '89–103',
    ...Object.fromEntries(ELEMENTS.map((sym) => [`el-${sym}`, sym])),
  });
  for (const [category, runs] of Object.entries(ELEMENT_CATEGORIES)) {
    for (const run of runs.split(' ')) {
      const [from, to = from] = run.split('..') as [string, string?];
      for (const sym of ELEMENTS.slice(ELEMENTS.indexOf(from), ELEMENTS.indexOf(to) + 1)) {
        nodes[`el-${sym}`]!.className = `pt-${category}`;
      }
    }
  }
  nodes['lanthanides-ref']!.className = 'pt-lanthanide pt-ref';
  nodes['actinides-ref']!.className = 'pt-actinide pt-ref';
  return { mechanics, data: { nodes } };
}

/** Each element's category, for the table's colors. Symbols run from `from` to `to` where written `from..to`. */
const ELEMENT_CATEGORIES: Record<string, string> = {
  alkali: 'Li Na K Rb Cs Fr',
  alkaline: 'Be Mg Ca Sr Ba Ra',
  transition: 'Sc..Zn Y..Cd Hf..Hg Rf..Cn',
  'post-transition': 'Al Ga In Sn Tl Pb Bi Po Nh Fl Mc Lv',
  metalloid: 'B Si Ge As Sb Te',
  nonmetal: 'H C N O P S Se',
  halogen: 'F Cl Br I At Ts',
  noble: 'He Ne Ar Kr Xe Rn Og',
  lanthanide: 'La..Lu',
  actinide: 'Ac..Lr',
};

/** One key: its id, its width in quarter units (1u = 4 cells), and its legend. */
type Key = readonly [id: string, quarters: number, legend: string];
const key = (id: string, quarters = 4, legend = id): Key => [id, quarters, legend];
const letterKeys = (s: string) => [...s].map((c) => key(c, 4, c.toUpperCase()));

const ANSI_60_ROWS: Key[][] = [
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

/** The board's keys, spans in cells of `quartersPerCell` quarter units. The legends are data. */
const keyboard = (id: string, cols: number, quartersPerCell: number, title: string): Halves => ({
  mechanics: {
    id,
    kind: 'group',
    strategy: 'grid',
    config: { cols, gap: 2, padding: 6 },
    children: ANSI_60_ROWS.flat().map(([k, quarters]) => ({
      id: `key-${k}`,
      placement: { span: { cols: quarters / quartersPerCell } },
    })),
  },
  data: {
    nodes: titles({
      [id]: title,
      ...Object.fromEntries(ANSI_60_ROWS.flat().map(([k, , legend]) => [`key-${k}`, legend])),
    }),
  },
});

const cell = (ref: string, pinnedAt?: number): PresetNode => ({
  id: `cell-${ref}`,
  placement: pinnedAt === undefined ? {} : { pinned: pinnedAt },
});

/**
 * Excel with row 1 and column A frozen: every header cell pinned to its own
 * index. The cells are the sheet's structure; their references are data.
 */
function frozenSheet(): Halves {
  const COLS = 6;
  const ROWS = 9;
  const children: PresetNode[] = [];
  const nodes: NonNullable<PresetData['nodes']> = { sheet: { meta: { title: 'Book1 — Sheet1' } } };
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
      const header = r === 0 || c === 0;
      children.push(cell(ref, header ? index : undefined));
      nodes[`cell-${ref}`] = { meta: { title: ref }, ...(header ? { className: 'xl-head' } : {}) };
    }
  }
  return {
    mechanics: {
      id: 'sheet',
      kind: 'group',
      strategy: 'grid',
      // Excel's defaults at 100%: 64px columns, 20px rows, a narrow row-number column.
      config: {
        cols: COLS,
        maxRows: 6,
        gap: 1,
        cell: { h: 20 },
        tracks: { cols: [32, 64, 64, 64, 64, 64], rows: [20, 20, 20, 20, 20, 20] },
        resizable: true,
      },
      children,
    },
    data: { nodes },
  };
}

const WIN10_CSS = `
& { background: #1f1f1f; border-radius: 0; }
.xg-group { background: none; }
.xg-group__title { padding: 4px 0 8px; color: #fff; font: 13px 'Segoe UI', system-ui, sans-serif; }
.xg-tile {
  flex-direction: column-reverse;
  padding: 6px 8px;
  border-radius: 0;
  background: #0063b1;
  font: 12px 'Segoe UI', system-ui, sans-serif;
}
.xg-tile:hover { box-shadow: inset 0 0 0 2px rgb(255 255 255 / 45%); }
`;

const WIN8_CSS = `
& { background: #1e0a47; border-radius: 0; }
.xg-tile {
  flex-direction: column-reverse;
  padding: 6px 8px;
  border-radius: 0;
  background: #2d89ef;
  font: 12px 'Segoe UI', system-ui, sans-serif;
}
[data-node]:nth-child(5n + 2) .xg-tile { background: #00a300; }
[data-node]:nth-child(5n + 3) .xg-tile { background: #da532c; }
[data-node]:nth-child(5n + 4) .xg-tile { background: #603cba; }
[data-node]:nth-child(5n) .xg-tile { background: #00aba9; }
`;

const GRAFANA_CSS = `
& { background: #111217; border-radius: 0; }
.xg-tile {
  padding: 6px 8px;
  border: 1px solid rgb(204 204 220 / 12%);
  border-radius: 2px;
  background: linear-gradient(#73bf6940, #73bf6900) bottom / 100% 45% no-repeat, #181b1f;
  color: #ccccdc;
  font: 500 12px Inter, system-ui, sans-serif;
}
.xg-tile.gf-row { border: 0; background: none; font-size: 14px; }
.xg-tile.gf-row .xg-tile__title::before { content: '⌄ '; }
`;

const PIXEL_CSS = `
& { background: linear-gradient(170deg, #3b4b61, #7b8fa8 60%, #c9b8a4); border-radius: 0; }
.xg-group { background: none; }
.xg-group__title { color: rgb(255 255 255 / 70%); font: 500 11px 'Google Sans', Roboto, system-ui, sans-serif; }
.xg-tile {
  align-items: center;
  justify-content: flex-end;
  background: radial-gradient(circle at 50% calc(50% - 8px), #e8def8 0 22px, #0000 23px);
  font: 11px Roboto, system-ui, sans-serif;
  text-shadow: 0 1px 2px rgb(0 0 0 / 50%);
}
.xg-tile.px-widget {
  justify-content: center;
  border-radius: 24px;
  background: rgb(232 222 248 / 92%);
  color: #1d192b;
  font-size: 14px;
  text-shadow: none;
}
.px-picker { border-radius: 24px 24px 0 0; background: #1c1b1f; }
`;

const IOS_CSS = `
& { background: linear-gradient(160deg, #f6a6b2, #b39ddb 45%, #6fb7e8); border-radius: 0; }
.xg-group { background: none; }
.xg-group__title { color: rgb(255 255 255 / 80%); font: 600 11px -apple-system, 'SF Pro Text', system-ui, sans-serif; }
.xg-tile {
  align-items: center;
  padding: 0;
  background: none;
  font: 11px -apple-system, 'SF Pro Text', system-ui, sans-serif;
  text-shadow: 0 1px 2px rgb(0 0 0 / 35%);
}
.xg-tile::before {
  content: '';
  flex: none;
  width: 60px;
  height: 60px;
  border-radius: 14px;
  background: linear-gradient(#fdfdfd, #d9dde3);
}
[data-node]:nth-child(3n + 2) .xg-tile::before { background: linear-gradient(#5fe07a, #1fb141); }
[data-node]:nth-child(3n) .xg-tile::before { background: linear-gradient(#5ac8fa, #0a7aff); }
.ios-dockbar { border-radius: 30px; background: rgb(255 255 255 / 30%); backdrop-filter: blur(20px); }
.ios-dockbar .xg-tile__title { display: none; }
`;

const LAUNCHPAD_CSS = `
& { background: linear-gradient(160deg, #2b3a67, #5b4a8a 50%, #a0637a); border-radius: 0; }
.xg-group { background: none; }
.xg-group__title { color: rgb(255 255 255 / 60%); font: 11px -apple-system, system-ui, sans-serif; }
.xg-tile {
  align-items: center;
  padding: 4px 0 0;
  background: none;
  font: 12px -apple-system, 'SF Pro Text', system-ui, sans-serif;
  text-shadow: 0 1px 3px rgb(0 0 0 / 60%);
}
.xg-tile::before {
  content: '';
  width: 80px;
  height: 80px;
  border-radius: 18px;
  background: linear-gradient(#f5f5f7, #c8ccd4);
  box-shadow: 0 2px 6px rgb(0 0 0 / 30%);
}
[data-node]:nth-child(4n + 2) .xg-tile::before { background: linear-gradient(#ffcf5c, #ff9500); }
[data-node]:nth-child(4n + 3) .xg-tile::before { background: linear-gradient(#6ad8ff, #007aff); }
[data-node]:nth-child(4n) .xg-tile::before { background: linear-gradient(#ff8a80, #ff3b30); }
.lp-dock {
  border: 1px solid rgb(255 255 255 / 30%);
  border-radius: 16px;
  background: rgb(255 255 255 / 25%);
  backdrop-filter: blur(24px);
}
.lp-dock .xg-tile::before { width: 44px; height: 44px; border-radius: 10px; }
.lp-dock .xg-tile__title { display: none; }
`;

const EXCEL_CSS = `
& { background: #d4d4d4; border-radius: 0; }
.xg-tile {
  justify-content: center;
  padding: 0 4px;
  border-radius: 0;
  background: #fff;
  color: #000;
  font: 12px Calibri, Carlito, 'Segoe UI', sans-serif;
}
.xg-tile.xl-head { align-items: center; background: #f3f3f3; color: #444; }
`;

const PERIODIC_CSS = `
& { background: #fff; }
.xg-group { background: none; }
.xg-group__title { color: #555; font: 600 11px system-ui, sans-serif; }
.xg-tile {
  align-items: center;
  justify-content: center;
  border: 1px solid rgb(0 0 0 / 20%);
  border-radius: 0;
  background: #eee;
  color: #000;
  font: bold 14px 'Helvetica Neue', Arial, sans-serif;
}
.xg-tile.pt-ref { font-size: 10px; font-weight: normal; }
.pt-alkali { background: #ff6666; }
.pt-alkaline { background: #ffdead; }
.pt-transition { background: #ffc0c0; }
.pt-post-transition { background: #cccccc; }
.pt-metalloid { background: #cccc99; }
.pt-nonmetal { background: #a0ffa0; }
.pt-halogen { background: #ffff99; }
.pt-noble { background: #c0ffff; }
.pt-lanthanide { background: #ffbfff; }
.pt-actinide { background: #ff99cc; }
`;

const KEYBOARD_CSS = `
& { background: #2f3136; border-radius: 10px; }
.xg-tile {
  align-items: flex-start;
  padding: 3px 6px;
  border-radius: 4px;
  background: #e9e9e9;
  box-shadow: inset 0 -4px 0 #c4c4c4, 0 1px 0 #111;
  color: #333;
  font: 11px 'Helvetica Neue', Arial, sans-serif;
}
`;

const WIN11_SNAP_CSS = `
& { background: radial-gradient(ellipse at 60% 115%, #7eb0ff, #1a4fc4 45%, #0b1d5a); border-radius: 0; }
.xg-tile {
  padding: 8px 12px;
  border: 1px solid rgb(0 0 0 / 15%);
  border-radius: 8px;
  background: linear-gradient(#f3f3f3 0 32px, #fff 32px);
  box-shadow: 0 8px 24px rgb(0 0 0 / 30%);
  color: #1b1b1b;
  font: 12px 'Segoe UI Variable', 'Segoe UI', system-ui, sans-serif;
}
`;

/**
 * Real-software layouts whose containers run `grid`. Spans are in the
 * product's own cell units; viewports are CSS pixels.
 */
export const PRESETS: Preset[] = [
  styled(
    {
      id: 'win10-start-6',
      source: 'Windows 10 Start menu, two live-tile groups at the default 6-small-tile width',
      stress:
        'mixed 1×1/2×2/4×2/4×4 spans; three wide tiles in a 6-wide group leave 2-column holes nothing can fill',
      description:
        'The Windows 10 Start menu shows app tiles in named groups beside the list of installed apps. Each tile comes in one of four sizes, small, medium, wide or large, picked from its right-click menu, and users drag tiles to rearrange them or to start a new group. By default each group is three medium tiles wide.',
      viewport: { w: 760, h: 560 },
      ...win10Start(6),
    },
    WIN10_CSS,
  ),
  styled(
    {
      id: 'win10-start-8',
      source: 'Windows 10 Start menu with "Show more tiles" on (8-small-tile groups)',
      stress: 'the same tiles reflowed to 8 columns: wide tiles now pair up and the holes close',
      description:
        'The same Windows 10 Start menu with the "Show more tiles" setting on, which widens each group from three medium tiles to four. The same small, medium, wide and large tiles reflow into the wider groups.',
      viewport: { w: 960, h: 560 },
      ...win10Start(8),
    },
    WIN10_CSS,
  ),
  styled(
    {
      id: 'win8-start-screen',
      source:
        'Windows 8.1 Start screen: tiles flow in columns under a fixed row count and scroll sideways',
      stress:
        'fixed `rows` with no column cap, so wide and large tiles must grow the grid sideways',
      description:
        "The Windows 8.1 Start screen fills the whole display with app tiles arranged in columns that run left to right, and the user scrolls sideways to see more. Tiles come in small, medium, wide and large sizes; users drag them to rearrange and resize them from a menu. The number of tile rows is set by the screen's height, so more tiles make the screen longer, never taller.",
      viewport: { w: 1366, h: 768 },
      mechanics: {
        id: 'start8',
        kind: 'group',
        strategy: 'grid',
        config: { rows: 4, gap: 8, padding: 40 },
      },
      data: {
        nodes: titles({ start8: 'Start' }),
        children: {
          start8: [
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
    },
    WIN8_CSS,
  ),
  styled(
    {
      id: 'grafana-node-exporter',
      source: 'Grafana "Node Exporter Full" dashboard (24-column gridPos, 30px row unit)',
      stress:
        'panels at their gridPos x/y with w/h spans in a 24-column grid of 30px rows, full-width row headers, a panel at the right edge, and a w:30 panel wider than the grid',
      description:
        'Grafana dashboards arrange monitoring panels (graphs, gauges, single numbers) on a grid 24 columns wide. "Node Exporter Full" is a widely used community dashboard for a Linux server\'s CPU, memory, disk and network, with its panels grouped under full-width row headers that collapse. Users drag a panel by its title to move it and drag its corner to resize it, and the panels below move down to make room.',
      viewport: { w: 1440, h: 900 },
      mechanics: {
        id: 'dashboard',
        kind: 'group',
        strategy: 'grid',
        // Panels float up into free rows, and a growing one pushes the ones below down.
        config: { cols: 24, gap: 8, padding: 8, cell: { h: 30 }, resizable: true, compact: 'up' },
      },
      data: {
        nodes: titles({ dashboard: 'Node Exporter Full' }),
        children: {
          dashboard: [
            panel('row-quick', 0, 0, 24, 1, 'Quick CPU / Mem / Disk'),
            panel('pressure', 0, 1, 3, 4, 'Pressure'),
            panel('cpu-busy', 3, 1, 3, 4, 'CPU Busy'),
            panel('sys-load', 6, 1, 3, 4, 'Sys Load'),
            panel('ram-used', 9, 1, 3, 4, 'RAM Used'),
            panel('swap-used', 12, 1, 3, 4, 'SWAP Used'),
            panel('root-fs', 15, 1, 3, 4, 'Root FS Used'),
            panel('cpu-cores', 18, 1, 2, 2, 'CPU Cores'),
            panel('uptime', 20, 1, 4, 2, 'Uptime'),
            panel('rootfs-total', 18, 3, 2, 2, 'RootFS Total'),
            panel('ram-total', 20, 3, 2, 2, 'RAM Total'),
            panel('swap-total', 22, 3, 2, 2, 'SWAP Total'),
            panel('row-basic', 0, 5, 24, 1, 'Basic CPU / Mem / Net / Disk'),
            panel('cpu-basic', 0, 6, 12, 7, 'CPU Basic'),
            panel('mem-basic', 12, 6, 12, 7, 'Memory Basic'),
            panel('net-basic', 0, 13, 12, 7, 'Network Traffic Basic'),
            panel('disk-basic', 12, 13, 8, 7, 'Disk Space Used Basic'),
            panel('edge-panel', 20, 13, 4, 7, 'Right-edge panel'),
            panel('imported-w30', 0, 20, 30, 3, 'Imported panel with w: 30'),
          ],
        },
      },
    },
    GRAFANA_CSS,
    { 'row-quick': 'gf-row', 'row-basic': 'gf-row' },
  ),
  styled(
    {
      id: 'android-full-by-cells',
      source:
        'Pixel Launcher (Android 14) 4×5 home screen with At a Glance and a 2×2 weather widget',
      stress:
        'page full by cells (20/20) but only 14 children; a 4×2 widget arriving must be refused by cell count, not item count',
      description:
        'The Pixel Launcher home screen on Android is a grid four columns wide and five rows tall. App icons take one cell each, while widgets span several: here the At a Glance date-and-weather strip across the top row and a 2×2 weather widget. Below the page sits the hotseat, a row of four favorite apps that stays the same on every page. Users long-press an icon or widget to drag it, and add widgets by dragging them in from a widget picker.',
      viewport: { w: 412, h: 915 },
      ...pixelHome([
        at(widget('glance', 4, 1, 'At a Glance'), 0, 0),
        at(widget('weather-2x2', 2, 2, 'Weather'), 0, 1),
        ...placed(icons('app', 12, PIXEL_APPS.slice(4)), 4, [
          '0,0',
          '1,0',
          '2,0',
          '3,0',
          '0,1',
          '1,1',
          '0,2',
          '1,2',
        ]),
      ]),
    },
    PIXEL_CSS,
    {
      glance: 'px-widget',
      'weather-2x2': 'px-widget',
      'widget-weather': 'px-widget',
      picker: 'px-picker',
    },
  ),
  styled(
    {
      id: 'android-full-by-count',
      source: 'Pixel Launcher (Android 14) 4×5 home screen packed with 20 app icons',
      stress: 'page full by count; any arrival, icon or widget, has nowhere to go',
      description:
        'A Pixel Launcher home screen, four columns by five rows, with an app icon in every one of its 20 cells and the four-app hotseat below. Users long-press an icon to drag it around, and dropping one icon on another makes a folder.',
      viewport: { w: 412, h: 915 },
      ...pixelHome(placed(icons('app', 20, PIXEL_APPS), 4)),
    },
    PIXEL_CSS,
    { 'widget-weather': 'px-widget', picker: 'px-picker' },
  ),
  styled(
    {
      id: 'android-fragmented',
      source: 'Pixel Launcher 4×5 home screen with three icons above a 4×2 clock widget',
      stress:
        'nine free cells, but no three contiguous rows: a 3×3 widget fits by count and not by shape',
      description:
        'A Pixel Launcher home screen, four columns by five rows, with three app icons along the top row and a clock widget two rows tall across the full width beneath them. A new widget needs an empty rectangle of cells in its own shape, not just enough empty cells, and widgets can be resized after they are placed.',
      viewport: { w: 412, h: 915 },
      ...pixelHome([
        ...placed(icons('app', 3, PIXEL_APPS), 4),
        at(widget('clock-4x2', 4, 2, 'Clock'), 0, 1),
      ]),
    },
    PIXEL_CSS,
    { 'clock-4x2': 'px-widget', 'widget-weather': 'px-widget', picker: 'px-picker' },
  ),
  styled(
    {
      id: 'ios-dock',
      source: 'iPhone home screen: a 4×6 page above a one-row, four-slot dock holding three apps',
      stress:
        'fixed 60pt icon cells spaced evenly: three docked apps keep their size and spread across the dock, and a fourth is accepted up to accepts.max',
      description:
        'The iPhone home screen shows pages of app icons, four columns by six rows, above the Dock, a single row of up to four apps that stays in place as the user swipes between pages. Users press and hold an icon to start editing, then drag it around the page or into or out of the Dock. With three apps in the Dock, iOS spaces them evenly across its width.',
      viewport: { w: 390, h: 844 },
      mechanics: {
        id: 'springboard',
        strategy: 'strip',
        config: { axis: 'y', fill: true, gap: 8, padding: 8, accepts: false },
        children: [
          {
            id: 'ios-page',
            kind: 'group',
            strategy: 'grid',
            config: {
              cols: 4,
              maxRows: 6,
              gap: 24,
              padding: 8,
              cell: { w: IOS_ICON, h: IOS_ICON + 16 },
              justify: 'evenly',
            },
            item: APP,
          },
          {
            id: 'ios-dock',
            kind: 'group',
            strategy: 'grid',
            config: {
              cols: 4,
              maxRows: 1,
              padding: 8,
              cell: { w: IOS_ICON, h: IOS_ICON },
              justify: 'evenly',
              accepts: { max: 4 },
            },
            placement: { size: { h: 100 } },
            item: APP,
          },
        ],
      },
      data: {
        nodes: titles({ 'ios-page': 'Home Screen', 'ios-dock': 'Dock' }),
        children: {
          'ios-page': icons('ios-app', 8, [
            'Mail',
            'Notes',
            'Maps',
            'Photos',
            'Clock',
            'Weather',
            'Music',
            'Podcasts',
          ]),
          'ios-dock': icons('ios-dock-app', 3, ['Phone', 'Safari', 'Messages']),
        },
      },
    },
    IOS_CSS,
    { 'ios-dock': 'ios-dockbar' },
  ),
  styled(
    {
      id: 'launchpad-full',
      source: 'macOS Launchpad, one 7×5 page holding exactly 35 apps',
      stress:
        'a page full to the cap must place all 35 fixed cells, spread evenly across the screen',
      description:
        'macOS Launchpad shows every installed app as a full-screen grid of icons, seven across and five down, in pages the user swipes between. Users drag an icon to rearrange it, drop it on another to make a folder, or drag it to the edge of the screen to move it to the next page. This page holds exactly 35 apps, so every cell is full.',
      viewport: { w: 1440, h: 900 },
      ...launchpad(35),
    },
    LAUNCHPAD_CSS,
    { 'mac-dock': 'lp-dock' },
  ),
  styled(
    {
      id: 'launchpad-overflow',
      source: 'macOS Launchpad, 40 apps against a fixed 7×5 page',
      stress: 'exactly 35 placed and the other 5 in `unplaced`, the pagination signal',
      description:
        'macOS Launchpad with 40 apps, more than one seven-by-five page holds. Launchpad fills the first page and puts the rest on a second page, shown by the dots at the bottom of the screen.',
      viewport: { w: 1440, h: 900 },
      ...launchpad(40),
    },
    LAUNCHPAD_CSS,
    { 'mac-dock': 'lp-dock' },
  ),
  styled(
    {
      id: 'launchpad-thirty',
      source: 'macOS Launchpad, a fixed 7×5 page holding 30 apps',
      stress: 'five cells free, so an app dragged in from the Dock must be accepted',
      description:
        'A macOS Launchpad page holding 30 apps, so five of its 35 cells are still empty and a newly installed app lands on this page rather than starting a new one. The Dock sits below the page.',
      viewport: { w: 1440, h: 900 },
      ...launchpad(30),
    },
    LAUNCHPAD_CSS,
    { 'mac-dock': 'lp-dock' },
  ),
  styled(
    {
      id: 'excel-frozen-panes',
      source: 'Excel with row 1 and column A frozen, scrolled so only 6 rows fit',
      stress:
        'header cells pinned to their childOrder index; capacity trims data rows, and a pin is an index, not a cell',
      description:
        'An Excel spreadsheet with Freeze Panes set so that row 1 (the column headings) and column A (the row labels) stay on screen while the rest of the sheet scrolls. Users set it from View > Freeze Panes and then scroll as usual; only as many rows as fit in the window are shown.',
      viewport: { w: 720, h: 125 },
      ...frozenSheet(),
    },
    EXCEL_CSS,
  ),
  styled(
    {
      id: 'periodic-table',
      source:
        'IUPAC periodic table: 18 groups, the gap over groups 3–12 in periods 1–3, and the detached f-block',
      stress:
        'every element at an explicit cell with the holes in periods 1–3 left empty, and a second grid aligned to the first by the same cells',
      description:
        'The standard periodic table lays out the 118 chemical elements in 18 columns (groups) and 7 rows (periods), leaving gaps at the top where the first three rows hold fewer elements. The lanthanides and actinides, which belong in rows 6 and 7, are pulled out into two separate rows beneath the main table so that it does not become 32 columns wide.',
      viewport: { w: 1080, h: 600 },
      ...periodicTable(),
    },
    PERIODIC_CSS,
  ),
  styled(
    {
      id: 'keyboard-ansi-60',
      source:
        'ANSI 60% keyboard (1.25u/1.5u/1.75u/2.25u/2.75u/6.25u keys) at quarter-unit resolution',
      stress:
        'fractional key widths as integer spans of a 60-column grid; every row must sum to exactly 15u',
      description:
        'A 60% keyboard is a compact US (ANSI) layout with no function row, arrow keys or number pad: five rows of keys, each row 15 standard key widths long. Most keys are one unit (1u) wide, while Tab, Caps Lock, Shift, Enter, Backspace, the bottom-row modifiers and the space bar are wider, in quarter-unit steps such as 1.25u, 1.5u, 2.25u and 6.25u.',
      viewport: { w: 900, h: 300 },
      ...keyboard('keyboard', 60, 1, 'ANSI 60%'),
    },
    KEYBOARD_CSS,
  ),
  styled(
    {
      id: 'keyboard-ansi-60-units',
      source:
        'ANSI 60% keyboard written with keycap `u` sizes as spans (Tab 1.5, Enter 2.25, Space 6.25)',
      stress:
        'fractional spans: grid floors them to whole cells, so the rows no longer sum to 15 and keys wrap onto the wrong row',
      description:
        "The same 60% ANSI keyboard, with each key's width written as its keycap size in key units, 1.5 for Tab, 2.25 for Enter and 6.25 for the space bar, the way keycap sizes are usually quoted.",
      viewport: { w: 900, h: 300 },
      ...keyboard('keyboard-u', 15, 4, 'ANSI 60%, u spans'),
    },
    KEYBOARD_CSS,
  ),
  styled(
    {
      id: 'win11-snap-left-tall',
      source: 'Windows 11 Snap Layouts, "one tall left, two stacked right"',
      stress: 'a 1×2 span in a 2×2 capped grid; a fourth window must be refused',
      description:
        "Windows 11 Snap Layouts appear when the user hovers over a window's maximize button and offer a few ways to divide the screen; this one puts one tall window on the left and two stacked on the right. Clicking a zone snaps the current window into it, and Windows then offers the other open windows to fill the remaining zones. The layout has exactly three places for windows.",
      viewport: { w: 1280, h: 720 },
      mechanics: {
        id: 'snap',
        kind: 'group',
        strategy: 'grid',
        config: { maxCols: 2, maxRows: 2 },
        children: [span('snap-left', 1, 2), span('snap-tr', 1, 1), span('snap-br', 1, 1)],
      },
      data: {
        nodes: titles({
          snap: 'Snap layout',
          'snap-left': 'Edge',
          'snap-tr': 'Terminal',
          'snap-br': 'Explorer',
        }),
      },
    },
    WIN11_SNAP_CSS,
  ),
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
