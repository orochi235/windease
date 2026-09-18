import type { LayoutItem } from '../../layout-types.js';
import type { Scenario } from './invariants.js';
import type { Preset, PresetNode } from './preset.js';

const w = (v: number) => ({ w: v, h: 0 });
const h = (v: number) => ({ w: 0, h: v });

/** Blender scales every area metric by the UI scale; these are its 1.0 values. */
const BLENDER_HEADER = 26;
const BLENDER_AREA_MIN_X = 29;
const BLENDER_SEAM = { gap: 2, resizeMode: 'neighbor', joinOnOvershoot: true, joinThreshold: 24 };

/** A 1366×768 laptop panel at 125% display scaling, in CSS pixels. */
const DPR_125_LAPTOP = { w: 1366 / 1.25, h: 768 / 1.25 };

function blenderSplits(depth: number, level = 0): PresetNode {
  const axis = level % 2 === 0 ? 'x' : 'y';
  const leaf = (id: string): PresetNode => ({
    id,
    hints: { minSize: { w: BLENDER_AREA_MIN_X, h: BLENDER_HEADER } },
    meta: { title: id },
  });
  return {
    id: `split-${level}`,
    strategy: 'strip',
    config: { axis, fill: true, ...BLENDER_SEAM },
    hints: { minSize: { w: BLENDER_AREA_MIN_X, h: BLENDER_HEADER } },
    children: [
      leaf(`area-${level}`),
      level + 1 < depth ? blenderSplits(depth, level + 1) : leaf(`area-${level + 1}`),
    ],
  };
}

const ACME_TAG = 18;
const acmeWindow = (id: string, size: number, extra: Partial<PresetNode> = {}): PresetNode => ({
  id,
  placement: { size: { h: size } },
  hints: { minSize: h(ACME_TAG) },
  meta: { title: id },
  ...extra,
});

const FIREFOX_TAB_MIN = 76;
const FIREFOX_TAB_MAX = 225;
const firefoxTab = (i: number): PresetNode => ({
  id: `tab-${i}`,
  hints: { minSize: w(FIREFOX_TAB_MIN), maxSize: w(FIREFOX_TAB_MAX) },
  meta: { title: `Tab ${i}` },
});
const firefoxPinned = (i: number): PresetNode => ({
  id: `pinned-${i}`,
  placement: { size: { w: 40 } },
  hints: { minSize: w(40), maxSize: w(40) },
  meta: { title: `Pinned ${i}` },
});

/**
 * Real-software layouts whose containers run `strip`. Viewports are CSS
 * pixels; minimums approximate each product's own where it documents one.
 */
