import type {
  Affordance,
  LayoutEvent,
  LayoutItem,
  LayoutResult,
  LayoutStrategy,
  Rect,
  Size,
} from '../layout-types.js';

export type SplitNode =
  | { kind: 'leaf'; id: string }
  | {
      kind: 'split';
      direction: 'horizontal' | 'vertical';
      ratio: number;
      a: SplitNode;
      b: SplitNode;
    };

export interface SplitMeta {
  path: number[];
  direction: 'horizontal' | 'vertical';
}

export interface SplitOptions {
  gutterSize?: number;
  minRatio?: number;
  maxRatio?: number;
  /** When false, the strategy refuses anything but exactly 2 items —
   *  mirrors the old binarySplit strict-pair behavior. Default true. */
  recursive?: boolean;
}

const DEFAULT_MIN = 0.05;
const DEFAULT_MAX = 0.95;
const warned = new Set<string>();

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

/** Required pixel extent of a subtree along `axis`. Leaves contribute their
 *  hints.minSize; nested splits add along the parallel axis and max along
 *  the perpendicular axis. Unknown sizes contribute 0. */
function subtreeMin(
  node: SplitNode,
  axis: 'horizontal' | 'vertical',
  minsById: Map<string, { w: number; h: number } | undefined>,
): number | undefined {
  if (node.kind === 'leaf') {
    const m = minsById.get(node.id);
    if (!m) return undefined;
    return axis === 'horizontal' ? m.w : m.h;
  }
  const a = subtreeMin(node.a, axis, minsById) ?? 0;
  const b = subtreeMin(node.b, axis, minsById) ?? 0;
  // Same-axis split: required sizes add. Perpendicular: max.
  const parallel = node.direction === axis;
  const result = parallel ? a + b : Math.max(a, b);
  return result === 0 ? undefined : result;
}

function explicitForLeaf(
  node: SplitNode,
  axis: 'horizontal' | 'vertical',
  itemsById: Map<string, LayoutItem>,
): number | undefined {
  if (node.kind !== 'leaf') return undefined;
  const item = itemsById.get(node.id);
  if (!item) return undefined;
  const size = (item as unknown as { placement?: { size?: { w?: number; h?: number } } })
    .placement?.size;
  if (!size) return undefined;
  return axis === 'horizontal' ? size.w : size.h;
}

function walk(
  node: SplitNode,
  rect: Rect,
  path: number[],
  gutter: number,
  placements: Map<string, Rect>,
  affordances: Affordance<SplitMeta>[],
  validIds: Set<string>,
  itemsById: Map<string, LayoutItem>,
): void {
  if (node.kind === 'leaf') {
    if (!validIds.has(node.id)) {
      const key = `orphan:${node.id}`;
      if (!warned.has(key)) {
        warned.add(key);
        console.warn(`[windease] splitStrategy: leaf "${node.id}" not in items; dropping`);
      }
      return;
    }
    placements.set(node.id, rect);
    return;
  }
  const halfG = gutter / 2;
  const r = clamp(node.ratio, DEFAULT_MIN, DEFAULT_MAX);

  // Explicit size overrides ratio. Either pane wins; if both explicit, the
  // first one wins and the second takes the remainder. Out-of-bounds values
  // are clamped against the rect.
  const total = node.direction === 'horizontal' ? rect.w : rect.h;
  const explicitA = explicitForLeaf(node.a, node.direction, itemsById);
  const explicitB = explicitForLeaf(node.b, node.direction, itemsById);
  let aSize: number;
  if (explicitA !== undefined) {
    aSize = Math.min(Math.max(0, explicitA), Math.max(0, total - gutter));
  } else if (explicitB !== undefined) {
    aSize = Math.max(
      0,
      total - gutter - Math.min(Math.max(0, explicitB), Math.max(0, total - gutter)),
    );
  } else {
    aSize = total * r - halfG;
  }

  if (node.direction === 'horizontal') {
    const bx = rect.x + aSize + gutter;
    walk(
      node.a,
      { x: rect.x, y: rect.y, w: aSize, h: rect.h },
      [...path, 0],
      gutter,
      placements,
      affordances,
      validIds,
      itemsById,
    );
    walk(
      node.b,
      { x: bx, y: rect.y, w: rect.x + rect.w - bx, h: rect.h },
      [...path, 1],
      gutter,
      placements,
      affordances,
      validIds,
      itemsById,
    );
    affordances.push({
      id: `split-${path.join('.')}`,
      kind: 'drag-x',
      rect: { x: rect.x + aSize, y: rect.y, w: gutter, h: rect.h },
      cursor: 'col-resize',
      meta: { path, direction: 'horizontal' },
    });
  } else {
    const by = rect.y + aSize + gutter;
    walk(
      node.a,
      { x: rect.x, y: rect.y, w: rect.w, h: aSize },
      [...path, 0],
      gutter,
      placements,
      affordances,
      validIds,
      itemsById,
    );
    walk(
      node.b,
      { x: rect.x, y: by, w: rect.w, h: rect.y + rect.h - by },
      [...path, 1],
      gutter,
      placements,
      affordances,
      validIds,
      itemsById,
    );
    affordances.push({
      id: `split-${path.join('.')}`,
      kind: 'drag-y',
      rect: { x: rect.x, y: rect.y + aSize, w: rect.w, h: gutter },
      cursor: 'row-resize',
      meta: { path, direction: 'vertical' },
    });
  }
}

