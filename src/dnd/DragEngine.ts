import type { LayoutStrategy, Rect } from '../layout-types.js';
import type { NodeId } from '../node.js';
import { placeRespectingPins } from '../pinning.js';
import type { Store } from '../store.js';
import { trace } from '../trace.js';
import { type EdgeScrollOptions, edgeScrollDelta } from './edgeScroll.js';

/** Looks up a strategy by id. The engine uses it to consult
 *  `strategy.canAccept` on the prospective post-drop child list. */
export type StrategyLookup = (id: string) => LayoutStrategy<unknown, string, unknown> | undefined;

export type DragCancelReason = 'rejected' | 'outside' | 'escape' | 'unregistered';

export interface Point {
  x: number;
  y: number;
}

export interface DragState {
  draggingId: NodeId;
  /** Latest cursor position, in whatever space the host samples in. Always
   *  present during a drag, even when the cursor is outside every registered
   *  drop target. Used by `<DragProvider>` to position the ghost overlay. */
  cursor: Point;
  hover: {
    targetId: NodeId;
    accepted: boolean;
    /** 0-based prospective insertion index. Undefined when the strategy
     *  gives no positional answer (e.g. splits) or when the target didn't
     *  register a `getInsertionIndex`. */
    insertIndex?: number;
  } | null;
}

/**
 * A registered drop target, as data. The host supplies geometry; the engine
 * never measures. `bounds` and `depth` are read once per hover sample, so keep
 * both cheap.
 */
export interface DropTarget {
  /** Where the target is, in the space the host samples cursors in. Null while
   *  the target has no geometry — it is skipped. */
  bounds(): Rect | null;
  /** Innermost-wins tiebreak between overlapping targets: the largest depth
   *  claims the hover. Absent counts as 0. */
  depth?(): number;
  canAccept?(sourceId: NodeId): boolean;
  getInsertionIndex?(point: Point): number | undefined;
  /**
   * The scrolling box this target lives in, if it has one. The engine works
   * out the rate and calls `by`; the host does the scrolling, since what
   * scrolls is a DOM concern. Absent means the target never auto-scrolls.
   */
  scroll?: {
    bounds(): Rect | null;
    by(dx: number, dy: number): void;
    options?: EdgeScrollOptions;
  };
}

/** Defers a hover sample. The DOM host coalesces per animation frame; the
 *  default runs the sample where it was made. */
/** What changed about a controlled parent's order, alongside the new list. */
export interface ChildOrderChange {
  /** The node the gesture moved. */
  movedId: NodeId;
  /** Where it came from. Equal to the controlled parent on a reorder. */
  fromParentId: NodeId;
  /** Where it is going. Equal to the controlled parent on a reorder. */
  toParentId: NodeId;
}

/**
 * Receives the order a drop *would* have produced, for a parent whose order the
 * host owns. Registering one makes that parent controlled: the drop no longer
 * writes to the store, and the host commits by re-rendering.
 */
export type ChildOrderCommit = (nextChildIds: NodeId[], change: ChildOrderChange) => void;

export interface FrameScheduler {
  request(cb: () => void): number;
  cancel(handle: number): void;
}

export interface DragEngineOptions {
  getStrategy?: StrategyLookup;
  schedule?: FrameScheduler;
}

const immediate: FrameScheduler = {
  request(cb) {
    cb();
    return 0;
  },
  cancel() {},
};

type Listener = (state: DragState | null) => void;

function contains(r: Rect, x: number, y: number): boolean {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

function sameHover(a: DragState['hover'], b: DragState['hover']): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.targetId === b.targetId && a.accepted === b.accepted && a.insertIndex === b.insertIndex;
}

/**
 * Tracks the active drag and dispatches `store.moveNode` on drop. Ownership,
 * acceptance and hit-testing only — no pointers, no elements, no listeners.
 * A host samples the cursor into `updateHoverByPoint` and calls `drop` /
 * `cancel`; `DragController` is the DOM host that does that.
 */
