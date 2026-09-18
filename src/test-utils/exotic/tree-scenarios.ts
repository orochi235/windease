import { columnStrategy } from '../../layout/column.js';
import { desktopStrategy } from '../../layout/desktop.js';
import { floatingStrategy } from '../../layout/floating.js';
import { gridStrategy } from '../../layout/grid.js';
import { shelfStrategy } from '../../layout/shelf.js';
import { skylineStrategy } from '../../layout/skyline.js';
import { stackStrategy } from '../../layout/stack.js';
import { stripStrategy } from '../../layout/strip.js';
import { runStrategyForContainer } from '../../layout-node-adapter.js';
import type { LayoutResult, LayoutStrategy, Rect, Size } from '../../layout-types.js';
import { asNodeId, type NodeId } from '../../node.js';
import type { Store } from '../../store.js';
import type { Preset, PresetNode } from './preset.js';

/**
 * Every `strategyId` a preset may name. A wrapper's bare id wraps nothing, and
 * `<wrapper>-<inner>` names the inner layer, the convention every exotic
 * fixture file shares.
 */
export const TREE_STRATEGIES: Record<string, LayoutStrategy<unknown, string, unknown>> = {
  strip: stripStrategy as never,
  grid: gridStrategy as never,
  stack: stackStrategy as never,
  shelf: shelfStrategy as never,
  skyline: skylineStrategy as never,
  column: columnStrategy as never,
  desktop: desktopStrategy() as never,
  'desktop-shelf': desktopStrategy(shelfStrategy) as never,
  'desktop-grid': desktopStrategy(gridStrategy) as never,
  floating: floatingStrategy() as never,
  'floating-grid': floatingStrategy(gridStrategy) as never,
  'floating-strip': floatingStrategy(stripStrategy) as never,
};

/** One container's pass in {@link layoutTree}: its own box and what its strategy returned. */
export interface ContainerPass {
  id: string;
  /** The container's box in root coordinates. */
  box: Rect;
  result: LayoutResult<NodeId, unknown>;
}

/**
 * Lays out every container under `rootId` the way `NodeRenderer` mounts them:
 * each container runs its strategy at the extent its parent gave it. Children
 * a strategy withheld (a background tab) get no pass. Absolute rects are in
 * root coordinates.
 */
