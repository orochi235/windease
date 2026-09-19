import { desktopStrategy } from '../layout/desktop.js';
import { floatingStrategy } from '../layout/floating.js';
import { gridStrategy } from '../layout/grid.js';
import { shelfStrategy } from '../layout/shelf.js';
import { stackStrategy } from '../layout/stack.js';
import { stripStrategy } from '../layout/strip.js';
import type { LayoutItem, LayoutStrategy } from '../layout-types.js';
import type { Scenario } from './invariants.js';
import { type Preset, type PresetNode, titles } from './preset.js';

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

/** A window as content: its title, size and where the user left it. The desktop's `item` makes it a window. */
const win = (
  id: string,
  title: string,
  w: number,
  h: number,
  placement: Record<string, unknown> = {},
): PresetNode => ({
  id,
  hints: { preferredSize: { w, h } },
  placement,
  meta: { title },
});

/** What every window on a desktop gets: the chrome that draws a title bar. */
const WINDOW_ITEM: NonNullable<PresetNode['item']> = { kind: 'window' };

/** Title-bar height, matching the bar the stories draw. */
const BAR = 20;

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

/** A window the product itself opens, above every content window; its title is data. */
const utility = (id: string, w: number, h: number, at: { x: number; y: number }): PresetNode => ({
  id,
  kind: 'window',
  hints: { preferredSize: { w, h } },
  placement: { ...at, layer: 'top' },
});

const tab = (id: string, title: string): PresetNode => ({ id, kind: 'tab', meta: { title } });

/** A tab of the product's own panels, whose title is data. */
const panelTab = (id: string): PresetNode => ({ id, kind: 'tab' });

const MACOS9_CSS = `
.xd-root { background: #6666a8; }
.xd-window {
  border: 1px solid #000;
  background: #ddd;
  box-shadow: 1px 1px 0 #333;
  font: bold 12px Charcoal, Chicago, Geneva, 'Helvetica Neue', sans-serif;
  color: #000;
}
.xd-window__bar {
  background:
    repeating-linear-gradient(#fff 0 1px, #999 1px 2px) 6px 4px / calc(100% - 32px) 11px no-repeat,
    #ddd;
  border-bottom: 1px solid #888;
}
.xd-window__title { margin-inline: auto; padding: 0 6px; background: #ddd; }
.xd-window__glyph { background: #ddd; }
.xd-window__body { margin: 0 5px 5px; background: #fff; border: 1px solid #777; font-weight: normal; }
.xd-icon {
  flex-direction: column;
  align-items: center;
  background: none;
  font: 11px Geneva, 'Helvetica Neue', sans-serif;
  text-shadow: 0 0 3px #fff, 0 0 3px #fff;
}
.xd-icon::before {
  content: '';
  width: 34px;
  height: 24px;
  margin-bottom: 4px;
  border: 1px solid #000;
  border-radius: 2px;
  background: linear-gradient(#f4f4f4, #aaa);
}
`;

