import { desktopStrategy } from '../../layout/desktop.js';
import { floatingStrategy } from '../../layout/floating.js';
import { gridStrategy } from '../../layout/grid.js';
import { shelfStrategy } from '../../layout/shelf.js';
import { stackStrategy } from '../../layout/stack.js';
import { stripStrategy } from '../../layout/strip.js';
import type { LayoutItem, LayoutStrategy } from '../../layout-types.js';
import type { Scenario } from './invariants.js';
import type { Preset, PresetNode } from './preset.js';

/** Every `strategy` id the presets below name, for a store host or a test. */
export const OVERLAP_STRATEGIES: Record<string, LayoutStrategy<unknown, string, unknown>> = {
  desktop: desktopStrategy() as never,
  'desktop-shelf': desktopStrategy(shelfStrategy) as never,
  'desktop-grid': desktopStrategy(gridStrategy) as never,
  floating: floatingStrategy() as never,
  'floating-grid': floatingStrategy(gridStrategy) as never,
  'floating-strip': floatingStrategy(stripStrategy) as never,
  stack: stackStrategy as never,
  strip: stripStrategy as never,
};

const win = (
  id: string,
  title: string,
  w: number,
  h: number,
  placement: Record<string, unknown> = {},
): PresetNode => ({
  id,
  kind: 'window',
  hints: { preferredSize: { w, h } },
  placement,
  meta: { title },
});

const icon = (id: string, title: string, w = 64, h = 64): PresetNode => ({
  id,
  kind: 'icon',
  hints: { preferredSize: { w, h } },
  placement: { icon: true },
  meta: { title },
});

const palette = (
  id: string,
  title: string,
  w: number,
  h: number,
  placement: Record<string, unknown> = {},
): PresetNode => ({
  id,
  kind: 'palette',
  hints: { preferredSize: { w, h } },
  placement: { floating: true, ...placement },
  meta: { title },
});

const tab = (id: string, title: string): PresetNode => ({ id, kind: 'tab', meta: { title } });

export const MACOS9_WINDOWSHADE: Preset = {
  id: 'macos9-windowshade',
  source: 'Mac OS 9.2 Platinum desktop with WindowShade',
  stress: 'shaded windows keep x, y and w and drop to a title bar; a palette shorter than the bar',
  viewport: { w: 640, h: 480 },
  root: {
    id: 'mac-desktop',
    kind: 'zone',
    strategy: 'desktop-shelf',
    config: { minimize: 'shade', shadeHeight: 20, gap: 12, padding: 12 },
    children: [
      icon('mac-hd', 'Macintosh HD'),
      icon('mac-trash', 'Trash'),
      win('mac-finder', 'Macintosh HD', 360, 240, { x: 40, y: 40 }),
      win('mac-simpletext', 'Read Me — SimpleText', 300, 260, { x: 180, y: 110, minimized: true }),
      win('mac-calculator', 'Calculator', 120, 150, { x: 480, y: 60 }),
      // The Application Switcher tear-off is a 16px strip, under the 20px bar.
      win('mac-app-switcher', 'Application Switcher', 180, 16, {
        x: 420,
        y: 440,
        minimized: true,
      }),
      win('mac-notepad', 'Note Pad', 220, 200, { x: 100, y: 200 }),
    ],
  },
};

const WIN31_MINIMIZED = [
  'Clock',
  'Calculator',
  'Cardfile',
  'Calendar',
  'Notepad',
  'Write',
  'Paintbrush',
  'Terminal',
  'Recorder',
  'Character Map',
  'Media Player',
  'Sound Recorder',
  'Solitaire',
  'Minesweeper',
  'Reversi',
];

export const WIN31_ICONS: Preset = {
  id: 'win31-minimized-icons',
  source: 'Windows 3.1 Program Manager with a row of minimized application icons',
  stress: 'icon layer fills past one row, and minimized windows join it after the real icons',
  viewport: { w: 640, h: 480 },
  root: {
    id: 'win31-desktop',
    kind: 'zone',
    strategy: 'desktop-shelf',
    config: { minimize: 'icon', iconWidth: 72, iconHeight: 56, gap: 4, padding: 4 },
    children: [
      icon('win31-recycle', 'Main', 72, 56),
      win('win31-progman', 'Program Manager', 460, 320, { x: 20, y: 140 }),
      win('win31-filemgr', 'File Manager', 420, 300, { x: 140, y: 170 }),
      ...WIN31_MINIMIZED.map((title, i) =>
        win(`win31-app-${i + 1}`, title, 300, 200, {
          x: 60 + i * 8,
          y: 60 + i * 8,
          minimized: true,
        }),
      ),
    ],
  },
};