export const PRESETS: Preset[] = [
  {
    id: 'blender-layout-workspace',
    source: 'Blender 4.x Layout workspace on a 1366×768 laptop at 125% scaling',
    stress:
      'alternating-axis nesting at a fractional viewport, 26px header floors, and a timeline seam joined by overshoot',
    description:
      "Blender's default Layout workspace fills the window with areas: a top bar of menus and workspace tabs, a large 3D Viewport, the Outliner (the scene's list of objects) above the Properties editor on the right, a Timeline along the bottom and a thin status bar. Users drag the border between two areas to resize both, and drag from an area's corner to split it in two or merge it into a neighbor. Blender will not shrink an area below the height of its header.",
    viewport: DPR_125_LAPTOP,
    root: {
      id: 'blender',
      strategy: 'strip',
      config: { axis: 'y', ...BLENDER_SEAM },
      children: [
        {
          id: 'bl-topbar',
          placement: { size: { h: BLENDER_HEADER } },
          hints: { minSize: h(BLENDER_HEADER), maxSize: h(BLENDER_HEADER) },
          meta: { title: 'Top bar' },
        },
        {
          id: 'bl-main',
          strategy: 'strip',
          config: { axis: 'x', ...BLENDER_SEAM },
          hints: { minSize: h(BLENDER_HEADER) },
          children: [
            {
              id: 'bl-viewport',
              hints: { minSize: w(BLENDER_AREA_MIN_X) },
              meta: { title: '3D Viewport' },
            },
            {
              id: 'bl-right',
              strategy: 'strip',
              config: { axis: 'y', ...BLENDER_SEAM },
              placement: { size: { w: 280 } },
              hints: { minSize: w(BLENDER_AREA_MIN_X) },
              children: [
                {
                  id: 'bl-outliner',
                  placement: { size: { h: 200 } },
                  hints: { minSize: h(BLENDER_HEADER) },
                  meta: { title: 'Outliner' },
                },
                {
                  id: 'bl-properties',
                  hints: { minSize: h(BLENDER_HEADER) },
                  meta: { title: 'Properties' },
                },
              ],
            },
          ],
        },
        {
          id: 'bl-timeline',
          placement: { size: { h: 96 } },
          hints: { minSize: h(BLENDER_HEADER) },
          meta: { title: 'Timeline' },
        },
        {
          id: 'bl-status',
          placement: { size: { h: 22 } },
          hints: { minSize: h(22), maxSize: h(22) },
          meta: { title: 'Status bar' },
        },
      ],
    },
  },
  {
    id: 'blender-recursive-split',
    source: 'Blender Split Area applied ten times, alternating direction, at 125% scaling',
    stress:
      'ten levels of alternating-axis halving until the 26px header floor binds and the innermost split overflows',
    description:
      "Blender lets a user split any area in two, side by side or one above the other, from the View > Area menu or by dragging from the area's corner, and each half is a full editor that can be split again. Splitting the same corner over and over, alternating direction, halves the space each time. Blender refuses a split that would leave an area below its minimum size, so the deepest areas are little more than a header.",
    viewport: DPR_125_LAPTOP,
    root: blenderSplits(10),
  },
  {
    id: 'bloomberg-four-panel',
    source: 'Bloomberg Terminal classic four-panel screen on a 1280×1024 monitor',
    stress:
      'panel floors sum past the container on both axes, so every seam is pinned at both ends',
    description:
      'The Bloomberg Terminal traditionally shows four panels on each screen, two by two, and each panel runs its own function, such as a quote monitor, a news feed or a chart, independently of the others. A user types a function code into a panel to change what it shows. The panels are designed for the large monitors trading desks use, and four of them at a readable size do not fit on a smaller screen.',
    viewport: { w: 1280, h: 1024 },
    root: {
      id: 'bbg',
      strategy: 'strip',
      config: { axis: 'y', gap: 4, fill: true, resizeMode: 'neighbor', joinOnOvershoot: true },
      children: [1, 2].map((row) => ({
        id: `bbg-row-${row}`,
        strategy: 'strip',
        config: { axis: 'x', gap: 4, fill: true, resizeMode: 'neighbor', joinOnOvershoot: true },
        hints: { minSize: { w: 0, h: 540 } },
        children: [1, 2].map((col) => {
          const n = (row - 1) * 2 + col;
          return { id: `bbg-${n}`, hints: { minSize: w(660) }, meta: { title: `Panel ${n}` } };
        }),
      })),
    },
  },
  {
    id: 'acme-column',
    source: 'Plan 9 acme: one column with a maximized window and the rest shrunk to their tag line',
    stress:
      'explicit sizes that squeeze, tag-line floors, slivers stated below the floor, and a pinned window',
    description:
      "Plan 9's acme text editor divides the screen into columns, each holding a vertical stack of windows; every window has a one-line tag, showing its file name and commands, above its text. Clicking the small layout box at the left of a tag grows that window, and acme shrinks the others in the column, down to just their tag lines, to make room. Dragging the same box moves a window elsewhere in its column or to another column.",
    viewport: { w: 683, h: 768 },
    root: {
      id: 'acme',
      strategy: 'strip',
      config: { axis: 'y', gap: 1, resizeMode: 'neighbor' },
      children: [
        acmeWindow('/usr/glenda/', ACME_TAG),
        acmeWindow('mkfile', ACME_TAG),
        acmeWindow('dat.h', 2),
        acmeWindow('fns.h', 2),
        acmeWindow('main.c', 700, { placement: { size: { h: 700 }, pinned: 4 } }),
        acmeWindow('util.c', ACME_TAG),
        acmeWindow('+Errors', 1),
        acmeWindow('guide', ACME_TAG),
        acmeWindow('win', 3),
        acmeWindow('mail', ACME_TAG),
      ],
    },
  },
  {
    id: 'vscode-every-sidebar',
    source:
      'VS Code with activity bar, primary and secondary sidebars and panel open, at its 400px minimum window width',
    stress: 'fixed sidebars whose floors sum past the container around one fill pane',
    description:
      "Visual Studio Code's window runs left to right: the activity bar (a column of icons that switch views), the primary sidebar with the file Explorer, the editor with the panel (terminal, problems, output) below it, and a secondary sidebar on the right. Users drag the borders between them to resize, and show or hide each sidebar and the panel from the View menu or with keyboard shortcuts. Here every one of them is open while the window is at the narrowest width VS Code allows.",
    viewport: { w: 400, h: 600 },
    root: {
      id: 'vscode',
      strategy: 'strip',
      config: { axis: 'x', resizeMode: 'neighbor' },
      children: [
        {
          id: 'vs-activity',
          placement: { size: { w: 48 } },
          hints: { minSize: w(48), maxSize: w(48) },
          meta: { title: 'Activity bar' },
        },
        {
          id: 'vs-sidebar',
          placement: { size: { w: 300 } },
          hints: { minSize: w(170) },
          meta: { title: 'Explorer' },
        },
        {
          id: 'vs-center',
          strategy: 'strip',
          config: { axis: 'y', resizeMode: 'neighbor' },
          hints: { minSize: w(220) },
          children: [
            { id: 'vs-editor', hints: { minSize: h(70) }, meta: { title: 'Editor' } },
            {
              id: 'vs-panel',
              placement: { size: { h: 250 } },
              hints: { minSize: h(77) },
              meta: { title: 'Panel' },
            },
          ],
        },
        {
          id: 'vs-aux',
          placement: { size: { w: 300 } },
          hints: { minSize: w(170) },
          meta: { title: 'Secondary sidebar' },
        },
      ],
    },
  },
  {
    id: 'vscode-hinted-sidebars',
    source:
      'VS Code workbench at 1600×900 with sidebars declared by preferred size rather than stored size',
    stress:
      'the first seam drag moves the row from the preferred-size path onto the explicit-size path',
    description:
      'The same Visual Studio Code workbench, with an activity bar, Explorer sidebar, editor and secondary sidebar, on an ordinary 1600×900 screen. A newly opened sidebar takes a default width; once the user drags its border, VS Code remembers that width and uses it from then on.',
    viewport: { w: 1600, h: 900 },
    root: {
      id: 'vscode-hinted',
      strategy: 'strip',
      config: { axis: 'x', fill: true, resizeMode: 'neighbor' },
      children: [
        {
          id: 'vh-activity',
          hints: { preferredSize: w(48), minSize: w(48), maxSize: w(48) },
          meta: { title: 'Activity bar' },
        },
        {
          id: 'vh-sidebar',
          hints: { preferredSize: w(300), minSize: w(170) },
          meta: { title: 'Explorer' },
        },
        { id: 'vh-editor', hints: { minSize: w(220) }, meta: { title: 'Editor' } },
        {
          id: 'vh-aux',
          hints: { preferredSize: w(300), minSize: w(170) },
          meta: { title: 'Secondary sidebar' },
        },
      ],
    },
  },
  {
    id: 'xcode-restored-on-laptop',
    source: 'Xcode 15 window state saved on a 5K display and restored on a 1280×800 MacBook Air',
    stress: 'stored widths sum to twice the container, so every pane is squeezed before any drag',
    description:
      "Xcode's project window puts the Navigator (files, search results, issues) on the left, the source editor in the middle and the Inspector (settings for whatever is selected) on the right; users drag the dividers to resize and use toolbar buttons to show or hide the side areas. Xcode saves each project's window layout and restores it when the project reopens, so a layout saved on a 5K display comes back on a 13-inch MacBook Air with widths meant for a screen twice as wide.",
    viewport: { w: 1280, h: 800 },
    root: {
      id: 'xcode',
      strategy: 'strip',
      config: { axis: 'x', gap: 1, resizeMode: 'neighbor' },
      children: [
        {
          id: 'xc-navigator',
          placement: { size: { w: 400 } },
          hints: { minSize: w(200) },
          meta: { title: 'Navigator' },
        },
        {
          id: 'xc-editor',
          placement: { size: { w: 1800 } },
          hints: { minSize: w(300) },
          meta: { title: 'Editor' },
        },
        {
          id: 'xc-inspector',
          placement: { size: { w: 360 } },
          hints: { minSize: w(260) },
          meta: { title: 'Inspector' },
        },
      ],
    },
  },
  {
    id: 'tmux-even-horizontal-40',
    source: 'tmux select-layout even-horizontal after 40 splits, on a 1366px-wide terminal',
    stress:
      'fractional equal shares with 1px borders — do 40 extents and 39 gaps sum to the width exactly',
    description:
      'tmux runs several shell sessions inside one terminal window, dividing it into panes separated by one-character borders. The even-horizontal layout (select-layout even-horizontal) lines every pane up side by side at equal width. Users resize panes with resize-pane or, with mouse mode on, by dragging a border; when a split would leave a pane too small, tmux refuses it with "no space for new pane".',
    viewport: { w: 1366, h: 768 },
    root: {
      id: 'tmux',
      strategy: 'strip',
      config: { axis: 'x', gap: 1, fill: true, resizeMode: 'neighbor' },
      children: Array.from({ length: 40 }, (_, i) => ({
        id: `pane-${i}`,
        hints: { minSize: w(8) },
        meta: { title: `%${i}` },
      })),
    },
  },
  {
    id: 'emacs-balanced-past-min',
    source:
      'GNU Emacs C-x 3 eighteen times then balance-windows, window-min-width 10 columns at 8px',
    stress: 'equal fill shares whose floors sum past the frame width',
    description:
      "GNU Emacs divides its frame (the operating system's window) into windows, each showing a buffer. C-x 3 splits the current window into two side by side, and M-x balance-windows makes them all the same width. Emacs will not make a window narrower than window-min-width columns, and refuses a split that would.",
    viewport: { w: 1366, h: 768 },
    root: {
      id: 'emacs',
      strategy: 'strip',
      config: { axis: 'x', gap: 1, fill: true, resizeMode: 'neighbor' },
      children: Array.from({ length: 18 }, (_, i) => ({
        id: `window-${i}`,
        hints: { minSize: w(80) },
        meta: { title: `*buffer-${i}*` },
      })),
    },
  },
  {
    id: 'firefox-100-tabs',
    source: 'Firefox tab strip with 3 pinned tabs and 97 tabs at the default 76px minimum width',
    stress: 'floors far past the container under scroll mode, with a per-tab maximum width',
    description:
      "Firefox's tab strip runs along the top of the window: pinned tabs, shown as small icon-only tabs, sit at the left, and ordinary tabs follow. Tabs shrink as more open, down to a minimum width; past that the strip scrolls sideways, with arrow buttons at its ends. Users click a tab to switch to it and drag tabs to reorder them.",
    viewport: { w: 1280, h: 40 },
    root: {
      id: 'firefox',
      strategy: 'strip',
      config: { axis: 'x', overflowMode: 'scroll', resizable: false },
      children: [
        ...[1, 2, 3].map(firefoxPinned),
        ...Array.from({ length: 97 }, (_, i) => firefoxTab(i + 1)),
      ],
    },
  },
  {
    id: 'firefox-3-tabs',
    source: 'Firefox tab strip with three tabs on a 1280px window, tabs capped at 225px',
    stress:
      'unconstrained panes with a maxSize and plenty of room: the cap is the only thing holding them',
    description:
      'With only a few tabs open, Firefox gives each tab its full width of about 225 pixels and leaves the rest of the tab strip empty rather than stretching tabs to fill it. Tabs start to shrink only once more are open than fit at that width.',
    viewport: { w: 1280, h: 40 },
    root: {
      id: 'firefox-few',
      strategy: 'strip',
      config: { axis: 'x', resizable: false },
      children: [1, 2, 3].map(firefoxTab),
    },
  },
  {
    id: 'obsidian-readable-line',
    source: 'Obsidian with both sidebars open and "Readable line length" capping the note at 700px',
    stress: 'an auto pane capped by maxSize between two stored-size sidebars',
    description:
      "Obsidian, a note-taking app, shows a file list in the left sidebar, the open note in the middle and a right sidebar for panels such as the note's outline. Users drag a sidebar's edge to resize it and collapse either sidebar with a button. With \"Readable line length\" on, the note's text stops widening at a comfortable reading width and sits centered, leaving empty margins on a wide screen.",
    viewport: { w: 1920, h: 1080 },
    root: {
      id: 'obsidian',
      strategy: 'strip',
      config: { axis: 'x', resizeMode: 'neighbor' },
      children: [
        {
          id: 'ob-files',
          placement: { size: { w: 300 } },
          hints: { minSize: w(200) },
          meta: { title: 'Files' },
        },
        { id: 'ob-note', hints: { maxSize: w(700) }, meta: { title: 'Note' } },
        {
          id: 'ob-outline',
          placement: { size: { w: 300 } },
          hints: { minSize: w(200) },
          meta: { title: 'Outline' },
        },
      ],
    },
  },
  {
    id: 'slack-thread-open',
    source:
      'Slack desktop at 1100px with a thread open beside the channel (400px and 380px minimums)',
    stress: 'two fill panes with different floors, where an equal share falls under the larger one',
    description:
      "Slack's desktop app shows a narrow rail of workspace icons at the far left, a sidebar listing channels and direct messages, and the selected channel's messages. Opening a thread from a message adds a thread pane to the right of the channel, so the channel and the thread share the space beside the sidebar.",
    viewport: { w: 1100, h: 800 },
    root: {
      id: 'slack',
      strategy: 'strip',
      config: { axis: 'x', resizeMode: 'neighbor' },
      children: [
        { id: 'sl-rail', placement: { size: { w: 70 } }, meta: { title: 'Workspaces' } },
        { id: 'sl-sidebar', placement: { size: { w: 260 } }, meta: { title: 'Channels' } },
        { id: 'sl-channel', hints: { minSize: w(400) }, meta: { title: '#general' } },
        { id: 'sl-thread', hints: { minSize: w(380) }, meta: { title: 'Thread' } },
      ],
    },
  },
  {
    id: 'photoshop-minimized-group',
    source: 'Photoshop panel dock with the Properties group minimized to its tab bar',
    stress: 'a stored size below its own floor under redistribute resizing',
    description:
      "Photoshop keeps a narrow Tools panel of icons at the left of the window, the open document in the middle, and a dock of panel groups, such as Color, Properties and Layers, stacked on the right. Users drag the dividers between groups to resize them, drag a panel's tab to move it to another group, and double-click a group's tab to collapse it to just its tab bar.",
    viewport: { w: 1440, h: 900 },
    root: {
      id: 'photoshop',
      strategy: 'strip',
      config: { axis: 'x', resizeMode: 'neighbor' },
      children: [
        {
          id: 'ps-tools',
          placement: { size: { w: 40 } },
          hints: { minSize: w(40), maxSize: w(40) },
          meta: { title: 'Tools' },
        },
        { id: 'ps-canvas', hints: { minSize: w(200) }, meta: { title: 'Canvas' } },
        {
          id: 'ps-dock',
          strategy: 'strip',
          config: { axis: 'y', gap: 1 },
          placement: { size: { w: 280 } },
          hints: { minSize: w(200) },
          children: [
            {
              id: 'ps-color',
              placement: { size: { h: 240 } },
              hints: { minSize: h(150) },
              meta: { title: 'Color' },
            },
            {
              id: 'ps-properties',
              placement: { size: { h: 28 } },
              hints: { minSize: h(120) },
              meta: { title: 'Properties' },
            },
            { id: 'ps-layers', hints: { minSize: h(150) }, meta: { title: 'Layers' } },
          ],
        },
      ],
    },
  },
];