export const MACOS9_WINDOWSHADE: Preset = {
  id: 'macos9-windowshade',
  source: 'Mac OS 9.2 Platinum desktop with WindowShade',
  stress: 'shaded windows keep x, y and w and drop to a title bar; a palette shorter than the bar',
  description:
    'The Mac OS 9 desktop shows disk and Trash icons down the right side and overlapping windows, which the user drags by the title bar and resizes from the bottom-right corner. WindowShade, a double-click on the title bar or a click on its collapse box, rolls a window up so only its title bar stays where it was, and doing it again rolls it back down. Small floating palettes, such as the Application Switcher torn off the application menu, sit over the windows.',
  viewport: { w: 640, h: 480 },
  mechanics: {
    id: 'mac-desktop',
    kind: 'zone',
    strategy: 'desktop-grid',
    config: {
      minimize: 'shade',
      shadeHeight: BAR,
      // The disks and Trash, one column down the right edge.
      cols: 1,
      cell: { w: 64, h: 64 },
      gap: 12,
      padding: 12,
      iconFrom: 'top-right',
      drag: true,
      handleSize: BAR,
      raise: 'click',
      minimizable: true,
      resize: true,
      // Mac OS 9 resizes only from the grow box; thin edges keep the other seven out of the way.
      edgeSize: 4,
    },
    item: WINDOW_ITEM,
  },
  data: {
    css: MACOS9_CSS,
    children: {
      'mac-desktop': [
        icon('mac-hd', 'Macintosh HD'),
        icon('mac-trash', 'Trash'),
        win('mac-finder', 'Macintosh HD', 360, 240, { x: 40, y: 40 }),
        win('mac-simpletext', 'Read Me — SimpleText', 300, 260, {
          x: 180,
          y: 110,
          minimized: true,
        }),
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

const WIN31_CSS = `
.xd-root { background: #c0c0c0; }
.xd-window {
  border: 1px solid #000;
  box-shadow: 0 0 0 3px #c0c0c0, 0 0 0 4px #000;
  background: #fff;
  font: bold 12px 'MS Sans Serif', 'Microsoft Sans Serif', Arial, sans-serif;
  color: #000;
}
.xd-window__bar { background: #000080; color: #fff; border-bottom: 1px solid #000; }
.xd-window__title { margin-inline: auto; }
.xd-window__glyph {
  align-self: stretch;
  display: grid;
  place-items: center;
  background: #c0c0c0;
  color: #000;
  border-left: 1px solid #000;
  box-shadow: inset -2px -2px #808080, inset 1px 1px #fff;
}
.xd-window__body { font-weight: normal; color: #000; }
.xd-icon, .xd-icon--window {
  flex-direction: column;
  align-items: center;
  border: 0;
  background: none;
  font: 11px 'MS Sans Serif', 'Microsoft Sans Serif', Arial, sans-serif;
  color: #000;
}
.xd-icon::before {
  content: '';
  width: 30px;
  height: 24px;
  margin-bottom: 3px;
  border: 1px solid #000;
  background: linear-gradient(#000080 0 6px, #fff 6px);
}
`;

export const WIN31_ICONS: Preset = {
  id: 'win31-minimized-icons',
  source: 'Windows 3.1 Program Manager with a row of minimized application icons',
  stress: 'icon layer fills past one row, and minimized windows join it after the real icons',
  description:
    'Windows 3.1 runs programs in overlapping windows over the Program Manager, whose program groups hold the icons that start them. Minimizing a window turns it into a labeled icon along the bottom of the screen, and further icons line up beside it. Double-clicking an icon restores the window where it was.',
  viewport: { w: 640, h: 480 },
  mechanics: {
    id: 'win31-desktop',
    kind: 'zone',
    strategy: 'desktop-shelf',
    config: {
      minimize: 'icon',
      iconWidth: 72,
      iconHeight: 56,
      gap: 4,
      padding: 4,
      iconFrom: 'bottom-left',
      drag: true,
      handleSize: BAR,
      raise: 'click',
      minimizable: true,
      resize: true,
      edgeSize: 4,
    },
    item: WINDOW_ITEM,
  },
  data: {
    css: WIN31_CSS,
    children: {
      'win31-desktop': [
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
  },
};

const GIMP_CSS = `
.xd-root { background: #2e3436; }
.xd-window {
  border: 1px solid #1c1c1a;
  border-radius: 5px 5px 0 0;
  background: #edeceb;
  font: 12px Ubuntu, Cantarell, 'DejaVu Sans', sans-serif;
  color: #3c3c3c;
}
.xd-window__bar {
  background: linear-gradient(#57564f, #3c3b37);
  color: #dfdbd2;
  font-weight: bold;
  border-bottom: 1px solid #1c1c1a;
}
.gimp-image .xd-window__body {
  margin: 4px;
  background: repeating-conic-gradient(#999 0 25%, #666 0 50%) 0 0 / 16px 16px;
  color: #eee;
}
.gimp-toolbox .xd-window__body {
  background:
    repeating-linear-gradient(90deg, #0000 0 26px, #c4c2bf 26px 28px),
    repeating-linear-gradient(#0000 0 26px, #c4c2bf 26px 28px),
    #edeceb;
}
`;

export const GIMP_MULTIWINDOW: Preset = {
  id: 'gimp-2.8-multi-window',
  source: 'GIMP 2.8 multi-window mode: image windows under the Toolbox and dock utility windows',
  stress: 'two window classes — utility windows must stay above every image window',
  description:
    'GIMP 2.8 in multi-window mode, its default, opens every image in its own window and keeps the Toolbox and the docked dialogs, such as Layers, Channels and Paths, in separate utility windows. GIMP asks the window manager to keep those utility windows above the image windows, so clicking an image brings it forward but not over the Toolbox.',
  viewport: { w: 800, h: 600 },
  mechanics: {
    id: 'gimp-desktop',
    kind: 'zone',
    strategy: 'desktop',
    config: { drag: true, handleSize: BAR, raise: 'click', resize: true },
    item: WINDOW_ITEM,
    // GIMP's own utility windows, which it asks the window manager to keep above the images.
    children: [
      utility('gimp-toolbox', 150, 520, { x: 8, y: 20 }),
      utility('gimp-layers', 190, 520, { x: 600, y: 20 }),
    ],
  },
  data: {
    css: GIMP_CSS,
    nodes: {
      'gimp-layers': { meta: { title: 'Layers, Channels, Paths' } },
      'gimp-img-1': { className: 'gimp-image' },
      'gimp-img-2': { className: 'gimp-image' },
      'gimp-img-3': { className: 'gimp-image' },
      'gimp-toolbox': { meta: { title: 'Toolbox' }, className: 'gimp-toolbox' },
    },
    children: {
      'gimp-desktop': [
        win('gimp-img-1', 'wilber.xcf', 440, 340, { x: 170, y: 30 }),
        win('gimp-img-2', 'photo.jpg', 480, 380, { x: 220, y: 90 }),
        win('gimp-img-3', 'untitled-1', 360, 300, { x: 280, y: 180 }),
      ],
    },
  },
};

const AMIGA_CSS = `
.xd-root { background: #000; }
.xd-window {
  border: 0;
  box-shadow: 0 -2px 0 #000;
  font: 12px Topaz, 'Topaz New', 'Courier New', monospace;
}
.xd-window__bar { border-bottom: 0; font-weight: bold; }
.xd-window__body { color: inherit; }
.xd-window__bar::after { content: '▭▣'; padding-right: 4px; letter-spacing: 2px; }
.amiga-wb { background: #0055aa; color: #fff; }
.amiga-wb .xd-window__bar { background: #fff; color: #0055aa; }
.amiga-wb .xd-window__body { color: #ff8800; }
.amiga-dpaint { background: #000; color: #fff; }
.amiga-dpaint .xd-window__bar { background: #aaa; color: #000; }
.amiga-dpaint .xd-window__body { box-shadow: inset 0 -28px #555; }
.amiga-term { background: #222; color: #fff; }
.amiga-term .xd-window__bar { background: #888; color: #fff; }
`;

export const AMIGA_SCREENS: Preset = {
  id: 'amiga-workbench-screens',
  source: 'AmigaOS 3.1: Workbench and two application screens, front screens dragged down',
  stress: 'full-width screens stacked in z, each pulled down to reveal the one behind',
  description:
    "AmigaOS gives each full-screen program its own screen, a whole display with its own resolution and colors, and stacks the screens one in front of another. Dragging a screen's title bar downward slides the whole screen down to reveal the ones behind it; whatever of it passes the bottom of the display is not shown, and no screen goes above the top. A button at the right of the title bar sends a screen to the back or brings it to the front.",
  viewport: { w: 640, h: 256 },
  mechanics: {
    id: 'amiga-display',
    kind: 'zone',
    strategy: 'desktop',
    // A screen slides only up and down, never above the display's top, and what hangs below is not shown.
    config: { drag: 'y', handleSize: BAR, clamp: 'bar', overflow: 'clip' },
    item: WINDOW_ITEM,
  },
  data: {
    css: AMIGA_CSS,
    nodes: {
      'amiga-workbench': { className: 'amiga-wb' },
      'amiga-dpaint': { className: 'amiga-dpaint' },
      'amiga-term': { className: 'amiga-term' },
    },
    children: {
      'amiga-display': [
        win('amiga-workbench', 'Workbench Screen', 640, 256, { x: 0, y: 0 }),
        win('amiga-dpaint', 'Deluxe Paint IV', 640, 256, { x: 0, y: 70 }),
        win('amiga-term', 'NComm', 640, 256, { x: 0, y: 180 }),
      ],
    },
  },
};

const FIGMA_CSS = `
.xd-root { background: #e5e5e5; }
.xd-window {
  border: 0;
  background: none;
  box-shadow: none;
  font: 11px Inter, system-ui, sans-serif;
  color: #8c8c8c;
}
.xd-window__bar { background: none; border-bottom: 0; padding: 0; align-items: flex-end; }
.xd-window__body { background: #fff; color: #c4c4c4; box-shadow: 0 0 0 1px rgb(0 0 0 / 8%); }
`;

export const FIGMA_CANVAS: Preset = {
  id: 'figma-canvas',
  source: 'Figma / Miro infinite canvas: frames scattered around the origin',
  stress: 'negative coordinates and frames thousands of pixels outside the viewport',
  description:
    'Figma and Miro present an infinite canvas: frames (screens, diagrams, boards) sit anywhere around a starting point, including far above and to the left of it. Users pan and zoom across the canvas and drag frames anywhere, so most of a file lies well outside what is on screen at any moment.',
  viewport: { w: 1440, h: 900 },
  mechanics: {
    id: 'figma-canvas',
    kind: 'zone',
    strategy: 'desktop',
    // No raise: selecting a frame leaves its place in the layer order.
    config: { drag: true, handleSize: BAR, overflow: 'scroll' },
    item: WINDOW_ITEM,
  },
  data: {
    css: FIGMA_CSS,
    children: {
      'figma-canvas': [
        win('figma-cover', 'Cover', 1440, 960, { x: -4200, y: -2600 }),
        win('figma-flows', 'User flows', 3200, 1800, { x: -1600, y: -400 }),
        win('figma-mobile', 'iPhone 15 — Home', 393, 852, { x: 120, y: 40 }),
        win('figma-desktop', 'Desktop — Home', 1440, 1024, { x: 640, y: 40 }),
        win('figma-archive', 'Archive', 2400, 1600, { x: 18000, y: 12000 }),
      ],
    },
  },
};

const MACOS_CSS = `
.xd-root { background: linear-gradient(160deg, #3c6ed6, #8e5bd0 55%, #e9869a); }
.xd-window {
  border: 1px solid rgb(0 0 0 / 25%);
  border-radius: 10px;
  background: #fff;
  box-shadow: 0 12px 32px rgb(0 0 0 / 35%);
  font: 13px -apple-system, 'SF Pro Text', 'Helvetica Neue', sans-serif;
  color: #222;
}
.xd-window__bar { background: #ececec; border-bottom: 1px solid #d0d0d0; font-weight: 600; }
.xd-window__bar::before,
.xd-window__bar::after { content: ''; flex: none; width: 52px; height: 12px; }
.xd-window__bar::before {
  background:
    radial-gradient(circle at 6px 6px, #ff5f57 5px, #0000 5.5px),
    radial-gradient(circle at 26px 6px, #febc2e 5px, #0000 5.5px),
    radial-gradient(circle at 46px 6px, #28c840 5px, #0000 5.5px);
}
.xd-window__body { color: #999; }
`;

export const UNPLUGGED_MONITOR: Preset = {
  id: 'unplugged-second-monitor',
  source: 'macOS laptop after its external displays unplug: windows saved on the lost screens',
  stress: 'saved positions entirely outside the container, left and right of it',
  description:
    "A MacBook that was used with external monitors, now unplugged, running apps that remember where their windows last were. Windows saved on the missing screens have positions far to the left or right of the laptop's own display. The apps keep those saved positions, and macOS pulls each window back onto the laptop's screen, where it fits, so none is left where the user cannot reach it.",
  viewport: { w: 1280, h: 800 },
  mechanics: {
    id: 'laptop-display',
    kind: 'zone',
    strategy: 'desktop',
    config: { drag: true, handleSize: BAR, raise: 'click', clamp: 'all', resize: true },
    item: WINDOW_ITEM,
  },
  data: {
    css: MACOS_CSS,
    children: {
      'laptop-display': [
        win('mon-mail', 'Mail', 900, 600, { x: 120, y: 80 }),
        win('mon-slack', 'Slack', 1000, 700, { x: 1920, y: 60 }),
        win('mon-xcode', 'Xcode', 1600, 1000, { x: -1800, y: 40 }),
        win('mon-terminal', 'Terminal', 700, 440, { x: 1100, y: 500 }),
      ],
    },
  },
};

const XP_CSS = `
.xd-root { background: linear-gradient(#2d6fd6, #a9cdf5 58%, #6aa843 58.5%, #2f6e1b); }
.xd-window {
  border: 3px solid #0831d9;
  border-top: 0;
  border-radius: 7px 7px 0 0;
  background: #ece9d8;
  font: 11px Tahoma, Verdana, sans-serif;
  color: #000;
}
.xd-window__bar {
  background: linear-gradient(#3d95ff, #0058ee 20%, #0053e7 75%, #0a47c9);
  color: #fff;
  font: bold 12px 'Trebuchet MS', Tahoma, sans-serif;
  text-shadow: 1px 1px #0f1089;
  border-bottom: 0;
}
.xd-window__body {
  background: linear-gradient(90deg, #7a96df 0 90px, #fff 90px);
  color: #444;
  padding-left: 98px;
}
`;

export const CASCADE_200: Preset = {
  id: 'cascade-200-windows',
  source: 'Windows XP Explorer after 200 "New Window" commands, each cascaded',
  stress: 'the cascade runs off the container 200 times over and must wrap back to the top left',
  description:
    'Windows XP places each new window a little below and to the right of the previous one, a cascade that keeps every title bar visible, and starts again at the top left once the next window would run off the screen. Choosing New Window from an Explorer window 200 times asks for far more steps than fit on a 1024×768 screen.',
  viewport: { w: 1024, h: 768 },
  mechanics: {
    id: 'cascade-desktop',
    kind: 'zone',
    strategy: 'desktop',
    config: { cascade: 24, wrap: true, drag: true, handleSize: BAR, raise: 'click' },
    item: WINDOW_ITEM,
  },
  data: {
    css: XP_CSS,
    children: {
      'cascade-desktop': Array.from({ length: 200 }, (_, i) =>
        win(`cascade-${i + 1}`, `My Computer (${i + 1})`, 480, 360),
      ),
    },
  },
};

const CHROME_CSS = `
.xd-stack { background: #fff; }
.xd-tabs { gap: 0; padding: 6px 8px 0; box-sizing: border-box; background: #dee1e6; }
.xd-tab { border-radius: 8px 8px 0 0; background: none; }
.xd-tab:has([aria-selected='true']) { background: #fff; }
.xd-tab__label { color: #5f6368; font: 12px 'Segoe UI', system-ui, sans-serif; }
.xd-tab__label[aria-selected='true'] { color: #202124; box-shadow: none; }
.xd-tab__action { color: #5f6368; }
.xd-page { font: 13px system-ui, sans-serif; color: #202124; }
`;

export const CHROME_150_TABS: Preset = {
  id: 'chrome-150-tabs',
  source: 'Chrome with 150 tabs in one window, the last tab active',
  stress: 'a long stack, active tab last; closing it falls back rather than leaving nothing',
  description:
    "Chrome keeps a window's tabs in a strip across the top and shows only the active tab's page below it. With 150 tabs open, each tab shrinks to a sliver. Closing the active tab makes a neighboring tab active.",
  viewport: { w: 1024, h: 640 },
  mechanics: {
    id: 'chrome-window',
    kind: 'tabs',
    strategy: 'stack',
    config: { headerSize: 34, activeId: 'chrome-tab-150' },
  },
  data: {
    css: CHROME_CSS,
    children: {
      'chrome-window': Array.from({ length: 150 }, (_, i) =>
        tab(`chrome-tab-${i + 1}`, `Tab ${i + 1}`),
      ),
    },
  },
};

const PHOTOSHOP_CSS = `
.xd-root { background: #282828; }
.xd-canvas {
  background: linear-gradient(#fff, #fff) 50% 55% / 70% 70% no-repeat, #282828;
  color: #ccc;
  font: 11px system-ui, sans-serif;
}
.xd-dock { background: #1e1e1e; }
.xd-stack, .xd-page { background: #535353; }
.xd-tabs { gap: 0; background: #3c3c3c; }
.xd-tab { max-width: 96px; background: none; }
.xd-tab:has([aria-selected='true']) { background: #535353; }
.xd-tab__label { color: #aaa; font: 11px system-ui, sans-serif; }
.xd-tab__label[aria-selected='true'] { color: #eee; box-shadow: none; }
.xd-page { color: #ddd; font: 11px system-ui, sans-serif; }
.xd-palette { background: #535353; border-color: #222; color: #ddd; font: 11px system-ui, sans-serif; }
.xd-palette__bar, .xd-palette__tabs { background: #3c3c3c; }
.xd-palette__tab { background: #535353; color: #eee; }
.ps-color-panel .xd-palette__body {
  background: linear-gradient(90deg, red, yellow, lime, cyan, blue, magenta, red) 8px 12px / calc(100% - 16px) 14px no-repeat;
}
`;

/** A docked panel group: a tab dragged out of it floats at a panel's size. */
const PS_GROUP = { tear: 'float', tearSize: { w: 240, h: 260 } };

export const PHOTOSHOP_PANELS: Preset = {
  id: 'photoshop-panel-dock',
  source: 'Photoshop 2024: tabbed panel groups docked right of the canvas, one torn out floating',
  stress: 'stacks nested in a strip, and a tab leaving its stack to float over the workspace',
  description:
    'Photoshop docks its panels to the right of the document in groups, each showing one panel at a time behind a row of tabs, such as Layers, Channels and Paths. Users click a tab to switch panels, drag a tab to another group, or drag it out of the dock to make a floating panel, here the Color panel, that hovers over the document.',
  viewport: { w: 800, h: 520 },
  mechanics: {
    id: 'ps-workspace',
    kind: 'zone',
    strategy: 'floating-strip',
    // Takes panels torn out of the dock, and nothing else.
    config: { axis: 'x', fill: true, handleSize: 22, defaultAnchor: 'top-left', accepts: 'tear' },
    children: [
      { id: 'ps-canvas', kind: 'canvas' },
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
            config: { headerSize: 26, activeId: 'ps-layers', ...PS_GROUP },
            children: [panelTab('ps-layers'), panelTab('ps-channels'), panelTab('ps-paths')],
          },
          {
            id: 'ps-group-props',
            kind: 'tabs',
            strategy: 'stack',
            config: { headerSize: 26, activeId: 'ps-properties', ...PS_GROUP },
            children: [panelTab('ps-properties'), panelTab('ps-adjustments')],
          },
        ],
      },
      {
        id: 'ps-color',
        kind: 'tab',
        hints: { preferredSize: { w: 240, h: 180 } },
        placement: { floating: true },
      },
    ],
  },
  data: {
    css: PHOTOSHOP_CSS,
    nodes: {
      ...titles({
        'ps-canvas': 'Untitled-1 @ 66.7%',
        'ps-layers': 'Layers',
        'ps-channels': 'Channels',
        'ps-paths': 'Paths',
        'ps-properties': 'Properties',
        'ps-adjustments': 'Adjustments',
      }),
      'ps-color': { meta: { title: 'Color' }, className: 'ps-color-panel' },
    },
  },
};

const WIN11_ZONES_CSS = `
.xd-root { background: radial-gradient(ellipse at 60% 115%, #7eb0ff, #1a4fc4 45%, #0b1d5a); }
.xd-snap-zone {
  display: grid;
  place-items: center;
  border: 2px solid rgb(255 255 255 / 55%);
  border-radius: 8px;
  background: rgb(0 103 192 / 25%);
  font: 600 28px 'Segoe UI Variable', 'Segoe UI', system-ui, sans-serif;
}
.xd-palette {
  border: 1px solid rgb(0 0 0 / 20%);
  border-radius: 8px;
  background: #f3f3f3;
  box-shadow: 0 8px 24px rgb(0 0 0 / 35%);
  font: 12px 'Segoe UI Variable', 'Segoe UI', system-ui, sans-serif;
  color: #1b1b1b;
}
.xd-palette__bar { background: none; }
.xd-palette__bar::after { content: '─   ☐   ✕'; margin-left: auto; font-size: 10px; }
.xd-palette__body { background: #fff; }
`;

export const FANCYZONES: Preset = {
  id: 'fancyzones-priority-grid',
  source: 'Windows 11 Snap Layouts / PowerToys FancyZones "priority grid"',
  stress: 'snap targets are the tiled zones, not only the container; windows float over them',
  description:
    'PowerToys FancyZones, Microsoft\'s free window-arranging utility for Windows, divides the screen into zones; its "priority grid" template makes three columns. Holding Shift while dragging a window shows the zones, and releasing over one snaps the window to fill it. Windows 11\'s Snap Layouts offer similar arrangements built in.',
  viewport: { w: 960, h: 560 },
  mechanics: {
    id: 'fz-desktop',
    kind: 'zone',
    strategy: 'floating-grid',
    config: { cols: 3, gap: 8, padding: 8, snapToPanes: true, snapThreshold: 24, handleSize: 24 },
    children: [
      { id: 'fz-zone-left', kind: 'snap-zone' },
      { id: 'fz-zone-center', kind: 'snap-zone' },
      { id: 'fz-zone-right', kind: 'snap-zone' },
    ],
  },
  data: {
    css: WIN11_ZONES_CSS,
    nodes: titles({ 'fz-zone-left': 'Left', 'fz-zone-center': 'Center', 'fz-zone-right': 'Right' }),
    children: {
      'fz-desktop': [
        palette('fz-edge', 'Edge', 300, 220),
        palette('fz-code', 'VS Code', 280, 200, { snapCorners: ['top-left', 'top-right'] }),
      ],
    },
  },
};

const TWM_CSS = `
.xd-root { background: repeating-conic-gradient(#000 0 25%, #fff 0 50%) 0 0 / 2px 2px; }
.xd-window {
  border: 2px solid #000;
  box-shadow: none;
  background: #fff;
  font: bold 12px Helvetica, Arial, sans-serif;
  color: #000;
}
.xd-window__bar { gap: 8px; background: #fff; border-bottom: 2px solid #000; }
.xd-window__bar::after {
  content: '';
  flex: 1;
  height: 10px;
  background: repeating-linear-gradient(#000 0 1px, #fff 1px 2px);
}
.xd-window__glyph { order: 1; }
.xd-window__body { font: 12px 'DejaVu Sans Mono', monospace; color: #000; }
.xd-icon, .xd-icon--window {
  justify-content: flex-start;
  align-items: center;
  padding: 0 6px;
  border: 1px solid #000;
  background: #fff;
  font: bold 12px Helvetica, Arial, sans-serif;
}
`;

export const TWM_ICON_MANAGER: Preset = {
  id: 'twm-icon-manager',
  source: 'X11 twm with an icon manager: iconified xterms listed as one-line entries',
  stress: 'icon size far from the window size; a dozen iconified xterms in the icon box',
  description:
    'twm is the classic minimal window manager for the X Window System. It can show an icon manager, a small window listing each application window as one line of text; with it, iconified windows can leave the desktop entirely and come back with a click on their line. Small programs like xclock and xload stay open in a corner of the screen.',
  viewport: { w: 1024, h: 768 },
  mechanics: {
    id: 'twm-root',
    kind: 'zone',
    strategy: 'desktop-shelf',
    config: {
      minimize: 'icon',
      iconWidth: 160,
      iconHeight: 20,
      gap: 0,
      padding: 0,
      drag: true,
      handleSize: BAR,
      raise: 'click',
      minimizable: true,
      resize: true,
    },
    item: WINDOW_ITEM,
  },
  data: {
    css: TWM_CSS,
    children: {
      'twm-root': [
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