export const GIMP_MULTIWINDOW: Preset = {
  id: 'gimp-2.8-multi-window',
  source: 'GIMP 2.8 multi-window mode: image windows under the Toolbox and dock utility windows',
  stress: 'two window classes — utility windows must stay above every image window',
  viewport: { w: 800, h: 600 },
  root: {
    id: 'gimp-desktop',
    kind: 'zone',
    strategy: 'desktop',
    config: {},
    children: [
      win('gimp-img-1', 'wilber.xcf', 440, 340, { x: 170, y: 30 }),
      win('gimp-img-2', 'photo.jpg', 480, 380, { x: 220, y: 90 }),
      win('gimp-img-3', 'untitled-1', 360, 300, { x: 280, y: 180 }),
      win('gimp-toolbox', 'Toolbox', 150, 520, { x: 8, y: 20 }),
      win('gimp-layers', 'Layers, Channels, Paths', 190, 520, { x: 600, y: 20 }),
    ],
  },
};

export const AMIGA_SCREENS: Preset = {
  id: 'amiga-workbench-screens',
  source: 'AmigaOS 3.1: Workbench and two application screens, front screens dragged down',
  stress: 'full-width screens stacked in z, each pulled down to reveal the one behind',
  viewport: { w: 640, h: 256 },
  root: {
    id: 'amiga-display',
    kind: 'zone',
    strategy: 'desktop',
    config: {},
    children: [
      win('amiga-workbench', 'Workbench Screen', 640, 256, { x: 0, y: 0 }),
      win('amiga-dpaint', 'Deluxe Paint IV', 640, 256, { x: 0, y: 70 }),
      win('amiga-term', 'NComm', 640, 256, { x: 0, y: 180 }),
    ],
  },
};

export const FIGMA_CANVAS: Preset = {
  id: 'figma-canvas',
  source: 'Figma / Miro infinite canvas: frames scattered around the origin',
  stress: 'negative coordinates and frames thousands of pixels outside the viewport',
  viewport: { w: 1440, h: 900 },
  root: {
    id: 'figma-canvas',
    kind: 'zone',
    strategy: 'desktop',
    config: {},
    children: [
      win('figma-cover', 'Cover', 1440, 960, { x: -4200, y: -2600 }),
      win('figma-flows', 'User flows', 3200, 1800, { x: -1600, y: -400 }),
      win('figma-mobile', 'iPhone 15 — Home', 393, 852, { x: 120, y: 40 }),
      win('figma-desktop', 'Desktop — Home', 1440, 1024, { x: 640, y: 40 }),
      win('figma-archive', 'Archive', 2400, 1600, { x: 18000, y: 12000 }),
    ],
  },
};

export const UNPLUGGED_MONITOR: Preset = {
  id: 'unplugged-second-monitor',
  source: 'macOS laptop after its external displays unplug: windows saved on the lost screens',
  stress: 'saved positions entirely outside the container, left and right of it',
  viewport: { w: 1280, h: 800 },
  root: {
    id: 'laptop-display',
    kind: 'zone',
    strategy: 'desktop',
    config: {},
    children: [
      win('mon-mail', 'Mail', 900, 600, { x: 120, y: 80 }),
      win('mon-slack', 'Slack', 1000, 700, { x: 1920, y: 60 }),
      win('mon-xcode', 'Xcode', 1600, 1000, { x: -1800, y: 40 }),
      win('mon-terminal', 'Terminal', 700, 440, { x: 1100, y: 500 }),
    ],
  },
};

export const CASCADE_200: Preset = {
  id: 'cascade-200-windows',
  source: 'Windows XP Explorer after 200 "New Window" commands, each cascaded',
  stress: 'the cascade walks off the container; overflow must say how far',
  viewport: { w: 1024, h: 768 },
  root: {
    id: 'cascade-desktop',
    kind: 'zone',
    strategy: 'desktop',
    config: { cascade: 24 },
    children: Array.from({ length: 200 }, (_, i) =>
      win(`cascade-${i + 1}`, `My Computer (${i + 1})`, 480, 360),
    ),
  },
};