function updateAtPath(node: SplitNode, path: number[], newRatio: number): SplitNode {
  if (path.length === 0) {
    if (node.kind !== 'split') return node;
    return { ...node, ratio: newRatio };
  }
  if (node.kind !== 'split') return node;
  const [head, ...rest] = path;
  if (head === 0) return { ...node, a: updateAtPath(node.a, rest, newRatio) };
  if (head === 1) return { ...node, b: updateAtPath(node.b, rest, newRatio) };
  return node;
}

function nodeAtPath(node: SplitNode, path: number[]): SplitNode | undefined {
  if (path.length === 0) return node;
  if (node.kind !== 'split') return undefined;
  const [head, ...rest] = path;
  if (head === 0) return nodeAtPath(node.a, rest);
  if (head === 1) return nodeAtPath(node.b, rest);
  return undefined;
}

/** Build a leftward-leaning chain of horizontal splits from N items. */
function buildTree(items: LayoutItem[], _direction: 'horizontal' | 'vertical'): SplitNode {
  if (items.length === 0) return { kind: 'leaf', id: '' };
  if (items.length === 1) return { kind: 'leaf', id: items[0]!.id };
  const [head, ...rest] = items;
  return {
    kind: 'split',
    direction: _direction,
    ratio: 0.5,
    a: { kind: 'leaf', id: head!.id },
    b: buildTree(rest, _direction),
  };
}

function rectAtPath(root: SplitNode, path: number[], container: Rect, gutter: number): Rect | undefined {
  let node = root;
  let rect = container;
  for (const step of path) {
    if (node.kind !== 'split') return undefined;
    const halfG = gutter / 2;
    const r = clamp(node.ratio, DEFAULT_MIN, DEFAULT_MAX);
    if (node.direction === 'horizontal') {
      const aw = rect.w * r - halfG;
      const bx = rect.x + rect.w * r + halfG;
      if (step === 0) { rect = { x: rect.x, y: rect.y, w: aw, h: rect.h }; node = node.a; }
      else { rect = { x: bx, y: rect.y, w: rect.x + rect.w - bx, h: rect.h }; node = node.b; }
    } else {
      const ah = rect.h * r - halfG;
      const by = rect.y + rect.h * r + halfG;
      if (step === 0) { rect = { x: rect.x, y: rect.y, w: rect.w, h: ah }; node = node.a; }
      else { rect = { x: rect.x, y: by, w: rect.w, h: rect.y + rect.h - by }; node = node.b; }
    }
  }
  return rect;
}

/**
 * Generalized split layout. Default behavior is the recursive case (binary
 * tree of splits, N items). Pass `recursive: false` in config to enforce
 * exactly 2 items (the old splitStrategy semantics). `direction` in config
 * picks the root-split direction when initialState builds the tree.
 *
 * @group Strategies
 */
