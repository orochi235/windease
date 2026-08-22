import type { LayoutStrategy, Rect } from '../layout-types.js';
import type { NodeId } from '../node.js';
import type { Store } from '../store.js';
import { trace } from '../trace.js';

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
}

/** Defers a hover sample. The DOM host coalesces per animation frame; the
 *  default runs the sample where it was made. */
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
  private readonly schedule: FrameScheduler;
  private readonly getStrategy: StrategyLookup | undefined;
  private pendingPoint: Point | null = null;
  private frame: number | null = null;
  private scheduled = false;

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
    const insertIndex = this.dropTargets.get(best.id)?.getInsertionIndex?.({ x, y });
    const accepted = this.checkAccept(best.id);
    const hover: NonNullable<DragState['hover']> = { targetId: best.id, accepted };
    if (insertIndex !== undefined) hover.insertIndex = insertIndex;
    this.setHover(hover, { x, y });
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
    this.dropPending();
    const { draggingId, hover } = this.active;
    if (!hover?.accepted) {
      this.cancel(hover ? 'rejected' : 'outside');
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

  cancel(reason: DragCancelReason = 'outside'): void {
    if (!this.active) return;
    this.dropPending();
    trace('dnd', `cancel: ${this.active.draggingId} reason=${reason}`);
    this.clear();
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