export const CHROME_150_TABS: Preset = {
  id: 'chrome-150-tabs',
  source: 'Chrome with 150 tabs in one window, the last tab active',
  stress: 'a long stack, active tab last; closing it falls back rather than leaving nothing',
  viewport: { w: 1024, h: 640 },
  root: {
    id: 'chrome-window',
    kind: 'tabs',
    strategy: 'stack',
    config: { headerSize: 34, activeId: 'chrome-tab-150' },
    children: Array.from({ length: 150 }, (_, i) => tab(`chrome-tab-${i + 1}`, `Tab ${i + 1}`)),
  },
};

export const PHOTOSHOP_PANELS: Preset = {
  id: 'photoshop-panel-dock',
  source: 'Photoshop 2024: tabbed panel groups docked right of the canvas, one torn out floating',
  stress: 'stacks nested in a strip, and a tab leaving its stack to float over the workspace',
  viewport: { w: 800, h: 520 },
  root: {
    id: 'ps-workspace',
    kind: 'zone',
    strategy: 'floating-strip',
    config: { axis: 'x', fill: true, handleSize: 22, defaultAnchor: 'top-left' },
    children: [
      { id: 'ps-canvas', kind: 'canvas', meta: { title: 'Untitled-1 @ 66.7%' } },
      {
        id: 'ps-dock',
        kind: 'dock',
        strategy: 'strip',
        config: { axis: 'y', fill: true, gap: 2 },
        placement: { size: { w: 280 } },
        children: [
          {
            id: 'ps-group-layers',
            kind: 'tabs',
            strategy: 'stack',
            config: { headerSize: 26, activeId: 'ps-layers' },
            children: [
              tab('ps-layers', 'Layers'),
              tab('ps-channels', 'Channels'),
              tab('ps-paths', 'Paths'),
            ],
          },
          {
            id: 'ps-group-props',
            kind: 'tabs',
            strategy: 'stack',
            config: { headerSize: 26, activeId: 'ps-properties' },
            children: [tab('ps-properties', 'Properties'), tab('ps-adjustments', 'Adjustments')],
          },
        ],
      },
      palette('ps-color', 'Color', 240, 180),
    ],
  },
};

export const FANCYZONES: Preset = {
  id: 'fancyzones-priority-grid',
  source: 'Windows 11 Snap Layouts / PowerToys FancyZones "priority grid"',
  stress: 'snap targets are the tiled zones, not only the container; windows float over them',
  viewport: { w: 960, h: 560 },
  root: {
    id: 'fz-desktop',
    kind: 'zone',
    strategy: 'floating-grid',
    config: { cols: 3, gap: 8, padding: 8, snapToPanes: true, snapThreshold: 24, handleSize: 24 },
    children: [
      { id: 'fz-zone-left', kind: 'snap-zone', meta: { title: 'Left' } },
      { id: 'fz-zone-center', kind: 'snap-zone', meta: { title: 'Center' } },
      { id: 'fz-zone-right', kind: 'snap-zone', meta: { title: 'Right' } },
      palette('fz-edge', 'Edge', 300, 220),
      palette('fz-code', 'VS Code', 280, 200, { snapCorners: ['top-left', 'top-right'] }),
    ],
  },
};

export const TWM_ICON_MANAGER: Preset = {
  id: 'twm-icon-manager',
  source: 'X11 twm with an icon manager: iconified xterms listed as one-line entries',
  stress: 'icon size far from the window size; a dozen iconified xterms in the icon box',
  viewport: { w: 1024, h: 768 },
  root: {
    id: 'twm-root',
    kind: 'zone',
    strategy: 'desktop-shelf',
    config: { minimize: 'icon', iconWidth: 160, iconHeight: 20, gap: 0, padding: 0 },
    children: [
      win('twm-xclock', 'xclock', 164, 164, { x: 850, y: 10 }),
      win('twm-xload', 'xload', 164, 100, { x: 850, y: 190 }),
      ...Array.from({ length: 12 }, (_, i) =>
        win(`twm-xterm-${i + 1}`, `xterm ${i + 1}`, 484, 316, {
          x: 40 + i * 30,
          y: 40 + i * 20,
          minimized: i % 3 !== 0,
        }),
      ),
    ],
  },
};