export const splitStrategy: LayoutStrategy<SplitNode, string, SplitMeta> = {
  name: 'split',
  initialState(items: LayoutItem[]): SplitNode {
    return buildTree(items, 'horizontal');
  },
  canAccept(items, options): boolean {
    const cfg = (options ?? {}) as SplitOptions;
    if (cfg.recursive === false) return items.length === 2;
    return items.length >= 2;
  },
  layout({ items, container, state, options, preview }: {
    items: LayoutItem[];
    container: Size;
    state: SplitNode;
    options: Record<string, unknown>;
    preview?: { insertId: string; insertIndex?: number; cursor: { x: number; y: number } };
  }): LayoutResult<string, SplitMeta> {
    const cfg = options as SplitOptions;
    const gutter = cfg.gutterSize ?? 4;
    const placements = new Map<string, Rect>();
    const affordances: Affordance<SplitMeta>[] = [];
    const validIds = new Set(items.map((it) => it.id));
    const itemsById = new Map(items.map((it) => [it.id, it] as const));
    walk(
      state,
      { x: 0, y: 0, w: container.w, h: container.h },
      [],
      gutter,
      placements,
      affordances,
      validIds,
      itemsById,
    );
    const result: LayoutResult<string, SplitMeta> = { placements, affordances };
    if (preview) result.isPreview = true;
    return result;
  },
  dispatchAffordance({ event, affordance, store, items }) {
    if (event.kind !== 'drag') return;
    // Only the split's own gutter affordances; ignore unrelated kinds.
    if (!affordance.id.startsWith('split-')) return;
    const meta = affordance.meta as SplitMeta | undefined;
    if (!meta) return;
    // Conservative implementation: clear `size` on every leaf in the items
    // list whose stored placement carries one. Targeted clearing of only the
    // two leaves on either side of this gutter is a follow-up; the plan
    // accepts this scope.
    const s = store as unknown as {
      getNode: (id: string) => { slot?: { placement?: Record<string, unknown> } } | undefined;
      patchPlacement: (id: string, patch: Record<string, unknown>) => void;
    };
    for (const it of items) {
      const placement = s.getNode(it.id)?.slot?.placement;
      if (placement && 'size' in placement) {
        s.patchPlacement(it.id, { size: undefined });
      }
    }
    // Note: the existing reduce() handler still fires after this in
    // useContainerLayout, applying the ratio update.
  },
  reduce(state, event, context) {
    if (event.kind !== 'drag') return state;
    const m = event.affordanceId.match(/^split-(.*)$/);
    if (!m) return state;
    const pathStr = m[1]!;
    const path = pathStr === '' ? [] : pathStr.split('.').map(Number);
    const target = nodeAtPath(state, path);
    if (!target || target.kind !== 'split') return state;
    const cfg = (context.options ?? {}) as SplitOptions;
    const gutter = cfg.gutterSize ?? 4;
    let minR = cfg.minRatio ?? DEFAULT_MIN;
    let maxR = cfg.maxRatio ?? DEFAULT_MAX;
    const rect = rectAtPath(state, path, { x: 0, y: 0, w: context.container.w, h: context.container.h }, gutter);
    if (!rect) return state;
    const total = target.direction === 'horizontal' ? rect.w : rect.h;
    if (total === 0) return state;
    // Honor child minSize: each side's required pixel size becomes a ratio
    // bound against this split's own rect (not the whole container).
    const minsById = new Map<string, { w: number; h: number } | undefined>();
    for (const it of context.items) minsById.set(it.id, it.hints?.minSize);
    const minSideA = subtreeMin(target.a, target.direction, minsById);
    const minSideB = subtreeMin(target.b, target.direction, minsById);
    if (minSideA !== undefined) minR = Math.max(minR, minSideA / total);
    if (minSideB !== undefined) maxR = Math.min(maxR, 1 - minSideB / total);
    if (minR > maxR) return state;
    const delta = target.direction === 'horizontal' ? (event.payload.dx ?? 0) : (event.payload.dy ?? 0);
    return updateAtPath(state, path, clamp(target.ratio + delta / total, minR, maxR));
  },
};
