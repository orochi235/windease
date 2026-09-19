import { columnStrategy } from '../layout/column.js';
import { desktopStrategy } from '../layout/desktop.js';
import { floatingStrategy } from '../layout/floating.js';
import { gridStrategy } from '../layout/grid.js';
import { shelfStrategy } from '../layout/shelf.js';
import { skylineStrategy } from '../layout/skyline.js';
import { stackStrategy } from '../layout/stack.js';
import { stripStrategy } from '../layout/strip.js';
import { runStrategyForContainer } from '../layout-node-adapter.js';
import type { LayoutResult, LayoutStrategy, Rect, Size } from '../layout-types.js';
import { asNodeId, type NodeId } from '../node.js';
import type { Store } from '../store.js';
import { type Preset, type PresetData, type PresetNode, styled, titles } from './preset.js';

type PresetNodeData = NonNullable<PresetData['nodes']>;

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
 * Translates an i3 layout into a preset. `percent` becomes `placement.share`,
 * a fraction of the parent split that i3 keeps when the output resizes. A moved
 * window carries it into its new parent, where i3 would have reset it.
 */
export function fromI3Layout(
  root: I3Node,
  meta: { id: string; source: string; stress: string; description: string; viewport: Size },
): Preset {
  const mint = idMint();
  const nodes: PresetNodeData = {};
  const walk = (node: I3Node, parent: I3Node | undefined, path: string): PresetNode => {
    const out: PresetNode = { id: '' };
    if (parent?.layout === 'splith' || parent?.layout === 'splitv') {
      if (typeof node.percent === 'number' && node.percent > 0) {
        out.placement = { share: node.percent };
      }
    }
    if (!node.nodes || node.nodes.length === 0) {
      const title = node.name ?? node.swallows?.[0]?.class?.replace(/[\^$\\]/g, '') ?? path;
      out.id = mint(title);
      out.kind = 'panel';
      nodes[out.id] = { meta: { title } };
      return out;
    }
    const layout = node.layout ?? 'splith';
    out.id = mint(`${layout}-${path}`);
    out.kind = parent ? 'group' : 'zone';
    nodes[out.id] = { meta: { title: `${layout} ${path}`, i3Layout: layout } };
    const n = node.nodes.length;
    if (layout === 'splith' || layout === 'splitv') {
      out.strategy = 'strip';
      out.config = { axis: layout === 'splith' ? 'x' : 'y', fill: true };
    } else {
      // i3 focuses a window moved into a tabbed or stacked container. What it
      // shows after the focused one closes is its focus history, which no
      // `fallback` rule names.
      out.strategy = 'stack';
      out.config = {
        headerSize: layout === 'tabbed' ? I3_TITLE_BAR : I3_TITLE_BAR * n,
        show: 'dropped',
      };
    }
    out.children = node.nodes.map((child, i) => walk(child, node, `${path}.${i}`));
    return out;
  };
  const mechanics = walk(root, undefined, '0');
  return { ...meta, mechanics, data: { nodes } };
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

const I3_CSS = `
& { background: #000; }
.xt-zone, .xt-split, .xt-stack { border: 0; background: #000; }
.xt-tabs { background: #222; border-bottom: 0; }
.xt-tabs:not(.xt-tabs--stacked) .xt-tab { flex: 1 1 0; }
.xt-tab {
  border: 1px solid #333;
  background: #222;
  color: #888;
  font: 11px/18px 'DejaVu Sans Mono', monospace;
  text-align: center;
}
.xt-tab[aria-selected='true'] { background: #5f676a; color: #fff; }
.xt-pane { border: 1px solid #333; background: #000; color: #ccc; }
.xt-pane__title { padding: 2px 6px; border-bottom: 0; background: #222; color: #888; font: 11px 'DejaVu Sans Mono', monospace; }
.xt-pane.i3-focused { border-color: #4c7899; }
.i3-focused .xt-pane__title { background: #285577; color: #fff; }
`;

export const I3_PRESET = styled(
  fromI3Layout(I3_DEV_WORKSPACE, {
    id: 'i3-dev-workspace',
    source: 'i3 4.x / sway append_layout JSON (i3-save-tree), 1920x1080 workspace',
    stress: 'seven levels of splith/splitv/tabbed/stacked with percent shares as placement.share',
    description:
      'i3 and its Wayland counterpart sway are tiling window managers: windows never overlap but divide the screen between them, split side by side or one above the other, and any split can instead hold its windows as tabs or as a stack of title bars. This workspace has monitoring terminals on the left, an editor column with a browser tabbed against a devtools split, and chat apps tabbed on the right. Users resize a split by dragging its border or from the keyboard, and i3-save-tree saves the arrangement as JSON to restore later.',
    viewport: { w: 1920, h: 1080 },
  }),
  I3_CSS,
  { nvim: 'i3-focused' },
);

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
 * on load; `minItemWidth`/`minItemHeight` become `hints.minSize` on every tab,
 * and percentages become `placement.share`. A stack shows a dropped tab, and
 * after the active tab closes shows the one before it, as Golden Layout does.
 */
export function fromGoldenLayout(
  config: GoldenConfig,
  meta: { id: string; source: string; stress: string; description: string; viewport: Size },
): Preset {
  const mint = idMint();
  const header = config.dimensions?.headerHeight ?? 20;
  const minW = config.dimensions?.minItemWidth ?? 10;
  const minH = config.dimensions?.minItemHeight ?? 10;
  const nodes: PresetNodeData = {};

  const leaf = (item: GoldenItem): PresetNode => {
    const title = item.title ?? item.componentType ?? 'component';
    const id = mint(item.id ?? title);
    nodes[id] = { meta: { title, componentType: item.componentType ?? 'component' } };
    return { id, kind: 'panel', hints: { minSize: { w: minW, h: minH } } };
  };

  const stack = { headerSize: header, show: 'dropped', fallback: 'prev' };
  const walk = (item: GoldenItem, parentAxis: 'x' | 'y' | undefined): PresetNode => {
    const share = parentAxis ? goldenShare(item, parentAxis) : undefined;
    const placement = share !== undefined && share > 0 ? { share } : undefined;
    const withPlacement = (n: PresetNode): PresetNode => (placement ? { ...n, placement } : n);

    if (item.type === 'component') {
      if (!parentAxis) return leaf(item);
      const panel = leaf(item);
      return withPlacement({
        id: mint(`stack-${panel.id}`),
        kind: 'group',
        strategy: 'stack',
        config: { ...stack, activeId: panel.id },
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
        config: active ? { ...stack, activeId: active.id } : stack,
        children: tabs,
      });
    }

    const axis = item.type === 'row' ? 'x' : 'y';
    return withPlacement({
      id: mint(item.id ?? `${item.type}`),
      kind: parentAxis ? 'group' : 'zone',
      strategy: 'strip',
      config: { axis, fill: true },
      children: children.map((c) => walk(c, axis)),
    });
  };

  const mechanics = walk(config.root, undefined);
  return { ...meta, mechanics, data: { nodes } };
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

const GOLDEN_CSS = `
.xt-zone, .xt-split { border: 0; background: #000; }
.xt-stack { border: 0; background: #222; }
.xt-tabs { gap: 2px; background: #000; border-bottom: 0; }
.xt-tab { background: #111; color: #999; font: 12px/20px Arial, sans-serif; }
.xt-tab[aria-selected='true'] { background: #222; color: #ddd; }
.xt-tab[aria-selected='true']::after { content: ' ×'; color: #999; }
.xt-pane { border: 0; background: #222; color: #ddd; }
.xt-pane__title { border-bottom: 1px solid #333; font: 12px Arial, sans-serif; }
`;

export const GOLDEN_PRESET = styled(
  fromGoldenLayout(GOLDEN_IDE_CONFIG, {
    id: 'golden-layout-ide',
    source: 'Golden Layout 2.x LayoutConfig (row/column/stack, size percentages), 1600x900',
    stress: 'percent sizes as shares at every level, bare components wrapped in one-tab stacks',
    description:
      'Golden Layout is a JavaScript library that gives web apps IDE-style docking: panels arranged in rows and columns and grouped into tabbed stacks. This app has file and outline tabs above a search panel on the left, editor tabs above a terminal and a problems/output stack in the middle, and chat and preview tabs on the right. Users drag a tab into another stack, or to the edge of one to split it, and drag the dividers to resize; the app saves the arrangement to restore later.',
    viewport: { w: 1600, h: 900 },
  }),
  GOLDEN_CSS,
);

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

export const GOLDEN_V1_PRESET = styled(
  fromGoldenLayout(GOLDEN_V1_CONFIG, {
    id: 'golden-layout-v1',
    source: 'Golden Layout 1.5 config (numeric width/height percentages), 1280x720',
    stress: 'legacy percentage keys and a column nested in a row',
    description:
      "A simpler app built on Golden Layout 1.x: a file tree on the left, and an editor above a console on the right. Golden Layout 1.x saved each panel's share of its row or column as a width or height percentage, and apps built on it still have saved layouts in that older format.",
    viewport: { w: 1280, h: 720 },
  }),
  GOLDEN_CSS,
);

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
 * by depth from `grid.orientation`. A child's `size` is pixels on its parent's
 * axis at the saved `width`/`height`, but Dockview lays its grid out
 * proportionally, rescaling every saved size to the element it restores into,
 * so each becomes `placement.share`: its size over its siblings' total. A
 * group shows a dropped tab; after the active tab closes it shows the most
 * recently used one, which no `fallback` rule names.
 */
export function fromDockview(
  layout: DockviewLayout,
  meta: { id: string; source: string; stress: string; description: string },
): Preset {
  const flip = (o: 'HORIZONTAL' | 'VERTICAL') => (o === 'HORIZONTAL' ? 'VERTICAL' : 'HORIZONTAL');
  const nodes: PresetNodeData = {};
  const walk = (
    node: DockviewGridNode,
    orientation: 'HORIZONTAL' | 'VERTICAL',
    siblingsTotal: number | undefined,
    path: string,
  ): PresetNode => {
    const placement =
      siblingsTotal !== undefined && siblingsTotal > 0 && typeof node.size === 'number'
        ? { share: node.size / siblingsTotal }
        : undefined;
    if (node.type === 'leaf') {
      const views = node.data.views.map((v) => {
        nodes[v] = { meta: { title: layout.panels[v]?.title ?? v } };
        return { id: v, kind: 'panel' };
      });
      const out: PresetNode = {
        id: `group-${node.data.id}`,
        kind: 'group',
        strategy: 'stack',
        config: {
          headerSize: DOCKVIEW_TAB_HEIGHT,
          show: 'dropped',
          ...(node.data.activeView ? { activeId: node.data.activeView } : {}),
        },
        children: views,
      };
      return placement ? { ...out, placement } : out;
    }
    const total = node.data.reduce((s, c) => s + (c.size ?? 0), 0);
    const out: PresetNode = {
      id: `branch-${path}`,
      kind: siblingsTotal === undefined ? 'zone' : 'group',
      strategy: 'strip',
      config: { axis: orientation === 'HORIZONTAL' ? 'x' : 'y', fill: true },
      children: node.data.map((c, i) => walk(c, flip(orientation), total, `${path}.${i}`)),
    };
    return placement ? { ...out, placement } : out;
  };
  const mechanics = walk(layout.grid.root, layout.grid.orientation, undefined, '0');
  return {
    ...meta,
    viewport: { w: layout.grid.width, h: layout.grid.height },
    mechanics,
    data: { nodes },
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

const DOCKVIEW_CSS = `
.xt-zone, .xt-split { border: 0; background: #444; }
.xt-stack { border: 0; background: #1e1e1e; }
.xt-tabs { height: 35px; background: #252526; border-bottom: 0; }
.xt-tab {
  height: 35px;
  padding: 0 12px;
  background: #2d2d2d;
  color: #969696;
  font: 13px/35px 'Segoe UI', system-ui, sans-serif;
}
.xt-tab[aria-selected='true'] { background: #1e1e1e; color: #fff; }
.xt-pane { border: 0; background: #1e1e1e; color: #ccc; }
.xt-pane__title { border-bottom: 1px solid #2d2d2d; font-weight: normal; }
`;

export const DOCKVIEW_PRESET = styled(
  fromDockview(DOCKVIEW_LAYOUT, {
    id: 'dockview-vscode',
    source: 'Dockview 4.x api.toJSON() of a VS Code-shaped workbench, 1600x1000',
    stress: 'alternating branch orientation with pixel sizes rescaled as shares of the parent axis',
    description:
      "Dockview is a JavaScript docking library for web apps; this layout imitates VS Code, with an Explorer on the left, editor tabs in the middle above a terminal and a debug console, and outline and timeline tabs on the right. Each area is a group of tabs: users drag tabs between groups, or to a group's edge to split it, and drag the borders between groups to resize them. The library saves the whole layout, with each area's size in pixels, and scales those sizes in proportion when it restores them into a different-sized window.",
  }),
  DOCKVIEW_CSS,
);

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
  /** The ordinary windows in the middle of the frame. */
  main: PresetNode;
  /** Buffer names shown in `main`'s windows, by window id. */
  mainTitles?: Record<string, string>;
}): Preset {
  const { viewport } = input;
  const nodes: PresetNodeData = titles(input.mainTitles ?? {});
  const side = (
    name: string,
    windows: EmacsSideWindow[] | undefined,
    axis: 'x' | 'y',
  ): PresetNode | undefined => {
    if (!windows || windows.length === 0) return undefined;
    const sorted = [...windows].sort((a, b) => a.slot - b.slot);
    const fraction = sorted[0]?.fraction ?? 0.2;
    nodes[`side-${name}`] = { meta: { title: `${name} side`, windowSide: name } };
    for (const w of sorted)
      nodes[slug(w.buffer)] = { meta: { title: w.buffer, windowSlot: w.slot } };
    return {
      id: `side-${name}`,
      kind: 'group',
      strategy: 'strip',
      config: { axis, fill: true },
      placement: { share: fraction },
      children: sorted.map((w, i) => ({
        id: slug(w.buffer),
        kind: 'panel',
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
    mechanics: {
      id: 'frame',
      kind: 'zone',
      strategy: 'strip',
      config: { axis: 'y', fill: true },
      children: sides,
    },
    data: { nodes },
  };
}

const EMACS_TREE_CSS = `
.xt-zone, .xt-split { border: 0; background: #7f7f7f; }
.xt-pane {
  flex-direction: column-reverse;
  border: 0;
  border-right: 1px solid #7f7f7f;
  background: #fff;
  color: #000;
}
.xt-pane__title {
  border-bottom: 0;
  background: #e5e5e5;
  font: 12px 'DejaVu Sans Mono', Menlo, monospace;
}
.xt-pane__title::before { content: '-UUU:---  '; }
.xt-pane__size { flex: 1; color: #777; }
.emacs-active .xt-pane__title { background: #bfbfbf; }
`;

export const EMACS_PRESET = styled(
  emacsFrame({
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
        { id: 'init-el', kind: 'panel' },
        {
          id: 'main-right',
          kind: 'group',
          strategy: 'strip',
          config: { axis: 'y', fill: true },
          children: [
            { id: 'help', kind: 'panel' },
            { id: 'messages', kind: 'panel' },
          ],
        },
      ],
    },
    mainTitles: { 'init-el': 'init.el', help: '*Help*', messages: '*Messages*' },
  }),
  EMACS_TREE_CSS,
  { 'init-el': 'emacs-active' },
);

// ------------------------------------------------------------ trading desk

/** The desk's strip extents at 3840x2160, less the padding and gaps, which its pixel sizes were fractions of. */
const DESK = { row: 3840 - 2 * 4 - 2 * 4, quotes: 2160 - 2 * 4 - 2 * 4, center: 2160 - 2 * 4 - 4 };
const LADDER_ROW = 3840 - 2 * 4 - 2 * 4 - 960 - 1400 - 3 * 4;

const TRADING_CSS = `
.xt-zone, .xt-split { border: 0; background: #050505; }
.xt-pane { border: 1px solid #2a2f36; background: #0b0e11; color: #c8ccd2; }
.xt-pane__title {
  border-bottom: 0;
  background: #1b2530;
  color: #e8edf2;
  font: 600 11px system-ui, sans-serif;
}
.xt-pane__size { font-family: 'Roboto Mono', Menlo, monospace; }
.td-chart {
  background:
    repeating-linear-gradient(90deg, #0000 0 47px, #1a2129 47px 48px),
    repeating-linear-gradient(#0000 0 31px, #1a2129 31px 32px),
    #0b0e11;
}
.td-ladder { background: linear-gradient(90deg, #0d2a4d 0 33%, #0b0e11 33% 67%, #4d0d12 67%); }
.xt-pane.td-ticket { border-color: #3a6ea5; }
.td-ticket .xt-pane__title { background: #1f4e7a; }
`;

/**
 * A futures desk laid out on a 3840x2160 monitor, in the shape Refinitiv
 * Eikon and TT save a workspace: quote and ladder columns, a chart grid, and
 * floating order tickets at absolute positions. The docked columns are saved
 * as shares of the 4K extents they held, so a 1366x768 laptop scales them in
 * proportion; the tickets keep their 4K pixel positions.
 */
export const TRADING_DESK_PRESET: Preset = styled(
  {
    id: 'trading-desk-4k',
    source: 'Refinitiv Eikon / TT desktop workspace saved at 3840x2160',
    stress: 'shares taken from a 4K monitor, ladder floors and absolute window positions',
    description:
      "Trading platforms such as Refinitiv Eikon and Trading Technologies' TT let a trader save a workspace spread across a large monitor: quote boards and news on the left, a grid of price charts, a row of MD Trader price ladders (vertical price columns a trader clicks to place orders) and floating order-ticket windows. The workspace records every window's size and position in pixels, so reopening it on a laptop brings back a layout built for a screen almost three times as wide.",
    viewport: { w: 3840, h: 2160 },
    mechanics: {
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
          placement: { share: 960 / DESK.row },
          children: [
            { id: 'quote-board', kind: 'panel' },
            {
              id: 'time-sales',
              kind: 'panel',
              placement: { share: 1200 / DESK.quotes },
              hints: { minSize: { w: 200, h: 120 } },
            },
            { id: 'news', kind: 'panel' },
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
              placement: { share: 1440 / DESK.center },
              children: [
                { id: 'chart-es', kind: 'panel' },
                { id: 'chart-nq', kind: 'panel' },
                {
                  id: 'chart-cl',
                  kind: 'panel',
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
                  placement: { share: 420 / LADDER_ROW },
                  hints: { minSize: { w: 180, h: 200 } },
                })),
                {
                  id: 'order-book',
                  kind: 'panel',
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
          placement: { share: 1400 / DESK.row },
          children: [
            {
              id: 'ticket-es',
              kind: 'panel',
              placement: { x: 60, y: 200, size: { w: 520, h: 640 } },
            },
            {
              id: 'ticket-cl',
              kind: 'panel',
              placement: { x: 820, y: 1300, size: { w: 520, h: 640 } },
            },
            {
              id: 'positions',
              kind: 'panel',
              placement: { x: 40, y: 900, size: { w: 1300, h: 360 } },
            },
          ],
        },
      ],
    },
    data: {
      nodes: titles({
        'quote-board': 'Quote board',
        'time-sales': 'Time & sales',
        news: 'News',
        'chart-es': 'ES 5m',
        'chart-nq': 'NQ 5m',
        'chart-cl': 'CL daily',
        'order-book': 'Order book',
        'ticket-es': 'Order ticket ES',
        'ticket-cl': 'Order ticket CL',
        positions: 'Positions',
        ...Object.fromEntries(
          ['es', 'nq', 'cl'].map((sym) => [`ladder-${sym}`, `MD Trader ${sym.toUpperCase()}`]),
        ),
      }),
    },
  },
  TRADING_CSS,
  {
    'chart-es': 'td-chart',
    'chart-nq': 'td-chart',
    'chart-cl': 'td-chart',
    'ladder-es': 'td-ladder',
    'ladder-nq': 'td-ladder',
    'ladder-cl': 'td-ladder',
    'ticket-es': 'td-ticket',
    'ticket-cl': 'td-ticket',
  },
);

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