const item = (id: string, rest: Omit<LayoutItem, 'id'> = {}): LayoutItem => ({ id, ...rest });

/**
 * Inputs no product would ship on purpose but that reach a strategy anyway —
 * a hidden host measuring 0×0, a corrupt persisted size, contradictory hints.
 */
export const PATHOLOGICAL: Scenario[] = [
  {
    id: 'zero-viewport-padded',
    source: 'a dock hidden with display:none, which ResizeObserver reports as 0×0',
    stress: 'padding larger than both axes of the container',
    container: { w: 0, h: 0 },
    items: [item('a'), item('b')],
    options: { axis: 'x', padding: 4, fill: true },
  },
  {
    id: 'gap-wider-than-container',
    source: 'a gap token in rem applied to a container measured in px',
    stress: 'two gaps alone exceed the container',
    container: { w: 300, h: 100 },
    items: [item('a'), item('b'), item('c')],
    options: { axis: 'x', gap: 400, fill: true },
  },
  {
    id: 'padding-wider-than-main',
    source: 'a 10px-wide collapsed rail keeping its 20px padding',
    stress: 'padding alone exceeds the main axis',
    container: { w: 10, h: 100 },
    items: [item('a'), item('b')],
    options: { axis: 'x', padding: 20, fill: true },
  },
  {
    id: 'min-above-max-unconstrained',
    source: 'a plugin panel declaring minSize 300 and maxSize 200',
    stress: 'contradictory hints on a pane with no stored size',
    container: { w: 1000, h: 100 },
    items: [
      item('plugin', { hints: { minSize: w(300), maxSize: w(200) } }),
      item('fixed', { placement: { size: { w: 100 } } }),
    ],
    options: { axis: 'x' },
  },
  {
    id: 'min-above-max-explicit',
    source: 'a plugin panel declaring minSize 300 and maxSize 200, with a stored size',
    stress: 'contradictory hints where the documented rule is that max wins',
    container: { w: 1000, h: 100 },
    items: [
      item('plugin', {
        placement: { size: { w: 250 } },
        hints: { minSize: w(300), maxSize: w(200) },
      }),
      item('rest'),
    ],
    options: { axis: 'x' },
  },
  {
    id: 'max-below-preferred',
    source: 'a sidebar asking for 400px under a 300px cap',
    stress: 'preferredSize above maxSize on the preferred-size path',
    container: { w: 1000, h: 100 },
    items: [item('side', { hints: { preferredSize: w(400), maxSize: w(300) } }), item('main')],
    options: { axis: 'x', fill: true },
  },
  {
    id: 'fractional-explicit-at-dpr-125',
    source: 'sizes written by drags on a 125% display, persisted with their fractions',
    stress: 'fractional stored sizes in a fractional container',
    container: DPR_125_LAPTOP,
    items: [
      item('a', { placement: { size: { w: 240.4 } } }),
      item('b'),
      item('c', { placement: { size: { w: 300.8 } } }),
    ],
    options: { axis: 'x', gap: 1, resizeMode: 'neighbor' },
  },
  {
    id: 'negative-explicit',
    source: 'a consumer patchPlacement computing a size from a stale, larger container',
    stress: 'a stored size below zero',
    container: { w: 300, h: 50 },
    items: [item('a', { placement: { size: { w: -40 } } }), item('b')],
    options: { axis: 'x' },
  },
];
