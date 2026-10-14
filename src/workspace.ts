import { DEFAULT_JOIN_THRESHOLD, SEAM_SIZE } from './layout/seam-join.js';
import type { Affordance, AffordanceJoin, LayoutEvent, Rect } from './layout-types.js';
import type { Node, NodeId } from './node.js';
import type { Store } from './store.js';
import { trace } from './trace.js';

/**
 * A draggable seam between two roots the host arranges itself. Roots have no
 * parent to tile them, so nothing emits this seam for them: the host says
 * which two roots it lies between.
 * @group Workspace
 */
export interface WorkspaceSeam {
  /** The root on the start side of the seam: left of it on `x`, above it on `y`. */
  before: NodeId;
  after: NodeId;
  axis: 'x' | 'y';
  /** Which of the two a drag writes a size to. The other is expected to take
   *  what is left, the way the host's own CSS arranges it. Default `'before'`. */
  sizes?: 'before' | 'after';
  /**
   * `'hide'` lets a drag pushed past a root's floor hide that root on release,
   * and leaves a handle on its neighbor to drag it back with. A root with
   * `lock.hide` is exempt. Absent, the seam stops at the floor.
   */
  overshoot?: 'hide';
}

/**
 * Input to {@link arrangeWorkspace}. `rects` is a measurement the host makes;
 * the core never measures.
 * @group Workspace
 */
export interface WorkspaceInput {
  store: Store;
  /** Every root the workspace shows, whether or not a seam names it. */
  roots: readonly NodeId[];
  seams: readonly WorkspaceSeam[];
  /** Each root's box as the host has laid it out, all in one space. A root
   *  that is hidden, or not yet measured, has none. */
  rects: ReadonlyMap<NodeId, Rect>;
  /** A root that fills the workspace while every other one is withheld.
   *  Absent, the first shown root with `hints.zoom` is; `null` zooms none. */
  zoom?: NodeId | null;
  /** Main-axis thickness of a seam. Defaults to 4. */
  seamSize?: number;
  /** Pixels past a floor before a hide arms. Defaults to 24. */
  joinThreshold?: number;
}

/**
 * What a host does with one root. `'hidden'` is the root's own lifecycle;
 * `'withheld'` is a shown root kept off screen by another's zoom. `size` holds
 * only the axes a seam sizes, and is absent until one has been dragged or the
 * root's `hints.size` set. `fill` marks an axis whose seam has lost its other
 * root to hiding: nothing is left to take the room this root's size leaves, so
 * the size is withheld and the host is told to let the root have it all.
 * @group Workspace
 */
export interface WorkspaceRootLayout {
  state: 'placed' | 'hidden' | 'zoomed' | 'withheld';
  size?: { w?: number; h?: number };
  fill?: { w?: true; h?: true };
}

/** The result of {@link arrangeWorkspace}.
 *  @group Workspace */
export interface WorkspaceLayout {
  roots: Map<NodeId, WorkspaceRootLayout>;
  /** Seams and reveal handles, in the space `rects` were measured in. */
  affordances: Affordance[];
}

/** DOM measurements land a fraction of a pixel off the value that set them. */
const EPSILON = 0.5;

const seamId = (seam: WorkspaceSeam) => `workspace-seam-${seam.before}-${seam.after}`;
const sizedOf = (seam: WorkspaceSeam) => (seam.sizes === 'after' ? seam.after : seam.before);
const dim = (axis: 'x' | 'y') => (axis === 'x' ? 'w' : 'h');

/** Reads one node. Arranging reads what the store has published, like every
 *  other render path; a drag reads truth, or moves arriving inside a throttled
 *  store's publish window would each start from the same stale size. */
type Read = (id: NodeId) => Node | undefined;

function isHidden(read: Read, id: NodeId): boolean {
  return read(id)?.lifecycle.state === 'hidden';
}

function storedSize(read: Read, id: NodeId, axis: 'x' | 'y'): number | undefined {
  const v = read(id)?.hints?.size?.[dim(axis)];
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined;
}

function floorOf(read: Read, id: NodeId, axis: 'x' | 'y'): number {
  const v = read(id)?.hints?.minSize?.[dim(axis)];
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0;
}

function ceilingOf(read: Read, id: NodeId, axis: 'x' | 'y'): number {
  const v = read(id)?.hints?.maxSize?.[dim(axis)];
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : Number.POSITIVE_INFINITY;
}

/** A seam moves both roots' edges, so a `lock.resize` on either freezes it. */
function resizeLocked(store: Store, seam: WorkspaceSeam): boolean {
  return store.isLocked(seam.before, 'resize') || store.isLocked(seam.after, 'resize');
}

/** One seam resolved against the measured boxes of the roots beside it. */
interface SeamGeometry {
  seam: WorkspaceSeam;
  rect: Rect;
  /** Main-axis extent the two roots hold between them, which a drag conserves. */
  total: number;
  /** The seam's position: the extent of `before`. */
  pos: number;
  min: number;
  max: number;
}