export function layoutTree(
  store: Store,
  rootId: string,
  viewport: Size,
  strategies: Record<string, LayoutStrategy<unknown, string, unknown>> = TREE_STRATEGIES,
): { passes: ContainerPass[]; rects: Map<string, Rect> } {
  const passes: ContainerPass[] = [];
  const rects = new Map<string, Rect>();
  const visit = (id: string, box: Rect) => {
    const node = store.getNode(asNodeId(id));
    const container = node?.container;
    if (!container) return;
    const strategy = strategies[container.strategyId];
    if (!strategy) throw new Error(`layoutTree: no strategy registered as ${container.strategyId}`);
    const items = container.childOrder
      .map((cid) => store.getNode(cid))
      .filter((n) => n && n.lifecycle.state !== 'hidden')
      .map((n) => ({ id: n!.id }));
    const state =
      container.state ??
      strategy.initialState?.(items, (container.config ?? {}) as Record<string, unknown>);
    const result = runStrategyForContainer(
      store,
      asNodeId(id),
      { w: box.w, h: box.h },
      strategy,
      state,
    );
    passes.push({ id, box, result });
    for (const [cid, r] of result.placements) {
      const abs = { x: box.x + r.x, y: box.y + r.y, z: r.z, w: r.w, h: r.h };
      rects.set(cid, abs);
      visit(cid, abs);
    }
  };
  visit(rootId, { x: 0, y: 0, z: 0, w: viewport.w, h: viewport.h });
  return { passes, rects };
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'node';

/** Hands out ids unique within one translation, suffixing a repeat. */
function idMint(): (want: string) => string {
  const used = new Map<string, number>();
  return (want) => {
    const base = slug(want);
    const n = used.get(base) ?? 0;
    used.set(base, n + 1);
    return n === 0 ? base : `${base}-${n + 1}`;
  };
}

// ---------------------------------------------------------------- i3 / sway

/**
 * One node of i3's `append_layout` JSON (the shape `i3-save-tree` emits), as
 * documented at https://i3wm.org/docs/layout-saving.html. Containers carry
 * `layout` and `nodes`; leaves carry `swallows` and usually `name`.
 */
export interface I3Node {
  type?: 'con' | 'floating_con' | 'workspace';
  layout?: 'splith' | 'splitv' | 'tabbed' | 'stacked';
  /** Share of the parent's split axis, 0–1. Absent means an equal share. */
  percent?: number;
  name?: string;
  swallows?: { class?: string; instance?: string; title?: string }[];
  nodes?: I3Node[];
}

/** i3's title bar at its default 10px font, which a tabbed or stacked container reserves per row. */
export const I3_TITLE_BAR = 20;

/**
 * Translates an i3 layout into a preset. `percent` becomes a pixel
 * `placement.size` on the parent's split axis, resolved against the viewport,
 * which is exactly what makes a moved i3 window carry a stale extent.
 */
export function fromI3Layout(
  root: I3Node,
  meta: { id: string; source: string; stress: string; description: string; viewport: Size },
): Preset {
  const mint = idMint();
  const walk = (
    node: I3Node,
    extent: Size,
    parent: I3Node | undefined,
    path: string,
  ): PresetNode => {
    const out: PresetNode = { id: '' };
    if (parent?.layout === 'splith' || parent?.layout === 'splitv') {
      // `extent` is already this node's share of the parent, so it is the pixel value.
      if (typeof node.percent === 'number' && node.percent > 0) {
        out.placement =
          parent.layout === 'splith'
            ? { size: { w: Math.round(extent.w) } }
            : { size: { h: Math.round(extent.h) } };
      }
    }
    if (!node.nodes || node.nodes.length === 0) {
      const title = node.name ?? node.swallows?.[0]?.class?.replace(/[\^$\\]/g, '') ?? path;
      out.id = mint(title);
      out.kind = 'panel';
      out.meta = { title };
      return out;
    }
    const layout = node.layout ?? 'splith';
    out.id = mint(`${layout}-${path}`);
    out.kind = parent ? 'group' : 'zone';
    out.meta = { title: `${layout} ${path}`, i3Layout: layout };
    const n = node.nodes.length;
    if (layout === 'splith' || layout === 'splitv') {
      out.strategy = 'strip';
      out.config = { axis: layout === 'splith' ? 'x' : 'y', fill: true };
    } else {
      out.strategy = 'stack';
      out.config = { headerSize: layout === 'tabbed' ? I3_TITLE_BAR : I3_TITLE_BAR * n };
    }
    const childExtent = (child: I3Node): Size => {
      const share = child.percent ?? 1 / n;
      if (layout === 'splith') return { w: extent.w * share, h: extent.h };
      if (layout === 'splitv') return { w: extent.w, h: extent.h * share };
      const header = (out.config as { headerSize: number }).headerSize;
      return { w: extent.w, h: Math.max(0, extent.h - header) };
    };
    out.children = node.nodes.map((child, i) =>
      walk(child, childExtent(child), node, `${path}.${i}`),
    );
    return out;
  };
  return { ...meta, root: walk(root, meta.viewport, undefined, '0') };
}

/**
 * A sway/i3 workspace nested seven containers deep: monitoring on the left,
 * an editor column whose top half tabs a browser against a devtools split,
 * chat tabbed on the right. Adapted from the tree `i3-save-tree` writes for a
 * typical developer workspace.
 */
export const I3_DEV_WORKSPACE: I3Node = {
  type: 'con',
  layout: 'splith',
  nodes: [
    {
      layout: 'splitv',
      percent: 0.25,
      nodes: [
        { name: 'htop', percent: 0.4, swallows: [{ class: '^Alacritty$', title: '^htop' }] },
        {
          layout: 'stacked',
          percent: 0.6,
          nodes: [
            { name: 'irssi', swallows: [{ class: '^Alacritty$' }] },
            { name: 'weechat', swallows: [{ class: '^Alacritty$' }] },
            { name: 'neomutt', swallows: [{ class: '^Alacritty$' }] },
          ],
        },
      ],
    },
    {
      layout: 'splitv',
      percent: 0.5,
      nodes: [
        {
          layout: 'splith',
          percent: 0.7,
          nodes: [
            {
              layout: 'tabbed',
              percent: 0.6,
              nodes: [
                { name: 'Firefox', swallows: [{ class: '^firefox$' }] },
                {
                  layout: 'splitv',
                  nodes: [
                    { name: 'DevTools', percent: 0.5 },
                    {
                      layout: 'splith',
                      percent: 0.5,
                      nodes: [
                        { name: 'Console', percent: 0.3 },
                        { name: 'Network', percent: 0.7 },
                      ],
                    },
                  ],
                },
              ],
            },
            { name: 'nvim', percent: 0.4, swallows: [{ class: '^Alacritty$', title: 'nvim' }] },
          ],
        },
        { name: 'shell', percent: 0.3, swallows: [{ class: '^Alacritty$' }] },
      ],
    },
    {
      layout: 'tabbed',
      percent: 0.25,
      nodes: [
        { name: 'Slack', swallows: [{ class: '^Slack$' }] },
        { name: 'Spotify', swallows: [{ class: '^Spotify$' }] },
      ],
    },
  ],
};

export const I3_PRESET = fromI3Layout(I3_DEV_WORKSPACE, {
  id: 'i3-dev-workspace',
  source: 'i3 4.x / sway append_layout JSON (i3-save-tree), 1920x1080 workspace',
  stress:
    'seven levels of splith/splitv/tabbed/stacked with percent shares resolved to pixel placement.size',
  description:
    'i3 and its Wayland counterpart sway are tiling window managers: windows never overlap but divide the screen between them, split side by side or one above the other, and any split can instead hold its windows as tabs or as a stack of title bars. This workspace has monitoring terminals on the left, an editor column with a browser tabbed against a devtools split, and chat apps tabbed on the right. Users resize a split by dragging its border or from the keyboard, and i3-save-tree saves the arrangement as JSON to restore later.',
  viewport: { w: 1920, h: 1080 },
});

// ------------------------------------------------------------ Golden Layout

/** A Golden Layout v2 `LayoutConfig` item. v1's numeric `width`/`height` percentages are read too. */
export interface GoldenItem {
  type: 'row' | 'column' | 'stack' | 'component';
  /** v2: `'40%'`, or `'1fr'`-style flex, which reads as an equal share. */
  size?: string;
  /** v1 legacy: percentage of the parent row's width. */
  width?: number;
  /** v1 legacy: percentage of the parent column's height. */
  height?: number;
  id?: string;
  title?: string;
  componentType?: string;
  activeItemIndex?: number;
  minSize?: string;
  content?: GoldenItem[];
}

export interface GoldenConfig {
  root: GoldenItem;
  dimensions?: { headerHeight?: number; minItemWidth?: number; minItemHeight?: number };
}

function goldenShare(item: GoldenItem, axis: 'x' | 'y'): number | undefined {
  if (typeof item.size === 'string' && item.size.endsWith('%')) {
    const v = Number.parseFloat(item.size);
    return Number.isFinite(v) ? v / 100 : undefined;
  }
  const legacy = axis === 'x' ? item.width : item.height;
  return typeof legacy === 'number' ? legacy / 100 : undefined;
}

/**
 * Translates a Golden Layout config into a preset. A bare component under a
 * row or column is wrapped in a one-tab stack, as Golden Layout itself does
 * on load; `minItemWidth`/`minItemHeight` become `hints.minSize` on every tab.
 */
export function fromGoldenLayout(
  config: GoldenConfig,
  meta: { id: string; source: string; stress: string; description: string; viewport: Size },
): Preset {
  const mint = idMint();
  const header = config.dimensions?.headerHeight ?? 20;
  const minW = config.dimensions?.minItemWidth ?? 10;
  const minH = config.dimensions?.minItemHeight ?? 10;

  const leaf = (item: GoldenItem): PresetNode => {
    const title = item.title ?? item.componentType ?? 'component';
    return {
      id: mint(item.id ?? title),
      kind: 'panel',
      meta: { title, componentType: item.componentType ?? 'component' },
      hints: { minSize: { w: minW, h: minH } },
    };
  };

  const walk = (item: GoldenItem, extent: Size, parentAxis: 'x' | 'y' | undefined): PresetNode => {
    const share = parentAxis ? goldenShare(item, parentAxis) : undefined;
    // `extent` is already this item's share of the parent, so it is the pixel value.
    const placement =
      parentAxis && share !== undefined
        ? {
            size: parentAxis === 'x' ? { w: Math.round(extent.w) } : { h: Math.round(extent.h) },
          }
        : undefined;
    const withPlacement = (n: PresetNode): PresetNode => (placement ? { ...n, placement } : n);

    if (item.type === 'component') {
      if (!parentAxis) return leaf(item);
      const panel = leaf(item);
      return withPlacement({
        id: mint(`stack-${panel.id}`),
        kind: 'group',
        strategy: 'stack',
        config: { headerSize: header, activeId: panel.id },
        children: [panel],
      });
    }

    const children = item.content ?? [];
    if (item.type === 'stack') {
      const tabs = children.map(leaf);
      const active = tabs[item.activeItemIndex ?? 0] ?? tabs[0];
      return withPlacement({
        id: mint(item.id ?? `stack-${tabs[0]?.id ?? 'empty'}`),
        kind: 'group',
        strategy: 'stack',
        config: active ? { headerSize: header, activeId: active.id } : { headerSize: header },
        children: tabs,
      });
    }

    const axis = item.type === 'row' ? 'x' : 'y';
    const n = Math.max(1, children.length);
    const childExtent = (child: GoldenItem): Size => {
      const s = goldenShare(child, axis) ?? 1 / n;
      return axis === 'x' ? { w: extent.w * s, h: extent.h } : { w: extent.w, h: extent.h * s };
    };
    return withPlacement({
      id: mint(item.id ?? `${item.type}`),
      kind: parentAxis ? 'group' : 'zone',
      strategy: 'strip',
      config: { axis, fill: true },
      children: children.map((c) => walk(c, childExtent(c), axis)),
    });
  };

  return { ...meta, root: walk(config.root, meta.viewport, undefined) };
}

/** An IDE-shaped Golden Layout v2 config, the shape its "saveLayout" round-trips. */
export const GOLDEN_IDE_CONFIG: GoldenConfig = {
  dimensions: { headerHeight: 24, minItemWidth: 80, minItemHeight: 60 },
  root: {
    type: 'row',
    content: [
      {
        type: 'column',
        size: '22%',
        content: [
          {
            type: 'stack',
            size: '60%',
            activeItemIndex: 1,
            content: [
              { type: 'component', componentType: 'fileTree', title: 'Files' },
              { type: 'component', componentType: 'outline', title: 'Outline' },
            ],
          },
          { type: 'component', componentType: 'search', title: 'Search', size: '40%' },
        ],
      },
      {
        type: 'column',
        size: '56%',
        content: [
          {
            type: 'stack',
            size: '70%',
            content: [
              { type: 'component', componentType: 'editor', title: 'main.ts' },
              { type: 'component', componentType: 'editor', title: 'store.ts' },
              { type: 'component', componentType: 'editor', title: 'main.ts' },
            ],
          },
          {
            type: 'row',
            size: '30%',
            content: [
              { type: 'component', componentType: 'terminal', title: 'Terminal', size: '50%' },
              {
                type: 'stack',
                size: '50%',
                content: [
                  { type: 'component', componentType: 'problems', title: 'Problems' },
                  { type: 'component', componentType: 'output', title: 'Output' },
                ],
              },
            ],
          },
        ],
      },
      {
        type: 'stack',
        size: '22%',
        content: [
          { type: 'component', componentType: 'chat', title: 'Chat' },
          { type: 'component', componentType: 'preview', title: 'Preview' },
        ],
      },
    ],
  },
};

export const GOLDEN_PRESET = fromGoldenLayout(GOLDEN_IDE_CONFIG, {
  id: 'golden-layout-ide',
  source: 'Golden Layout 2.x LayoutConfig (row/column/stack, size percentages), 1600x900',
  stress: 'percent sizes resolved per level, bare components wrapped in one-tab stacks',
  description:
    'Golden Layout is a JavaScript library that gives web apps IDE-style docking: panels arranged in rows and columns and grouped into tabbed stacks. This app has file and outline tabs above a search panel on the left, editor tabs above a terminal and a problems/output stack in the middle, and chat and preview tabs on the right. Users drag a tab into another stack, or to the edge of one to split it, and drag the dividers to resize; the app saves the arrangement to restore later.',
  viewport: { w: 1600, h: 900 },
});

/** The same IDE saved by Golden Layout 1.x, which spelled shares `width`/`height`. */
export const GOLDEN_V1_CONFIG: GoldenConfig = {
  root: {
    type: 'row',
    content: [
      { type: 'component', componentType: 'tree', title: 'Tree', width: 30 },
      {
        type: 'column',
        width: 70,
        content: [
          { type: 'component', componentType: 'editor', title: 'Editor', height: 75 },
          { type: 'component', componentType: 'console', title: 'Console', height: 25 },
        ],
      },
    ],
  },
};

export const GOLDEN_V1_PRESET = fromGoldenLayout(GOLDEN_V1_CONFIG, {
  id: 'golden-layout-v1',
  source: 'Golden Layout 1.5 config (numeric width/height percentages), 1280x720',
  stress: 'legacy percentage keys and a column nested in a row',
  description:
    "A simpler app built on Golden Layout 1.x: a file tree on the left, and an editor above a console on the right. Golden Layout 1.x saved each panel's share of its row or column as a width or height percentage, and apps built on it still have saved layouts in that older format.",
  viewport: { w: 1280, h: 720 },
});

// ----------------------------------------------------------------- Dockview

/** Dockview's `SerializedGridObject`: a branch holds children, a leaf holds one tab group. */
export type DockviewGridNode =
  | { type: 'branch'; data: DockviewGridNode[]; size?: number }
  | {
      type: 'leaf';
      data: { views: string[]; activeView?: string; id: string };
      size?: number;
    };

/** Dockview's `SerializedDockview` (`api.toJSON()`), trimmed to what layout reads. */
export interface DockviewLayout {
  grid: {
    root: DockviewGridNode;
    width: number;
    height: number;
    orientation: 'HORIZONTAL' | 'VERTICAL';
  };
  panels: Record<string, { id: string; contentComponent: string; title?: string }>;
  activeGroup?: string;
}

/** Dockview's default tab strip height. */
export const DOCKVIEW_TAB_HEIGHT = 35;

/**
 * Translates `api.toJSON()` output into a preset. Branch orientation alternates
 * by depth from `grid.orientation`, and a child's `size` is already pixels on
 * its parent's axis, so it goes straight into `placement.size`.
 */
export function fromDockview(
  layout: DockviewLayout,
  meta: { id: string; source: string; stress: string; description: string },
): Preset {
  const flip = (o: 'HORIZONTAL' | 'VERTICAL') => (o === 'HORIZONTAL' ? 'VERTICAL' : 'HORIZONTAL');
  const walk = (
    node: DockviewGridNode,
    orientation: 'HORIZONTAL' | 'VERTICAL',
    parentAxis: 'x' | 'y' | undefined,
    path: string,
  ): PresetNode => {
    const placement =
      parentAxis && typeof node.size === 'number'
        ? { size: parentAxis === 'x' ? { w: node.size } : { h: node.size } }
        : undefined;
    if (node.type === 'leaf') {
      const views = node.data.views.map((v) => ({
        id: v,
        kind: 'panel',
        meta: { title: layout.panels[v]?.title ?? v },
      }));
      const out: PresetNode = {
        id: `group-${node.data.id}`,
        kind: 'group',
        strategy: 'stack',
        config: {
          headerSize: DOCKVIEW_TAB_HEIGHT,
          ...(node.data.activeView ? { activeId: node.data.activeView } : {}),
        },
        children: views,
      };
      return placement ? { ...out, placement } : out;
    }
    const axis = orientation === 'HORIZONTAL' ? 'x' : 'y';
    const out: PresetNode = {
      id: `branch-${path}`,
      kind: parentAxis ? 'group' : 'zone',
      strategy: 'strip',
      config: { axis, fill: true },
      children: node.data.map((c, i) => walk(c, flip(orientation), axis, `${path}.${i}`)),
    };
    return placement ? { ...out, placement } : out;
  };
  return {
    ...meta,
    viewport: { w: layout.grid.width, h: layout.grid.height },
    root: walk(layout.grid.root, layout.grid.orientation, undefined, '0'),
  };
}

export const DOCKVIEW_LAYOUT: DockviewLayout = {
  grid: {
    orientation: 'HORIZONTAL',
    width: 1600,
    height: 1000,
    root: {
      type: 'branch',
      data: [
        { type: 'leaf', size: 280, data: { id: '1', views: ['explorer'], activeView: 'explorer' } },
        {
          type: 'branch',
          size: 1000,
          data: [
            {
              type: 'leaf',
              size: 700,
              data: { id: '2', views: ['main.tsx', 'util.ts'], activeView: 'util.ts' },
            },
            {
              type: 'branch',
              size: 300,
              data: [
                { type: 'leaf', size: 600, data: { id: '3', views: ['terminal'] } },
                { type: 'leaf', size: 400, data: { id: '4', views: ['debug', 'ports'] } },
              ],
            },
          ],
        },
        { type: 'leaf', size: 320, data: { id: '5', views: ['outline', 'timeline'] } },
      ],
    },
  },
  panels: {
    explorer: { id: 'explorer', contentComponent: 'explorer', title: 'Explorer' },
    'main.tsx': { id: 'main.tsx', contentComponent: 'editor', title: 'main.tsx' },
    'util.ts': { id: 'util.ts', contentComponent: 'editor', title: 'util.ts' },
    terminal: { id: 'terminal', contentComponent: 'terminal', title: 'Terminal' },
    debug: { id: 'debug', contentComponent: 'debug', title: 'Debug Console' },
    ports: { id: 'ports', contentComponent: 'ports', title: 'Ports' },
    outline: { id: 'outline', contentComponent: 'outline', title: 'Outline' },
    timeline: { id: 'timeline', contentComponent: 'timeline', title: 'Timeline' },
  },
  activeGroup: '2',
};

export const DOCKVIEW_PRESET = fromDockview(DOCKVIEW_LAYOUT, {
  id: 'dockview-vscode',
  source: 'Dockview 4.x api.toJSON() of a VS Code-shaped workbench, 1600x1000',
  stress: 'alternating branch orientation with pixel sizes on the parent axis',
  description:
    "Dockview is a JavaScript docking library for web apps; this layout imitates VS Code, with an Explorer on the left, editor tabs in the middle above a terminal and a debug console, and outline and timeline tabs on the right. Each area is a group of tabs: users drag tabs between groups, or to a group's edge to split it, and drag the borders between groups to resize them. The library saves the whole layout, with each area's size in pixels, to restore later.",
});

// ------------------------------------------------------------------- Emacs

/** One side window, as `display-buffer-in-side-window` takes it in `display-buffer-alist`. */
export interface EmacsSideWindow {
  buffer: string;
  slot: number;
  /** `window-width` (left/right) or `window-height` (top/bottom), as a frame fraction. */
  fraction?: number;
}

const EMACS_SIDE_WINDOWS =
  'GNU Emacs can reserve side windows along the edges of its frame for helper buffers, such as a file tree on the left and a compilation log and shell at the bottom, while ordinary editing windows fill the middle. Each side window keeps a numbered slot along its edge, and ordinary window commands like C-x 1 (delete other windows) leave side windows alone.';

/**
 * An Emacs frame with side windows. `window-sides-vertical` nil (the default)
 * lets top and bottom sides span the frame, so left and right sit between
 * them. Side windows are ordered by `slot` and pinned there, which is how a
 * slot keeps its place when a neighbor is deleted.
 */
export function emacsFrame(input: {
  id: string;
  /** Defaults to a description of Emacs side windows in general. */
  description?: string;
  viewport: Size;
  left?: EmacsSideWindow[];
  right?: EmacsSideWindow[];
  top?: EmacsSideWindow[];
  bottom?: EmacsSideWindow[];
  main: PresetNode;
}): Preset {
  const { viewport } = input;
  const side = (
    name: string,
    windows: EmacsSideWindow[] | undefined,
    axis: 'x' | 'y',
  ): PresetNode | undefined => {
    if (!windows || windows.length === 0) return undefined;
    const sorted = [...windows].sort((a, b) => a.slot - b.slot);
    const fraction = sorted[0]?.fraction ?? 0.2;
    return {
      id: `side-${name}`,
      kind: 'group',
      strategy: 'strip',
      config: { axis, fill: true },
      meta: { title: `${name} side`, windowSide: name },
      placement:
        axis === 'y'
          ? { size: { w: Math.round(fraction * viewport.w) } }
          : { size: { h: Math.round(fraction * viewport.h) } },
      children: sorted.map((w, i) => ({
        id: slug(w.buffer),
        kind: 'panel',
        meta: { title: w.buffer, windowSlot: w.slot },
        placement: { pinned: i },
      })),
    };
  };
  const left = side('left', input.left, 'y');
  const right = side('right', input.right, 'y');
  const top = side('top', input.top, 'x');
  const bottom = side('bottom', input.bottom, 'x');
  const middle: PresetNode = {
    id: 'frame-middle',
    kind: 'group',
    strategy: 'strip',
    config: { axis: 'x', fill: true },
    children: [left, input.main, right].filter((n): n is PresetNode => n !== undefined),
  };
  const sides = [top, middle, bottom].filter((n): n is PresetNode => n !== undefined);
  return {
    id: input.id,
    source: 'GNU Emacs 29 display-buffer-in-side-window with window-sides-vertical nil',
    stress: 'pinned side slots around a split main area; deleting a slot shifts the pins after it',
    description: input.description ?? EMACS_SIDE_WINDOWS,
    viewport,
    root: {
      id: 'frame',
      kind: 'zone',
      strategy: 'strip',
      config: { axis: 'y', fill: true },
      children: sides,
    },
  };
}

export const EMACS_PRESET = emacsFrame({
  id: 'emacs-side-windows',
  viewport: { w: 1440, h: 900 },
  left: [
    { buffer: '*dired*', slot: -1, fraction: 0.2 },
    { buffer: '*treemacs*', slot: 0 },
    { buffer: '*imenu-list*', slot: 1 },
  ],
  bottom: [
    { buffer: '*compilation*', slot: 0, fraction: 0.25 },
    { buffer: '*shell*', slot: 1 },
  ],
  main: {
    id: 'main-area',
    kind: 'group',
    strategy: 'strip',
    config: { axis: 'x', fill: true },
    children: [
      { id: 'init-el', kind: 'panel', meta: { title: 'init.el' } },
      {
        id: 'main-right',
        kind: 'group',
        strategy: 'strip',
        config: { axis: 'y', fill: true },
        children: [
          { id: 'help', kind: 'panel', meta: { title: '*Help*' } },
          { id: 'messages', kind: 'panel', meta: { title: '*Messages*' } },
        ],
      },
    ],
  },
});

// ------------------------------------------------------------ trading desk

/**
 * A futures desk laid out on a 3840x2160 monitor, in the shape Refinitiv
 * Eikon and TT save a workspace: fixed-pixel quote and ladder columns, a chart
 * grid, and floating order tickets at absolute positions. Restored on a
 * 1366x768 laptop, every one of those pixel values is wrong.
 */
export const TRADING_DESK_PRESET: Preset = {
  id: 'trading-desk-4k',
  source: 'Refinitiv Eikon / TT desktop workspace saved at 3840x2160',
  stress: 'pixel sizes, ladder floors and absolute window positions from a 4K monitor',
  description:
    "Trading platforms such as Refinitiv Eikon and Trading Technologies' TT let a trader save a workspace spread across a large monitor: quote boards and news on the left, a grid of price charts, a row of MD Trader price ladders (vertical price columns a trader clicks to place orders) and floating order-ticket windows. The workspace records every window's size and position in pixels, so reopening it on a laptop brings back a layout built for a screen almost three times as wide.",
  viewport: { w: 3840, h: 2160 },
  root: {
    id: 'desk',
    kind: 'zone',
    strategy: 'strip',
    config: { axis: 'x', gap: 4, padding: 4, fill: true },
    children: [
      {
        id: 'quotes-col',
        kind: 'group',
        strategy: 'strip',
        config: { axis: 'y', gap: 4, fill: true },
        placement: { size: { w: 960 } },
        children: [
          { id: 'quote-board', kind: 'panel', meta: { title: 'Quote board' } },
          {
            id: 'time-sales',
            kind: 'panel',
            meta: { title: 'Time & sales' },
            placement: { size: { h: 1200 } },
            hints: { minSize: { w: 200, h: 120 } },
          },
          { id: 'news', kind: 'panel', meta: { title: 'News' } },
        ],
      },
      {
        id: 'center-col',
        kind: 'group',
        strategy: 'strip',
        config: { axis: 'y', gap: 4, fill: true },
        children: [
          {
            id: 'charts',
            kind: 'group',
            strategy: 'grid',
            config: { cols: 2, gap: 4 },
            placement: { size: { h: 1440 } },
            children: [
              { id: 'chart-es', kind: 'panel', meta: { title: 'ES 5m' } },
              { id: 'chart-nq', kind: 'panel', meta: { title: 'NQ 5m' } },
              {
                id: 'chart-cl',
                kind: 'panel',
                meta: { title: 'CL daily' },
                placement: { span: { cols: 2 } },
              },
            ],
          },
          {
            id: 'ladders',
            kind: 'group',
            strategy: 'strip',
            config: { axis: 'x', gap: 4, fill: true },
            children: [
              ...['es', 'nq', 'cl'].map((sym) => ({
                id: `ladder-${sym}`,
                kind: 'panel',
                meta: { title: `MD Trader ${sym.toUpperCase()}` },
                placement: { size: { w: 420 } },
                hints: { minSize: { w: 180, h: 200 } },
              })),
              {
                id: 'order-book',
                kind: 'panel',
                meta: { title: 'Order book' },
                hints: { minSize: { w: 240, h: 200 } },
              },
            ],
          },
        ],
      },
      {
        id: 'tickets',
        kind: 'group',
        strategy: 'desktop',
        config: {},
        placement: { size: { w: 1400 } },
        children: [
          {
            id: 'ticket-es',
            kind: 'panel',
            meta: { title: 'Order ticket ES' },
            placement: { x: 60, y: 200, size: { w: 520, h: 640 } },
          },
          {
            id: 'ticket-cl',
            kind: 'panel',
            meta: { title: 'Order ticket CL' },
            placement: { x: 820, y: 1300, size: { w: 520, h: 640 } },
          },
          {
            id: 'positions',
            kind: 'panel',
            meta: { title: 'Positions' },
            placement: { x: 40, y: 900, size: { w: 1300, h: 360 } },
          },
        ],
      },
    ],
  },
};

/** The laptop the 4K desk gets restored on. */
export const LAPTOP: Size = { w: 1366, h: 768 };

export const PRESETS: Preset[] = [
  I3_PRESET,
  GOLDEN_PRESET,
  GOLDEN_V1_PRESET,
  DOCKVIEW_PRESET,
  EMACS_PRESET,
  TRADING_DESK_PRESET,
];