export class DragEngine {
  private active: DragState | null = null;
  private readonly listeners = new Set<Listener>();
  private readonly dropTargets = new Map<NodeId, DropTarget>();
  private readonly orderControls = new Map<NodeId, ChildOrderCommit>();
  private readonly schedule: FrameScheduler;
  private readonly getStrategy: StrategyLookup | undefined;
  private pendingPoint: Point | null = null;
  private frame: number | null = null;
  private scheduled = false;
  private autoScrolling = false;

  constructor(
    private readonly store: Store,
    options: DragEngineOptions = {},
  ) {
    this.getStrategy = options.getStrategy;
    this.schedule = options.schedule ?? immediate;
  }

  state(): DragState | null {
    return this.active;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  addDropTarget(id: NodeId, target: DropTarget): () => void {
    const overwriting = this.dropTargets.has(id);
    this.dropTargets.set(id, target);
    trace(
      'dnd',
      `registerDropTarget: ${id}${overwriting ? ' (overwriting prior registration)' : ''} (total: ${this.dropTargets.size})`,
    );
    return () => {
      this.dropTargets.delete(id);
      trace('dnd', `unregisterDropTarget: ${id} (total: ${this.dropTargets.size})`);
    };
  }

  /**
   * Declare that `id`'s child order is owned by the host. A drop that would
   * change it calls `commit` with the prospective order instead of mutating
   * the store — the controlled half of `preserveStoreOrder`.
   *
   * Kept in its own registry rather than on `addDropTarget`, whose later
   * registration replaces an earlier one for the same id.
   */
  registerOrderControl(id: NodeId, commit: ChildOrderCommit): () => void {
    this.orderControls.set(id, commit);
    trace('dnd', `registerOrderControl: ${id} (total: ${this.orderControls.size})`);
    return () => {
      if (this.orderControls.get(id) === commit) this.orderControls.delete(id);
      trace('dnd', `unregisterOrderControl: ${id} (total: ${this.orderControls.size})`);
    };
  }

  tryBegin(sourceId: NodeId): boolean {
    if (this.active) {
      trace(
        'dnd',
        `tryBegin ${sourceId}: REJECTED (drag already active for ${this.active.draggingId})`,
      );
      return false;
    }
    const node = this.store.getNode(sourceId);
    if (!node?.membership) {
      trace('dnd', `tryBegin ${sourceId}: REJECTED (no membership)`);
      return false;
    }
    if (this.store.isLocked(sourceId, 'move')) {
      trace('dnd', `tryBegin ${sourceId}: REJECTED (lock.move)`);
      return false;
    }
    if (this.store.isLocked(node.membership.parentId, 'dragOut')) {
      trace('dnd', `tryBegin ${sourceId}: REJECTED (parent lock.dragOut)`);
      return false;
    }
    this.active = { draggingId: sourceId, cursor: { x: 0, y: 0 }, hover: null };
    trace(
      'dnd',
      `drag start: ${sourceId} (from parent ${node.membership.parentId}; ${this.dropTargets.size} drop targets registered)`,
    );
    this.emit();
    return true;
  }

  updateHoverByPoint(x: number, y: number): void {
    if (!this.active) return;
    this.pendingPoint = { x, y };
    if (this.scheduled) return;
    this.scheduled = true;
    const handle = this.schedule.request(() => {
      this.scheduled = false;
      this.frame = null;
      const p = this.pendingPoint;
      this.pendingPoint = null;
      if (!p || !this.active) return;
      this.sample(p.x, p.y);
    });
    // A scheduler that runs the callback inline has already cleared the flag,
    // and the handle is stale — keeping it would cancel someone else's frame.
    if (this.scheduled) this.frame = handle;
  }

  private sample(x: number, y: number): void {
    if (!this.active) return;
    // Cursor always updates, regardless of hover target. The ghost overlay
    // follows the cursor even when over no drop target.
    let best: { id: NodeId; depth: number } | null = null;
    for (const [id, target] of this.dropTargets) {
      const r = target.bounds();
      if (!r || !contains(r, x, y)) continue;
      const depth = target.depth?.() ?? 0;
      if (!best || depth > best.depth) best = { id, depth };
    }
    if (!best) {
      this.setHover(null, { x, y });
      return;
    }
    this.autoScroll(this.dropTargets.get(best.id), x, y);
    const insertIndex = this.dropTargets.get(best.id)?.getInsertionIndex?.({ x, y });
    const accepted = this.checkAccept(best.id);
    const hover: NonNullable<DragState['hover']> = { targetId: best.id, accepted };
    if (insertIndex !== undefined) hover.insertIndex = insertIndex;
    this.setHover(hover, { x, y });
  }

  /**
   * Scroll the hovered target's box toward a cursor held near its edge, and
   * ask for another frame so it keeps going while the cursor stays there —
   * a pointermove alone would scroll one step and stop.
   *
   * The re-entrancy guard is what keeps an inline scheduler (the default, and
   * what the headless tests use) from recursing: it takes one step per real
   * sample instead of looping.
   */
  private autoScroll(target: DropTarget | undefined, x: number, y: number): void {
    const scroll = target?.scroll;
    if (!scroll) return;
    const box = scroll.bounds();
    if (!box) return;
    const d = edgeScrollDelta(box, { x, y }, scroll.options);
    if (d.x === 0 && d.y === 0) return;
    scroll.by(d.x, d.y);
    if (this.autoScrolling) return;
    this.autoScrolling = true;
    try {
      this.updateHoverByPoint(x, y);
    } finally {
      this.autoScrolling = false;
    }
  }

  private checkAccept(targetId: NodeId): boolean {
    if (!this.active) return false;
    const draggingId = this.active.draggingId;
    if (targetId === draggingId) {
      trace('dnd', `checkAccept ${targetId}: REJECT (target is the source)`);
      return false;
    }

    const targetNode = this.store.getNode(targetId);
    if (this.store.isLocked(targetId, 'accept')) {
      trace('dnd', `checkAccept ${targetId}: REJECT (lock.accept)`);
      return false;
    }

    // Strategy-level constraint: e.g. a strategy refusing anything but 2 items.
    if (targetNode?.container && this.getStrategy) {
      const strategy = this.getStrategy(targetNode.container.strategyId);
      if (strategy?.canAccept) {
        const current = this.store
          .getChildren(targetId)
          .filter((c) => c.lifecycle.state !== 'destroyed');
        const alreadyChild = current.some((c) => c.id === draggingId);
        const items = alreadyChild
          ? current.map((c) => ({ id: c.id }))
          : [...current.map((c) => ({ id: c.id })), { id: draggingId }];
        const options = (targetNode.container.config ?? {}) as Record<string, unknown>;
        if (!strategy.canAccept(items, options)) {
          trace(
            'dnd',
            `checkAccept ${targetId}: REJECT (strategy ${strategy.name}.canAccept said no for ${items.length} items)`,
          );
          return false;
        }
      }
    }

    const target = this.dropTargets.get(targetId);
    if (target?.canAccept && !target.canAccept(draggingId)) {
      trace('dnd', `checkAccept ${targetId}: REJECT (consumer canAccept said no)`);
      return false;
    }
    return true;
  }

  private setHover(hover: NonNullable<DragState['hover']> | null, cursor: Point): void {
    if (!this.active) return;
    const next: DragState['hover'] = hover
      ? {
          targetId: hover.targetId,
          accepted: hover.accepted,
          ...(hover.insertIndex !== undefined ? { insertIndex: hover.insertIndex } : {}),
        }
      : null;
    const cursorChanged = this.active.cursor.x !== cursor.x || this.active.cursor.y !== cursor.y;
    if (sameHover(this.active.hover, next) && !cursorChanged) return;
    const previous = this.active.hover;
    this.active = { ...this.active, cursor, hover: next };
    if (next) {
      const prevDesc = previous ? `${previous.targetId}` : 'none';
      trace(
        'dnd',
        `hover: ${prevDesc} → target=${next.targetId} accepted=${next.accepted} insertIndex=${next.insertIndex ?? '-'} cursor=(${cursor.x},${cursor.y})`,
      );
    } else if (previous) {
      trace(
        'dnd',
        `hover: ${previous.targetId} → none (cursor outside all targets, now (${cursor.x},${cursor.y}))`,
      );
    }
    this.emit();
  }

  drop(): void {
    if (!this.active) return;
    // Flush, not discard. The last pointermove before the release usually
    // arrives in the same frame as the pointerup, so its sample is still
    // queued here; dropping it resolves the drop against the frame before,
    // which on a fast drag is a different zone.
    this.flushPending();
    const { draggingId, hover } = this.active;
    if (!hover?.accepted) {
      this.cancel(hover ? 'rejected' : 'outside');
      return;
    }
    if (this.commitControlled(draggingId, hover.targetId, hover.insertIndex)) {
      this.clear();
      return;
    }
    try {
      this.store.moveNode(draggingId, hover.targetId, hover.insertIndex);
      trace('dnd', `drop: ${draggingId} → ${hover.targetId}@${hover.insertIndex ?? 'append'}`);
    } catch (err) {
      trace('dnd', `drop failed: ${(err as Error).message}`);
    }
    this.clear();
  }

  /**
   * Hand a controlled parent the order this drop would have produced, and
   * report whether the store write was suppressed.
   *
   * Either side of a cross-parent drop may be controlled. If one is, the store
   * writes nothing at all: committing the move here *and* asking the host to
   * commit it would apply the same gesture twice. An uncontrolled counterpart
   * is therefore the host's to update, which is what "controlled" has to mean
   * for the id to end up in exactly one place.
   */
  private commitControlled(
    movedId: NodeId,
    toParentId: NodeId,
    insertIndex: number | undefined,
  ): boolean {
    const fromParentId = this.store.getNode(movedId)?.membership?.parentId;
    if (fromParentId === undefined) return false;
    const toCommit = this.orderControls.get(toParentId);
    const fromCommit =
      fromParentId === toParentId ? undefined : this.orderControls.get(fromParentId);
    if (!toCommit && !fromCommit) return false;

    const change: ChildOrderChange = { movedId, fromParentId, toParentId };
    const pinnedIndexOf = (id: NodeId) => this.store.getPinnedIndex(id);

    if (toCommit) {
      const current = this.store.getNode(toParentId)?.container?.childOrder ?? [];
      const without = current.filter((cid) => cid !== movedId);
      const at = Math.max(0, Math.min(insertIndex ?? without.length, without.length));
      const spliced = [...without];
      spliced.splice(at, 0, movedId);
      // Same helper the store uses, so a controlled parent and an uncontrolled
      // one resolve a pinned prefix identically.
      toCommit(placeRespectingPins(spliced, movedId, at, pinnedIndexOf), change);
    }
    if (fromCommit) {
      const current = this.store.getNode(fromParentId)?.container?.childOrder ?? [];
      fromCommit(
        current.filter((cid) => cid !== movedId),
        change,
      );
    }
    trace(
      'dnd',
      `drop: ${movedId} → ${toParentId}@${insertIndex ?? 'append'} (controlled; store not written)`,
    );
    return true;
  }

  cancel(reason: DragCancelReason = 'outside'): void {
    if (!this.active) return;
    this.dropPending();
    trace('dnd', `cancel: ${this.active.draggingId} reason=${reason}`);
    this.clear();
  }

  /** Apply the queued sample now and cancel its frame. Only for `drop`:
   *  `cancel` commits nothing, so the pending point cannot change what
   *  happens and sampling it would emit a pointless hover. */
  private flushPending(): void {
    const p = this.pendingPoint;
    this.dropPending();
    if (p) this.sample(p.x, p.y);
  }

  private dropPending(): void {
    if (this.frame !== null) {
      this.schedule.cancel(this.frame);
      this.frame = null;
    }
    this.scheduled = false;
    this.pendingPoint = null;
  }

  private clear(): void {
    this.active = null;
    this.emit();
  }

  private emit(): void {
    for (const fn of this.listeners) fn(this.active);
  }
}