function resolveSeam(
  input: WorkspaceInput,
  seam: WorkspaceSeam,
  read: Read,
): SeamGeometry | undefined {
  const { rects } = input;
  if (isHidden(read, seam.before) || isHidden(read, seam.after)) return undefined;
  if (resizeLocked(input.store, seam)) return undefined;
  const a = rects.get(seam.before);
  const b = rects.get(seam.after);
  if (!a || !b) return undefined;
  const x = seam.axis === 'x';
  const thickness = input.seamSize ?? SEAM_SIZE;

  const crossStart = Math.max(x ? a.y : a.x, x ? b.y : b.x);
  const crossEnd = Math.min(x ? a.y + a.h : a.x + a.w, x ? b.y + b.h : b.x + b.w);
  if (crossEnd - crossStart <= 0) return undefined;
  const center = ((x ? a.x + a.w : a.y + a.h) + (x ? b.x : b.y)) / 2;
  const at = center - thickness / 2;
  const cross = crossEnd - crossStart;
  const rect: Rect = x
    ? { x: at, y: crossStart, z: 0, w: thickness, h: cross }
    : { x: crossStart, y: at, z: 0, w: cross, h: thickness };

  const extentA = x ? a.w : a.h;
  const extentB = x ? b.w : b.h;
  const total = extentA + extentB;
  const min = Math.max(
    floorOf(read, seam.before, seam.axis),
    total - ceilingOf(read, seam.after, seam.axis),
  );
  const max = Math.max(
    min,
    Math.min(ceilingOf(read, seam.before, seam.axis), total - floorOf(read, seam.after, seam.axis)),
  );
  const after = seam.sizes === 'after';
  const size = storedSize(read, sizedOf(seam), seam.axis);
  const raw = size ?? (after ? extentB : extentA);
  const rawPos = after ? total - raw : raw;
  // A stored size is intent and is held to the room there is; a measured one is
  // a fact, reported as it stands even where the host's CSS put it out of range.
  const pos = size === undefined ? rawPos : Math.min(max, Math.max(min, rawPos));
  return { seam, rect, total, pos, min, max };
}

function joinFor(input: WorkspaceInput, seam: WorkspaceSeam): AffordanceJoin | undefined {
  if (seam.overshoot !== 'hide') return undefined;
  const join: AffordanceJoin = {
    threshold: input.joinThreshold ?? DEFAULT_JOIN_THRESHOLD,
    action: 'hide',
  };
  if (!input.store.isLocked(seam.before, 'hide')) join.atMin = seam.before;
  if (!input.store.isLocked(seam.after, 'hide')) join.atMax = seam.after;
  return join.atMin === undefined && join.atMax === undefined ? undefined : join;
}

function seamAffordance(input: WorkspaceInput, g: SeamGeometry): Affordance {
  const { seam } = g;
  const x = seam.axis === 'x';
  const join = joinFor(input, seam);
  return {
    id: seamId(seam),
    kind: x ? 'resize-x' : 'resize-y',
    rect: g.rect,
    cursor: x ? 'ew-resize' : 'ns-resize',
    childId: sizedOf(seam),
    affects: [seam.before, seam.after],
    bounds: {
      orientation: x ? 'horizontal' : 'vertical',
      valueNow: g.pos,
      valueMin: Math.min(g.min, g.pos),
      valueMax: Math.max(g.max, g.pos),
      atMin: g.pos <= g.min + EPSILON,
      atMax: g.pos >= g.max - EPSILON,
    },
    ...(join ? { join } : {}),
  };
}

/** The handle that brings back the hidden root of a seam, laid over the edge
 *  of its neighbor that the root would open from. */
function revealAffordance(input: WorkspaceInput, seam: WorkspaceSeam): Affordance | undefined {
  if (seam.overshoot !== 'hide') return undefined;
  const read: Read = (id) => input.store.getNode(id);
  const beforeHidden = isHidden(read, seam.before);
  if (beforeHidden === isHidden(read, seam.after)) return undefined;
  const hiddenId = beforeHidden ? seam.before : seam.after;
  const v = input.rects.get(beforeHidden ? seam.after : seam.before);
  if (!v) return undefined;
  const x = seam.axis === 'x';
  const thickness = input.seamSize ?? SEAM_SIZE;
  const at = beforeHidden ? (x ? v.x : v.y) : (x ? v.x + v.w : v.y + v.h) - thickness;
  return {
    id: `workspace-reveal-${hiddenId}`,
    kind: x ? 'resize-x' : 'resize-y',
    rect: x
      ? { x: at, y: v.y, z: 0, w: thickness, h: v.h }
      : { x: v.x, y: at, z: 0, w: v.w, h: thickness },
    cursor: x ? 'ew-resize' : 'ns-resize',
    label: 'show',
    childId: hiddenId,
    affects: [hiddenId],
    reveal: {
      id: hiddenId,
      threshold: input.joinThreshold ?? DEFAULT_JOIN_THRESHOLD,
      direction: beforeHidden ? 1 : -1,
    },
  };
}