/** Every real-software layout in this file, in picker order. */
export const PRESETS: Preset[] = [
  MACOS9_WINDOWSHADE,
  WIN31_ICONS,
  GIMP_MULTIWINDOW,
  AMIGA_SCREENS,
  FIGMA_CANVAS,
  UNPLUGGED_MONITOR,
  CASCADE_200,
  CHROME_150_TABS,
  PHOTOSHOP_PANELS,
  FANCYZONES,
  TWM_ICON_MANAGER,
];

const sized = (
  id: string,
  w: number,
  h: number,
  meta: Record<string, unknown> = {},
): LayoutItem => ({
  id,
  meta,
  hints: { preferredSize: { w, h } },
});

/** Pathology no product ships on purpose: degenerate sizes, positions and containers. */
export const DESKTOP_PATHOLOGY: Scenario[] = [
  {
    id: 'desktop-zero-size',
    source: 'X11 client mapping a 0×0 override-redirect window (xdotool, some tray icons)',
    stress: 'zero and negative extents must be unplaced, not rendered as nothing',
    container: { w: 800, h: 600 },
    items: [
      sized('zero', 0, 0, { x: 10, y: 10 }),
      sized('flat', 200, 0, { x: 10, y: 10 }),
      sized('negative', -40, 100, { x: 10, y: 10 }),
      sized('ok', 200, 100, { x: 10, y: 10 }),
    ],
    options: {},
  },
  {
    id: 'desktop-container-0x0',
    source: 'A desktop zone rendered inside a collapsed <details> or display:none parent',
    stress: '0×0 container: windows still placed, overflow is every window',
    container: { w: 0, h: 0 },
    items: [sized('a', 300, 200, { x: 0, y: 0 }), sized('b', 300, 200)],
    options: {},
  },
  {
    id: 'desktop-nan-position',
    source: 'A drag handler dividing by a zero zoom factor writes NaN into x/y',
    stress: 'a non-finite position is not a position; the window should cascade',
    container: { w: 800, h: 600 },
    items: [
      sized('nan', 200, 100, { x: Number.NaN, y: 40 }),
      sized('inf', 200, 100, { x: 40, y: Number.POSITIVE_INFINITY }),
      sized('ok', 200, 100, { x: 300, y: 300 }),
    ],
    options: {},
  },
];

export const FLOATING_PATHOLOGY: Scenario[] = [
  {
    id: 'floating-unmeasured',
    source: 'A floating palette whose content has not been measured yet',
    stress: '0×0 and negative sizes are withheld; NaN from a failed measurement too',
    container: { w: 800, h: 600 },
    items: [
      { id: 'zero', meta: { floating: true }, natural: { w: 0, h: 0 } },
      { id: 'negative', meta: { floating: true }, natural: { w: -10, h: 50 } },
      { id: 'nan', meta: { floating: true }, natural: { w: Number.NaN, h: 120 } },
      { id: 'ok', meta: { floating: true }, natural: { w: 200, h: 120 } },
    ],
    options: {},
  },
  {
    id: 'floating-container-0x0',
    source: 'A floating layer mounted before its host has laid out',
    stress: '0×0 container with every corner anchor',
    container: { w: 0, h: 0 },
    items: [{ id: 'p', meta: { floating: true }, natural: { w: 120, h: 80 } }],
    options: {},
  },
];

export const STACK_PATHOLOGY: Scenario[] = [
  {
    id: 'stack-header-taller-than-container',
    source: 'Chrome shrunk to its minimum height, below the tab strip',
    stress: 'headerSize larger than the container height',
    container: { w: 500, h: 30 },
    items: [{ id: 'a' }, { id: 'b' }],
    options: { headerSize: 40, activeId: 'b' },
  },
  {
    id: 'stack-container-0x0',
    source: 'A background browser window restored from a minimized 0×0 frame',
    stress: '0×0 container with header and padding',
    container: { w: 0, h: 0 },
    items: [{ id: 'a' }],
    options: { headerSize: 34, padding: 8 },
  },
];