/** The root `zoom` names, when it is a shown root of this workspace. */
function zoomedOf(input: WorkspaceInput, read: Read): NodeId | undefined {
  const { zoom } = input;
  if (zoom === null) return undefined;
  if (zoom === undefined) {
    return input.roots.find((id) => read(id)?.hints?.zoom === true && !isHidden(read, id));
  }
  if (!input.roots.includes(zoom) || !read(zoom) || isHidden(read, zoom)) {
    trace('workspace', `zoom: ${zoom} is not a shown root here; arranging unzoomed`);
    return undefined;
  }
  return zoom;
}

/**
 * Arrange roots that the host lays out itself: which are shown, what size each
 * seam-sized root should take, and the seams between them.
 *
 * A workspace is not a container. Its roots stay roots, placed by whatever the
 * host uses to place them, and this reads their measured boxes to offer what a
 * parent strip would have given them: a seam to drag, a root that hides when
 * the seam is pushed past its floor, and one root zoomed over the rest. A seam
 * drag is {@link dispatchWorkspaceSeam}.
 *
 * @group Workspace
 */
export function arrangeWorkspace(input: WorkspaceInput): WorkspaceLayout {
  const read: Read = (id) => input.store.getNode(id);
  const roots = new Map<NodeId, WorkspaceRootLayout>();
  const zoomed = zoomedOf(input, read);
  for (const id of input.roots) {
    const state = isHidden(read, id)
      ? 'hidden'
      : zoomed === undefined
        ? 'placed'
        : id === zoomed
          ? 'zoomed'
          : 'withheld';
    roots.set(id, { state });
  }
  if (zoomed !== undefined) {
    trace('workspace', `arrange: ${zoomed} zoomed over ${input.roots.length - 1} roots`);
    return { roots, affordances: [] };
  }

  const affordances: Affordance[] = [];
  const revealed = new Set<NodeId>();
  for (const seam of input.seams) {
    const g = resolveSeam(input, seam, read);
    if (g) affordances.push(seamAffordance(input, g));
    const reveal = g ? undefined : revealAffordance(input, seam);
    if (reveal && !revealed.has(reveal.reveal?.id as NodeId)) {
      revealed.add(reveal.reveal?.id as NodeId);
      affordances.push(reveal);
    }

    const sized = roots.get(sizedOf(seam));
    if (sized?.state !== 'placed') continue;
    const other = seam.sizes === 'after' ? seam.before : seam.after;
    if (isHidden(read, other)) {
      sized.fill = { ...sized.fill, [dim(seam.axis)]: true };
      continue;
    }
    const stored = storedSize(read, sizedOf(seam), seam.axis);
    if (stored === undefined) continue;
    const held = g ? (seam.sizes === 'after' ? g.total - g.pos : g.pos) : stored;
    sized.size = { ...sized.size, [dim(seam.axis)]: held };
  }
  trace(
    'workspace',
    `arrange: ${input.roots.length} roots, ${affordances.length} affordances`,
    Object.fromEntries(roots),
  );
  return { roots, affordances };
}

/**
 * Apply a drag on a workspace seam: write the size it reaches to the root the
 * seam sizes, as `hints.size`, held between both roots' `minSize` and
 * `maxSize`. An event for an affordance this workspace did not emit, and any
 * event while a root is zoomed, writes nothing.
 *
 * It reads the stored size before the measured one, so moves that arrive
 * faster than the host re-measures still accumulate.
 *
 * @group Workspace
 */
export function dispatchWorkspaceSeam(input: WorkspaceInput, event: LayoutEvent): void {
  const read: Read = (id) => input.store.getNodeTruth(id);
  if (event.kind !== 'drag' || zoomedOf(input, read) !== undefined) return;
  const seam = input.seams.find((s) => seamId(s) === event.affordanceId);
  if (!seam) return;
  const g = resolveSeam(input, seam, read);
  if (!g) return;
  const delta = seam.axis === 'x' ? event.payload.dx : event.payload.dy;
  if (delta === undefined || Number.isNaN(delta)) {
    trace('workspace', `seam: ${event.affordanceId} drag delta ${delta} ignored`);
    return;
  }
  const next = Math.min(g.max, Math.max(g.min, g.pos + delta));
  if (next === g.pos) return;
  const id = sizedOf(seam);
  const key = dim(seam.axis);
  const size = seam.sizes === 'after' ? g.total - next : next;
  const prev = read(id)?.hints?.size;
  trace('workspace', `seam: ${event.affordanceId} ${id}.${key} ${prev?.[key] ?? 'auto'} → ${size}`);
  input.store.setHints(id, { size: { ...prev, [key]: size } });
}
