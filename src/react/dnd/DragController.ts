import type { LayoutStrategy, NodeId, Store } from '../../index.js';
import { trace } from '../../index.js';

/** Looks up a strategy by id. DragController uses it to consult
 *  `strategy.canAccept` on the prospective post-drop child list. */
export type StrategyLookup = (id: string) => LayoutStrategy<unknown, string, unknown> | undefined;

export type DragCancelReason = 'rejected' | 'outside' | 'escape' | 'unregistered';

export interface DragState {
  draggingId: NodeId;
  /** Latest cursor position in viewport coords. Always present during a drag,
   *  even when the cursor is outside every registered drop target. Used by
   *  `<DragProvider>` to position the ghost overlay. */
  cursor: { x: number; y: number };
  hover: {
    targetId: NodeId;
    accepted: boolean;
    /** 0-based prospective insertion index. Undefined when the strategy
     *  gives no positional answer (e.g. splits) or when the target didn't
     *  register a `getInsertionIndex`. */
    insertIndex?: number;
  } | null;
}

export interface DropTargetOptions {
  /** Map cursor (viewport coords) → prospective insertion index (0-based).
   *  Return undefined to leave `insertIndex` unset. */
  getInsertionIndex?: (point: { x: number; y: number }) => number | undefined;
}

type Listener = (state: DragState | null) => void;

/**
 * Tracks the active drag and dispatches store.moveNode on drop.
 * One controller per <WindeaseDragProvider>; consumers subscribe via
 * useDragState. Hit-testing is consumer-driven: useDropTarget
 * registers element rects, and pointermove walks the registry to find the
 * deepest match. Innermost-wins is implemented by sorting registrations
 * by DOM depth at registration time.
 */
export class DragController {
  private active: DragState | null = null;
  private readonly listeners = new Set<Listener>();
  private readonly dropTargets = new Map<
    NodeId,
    {
      el: Element;
      canAccept?: (sourceId: NodeId) => boolean;
      getInsertionIndex?: (point: { x: number; y: number }) => number | undefined;
    }
  >();
  private escapeBound = false;
  private pendingPoint: { x: number; y: number } | null = null;
  private rafId: number | null = null;

  constructor(
    private readonly store: Store,
    private readonly getStrategy?: StrategyLookup,
  ) {}

  state(): DragState | null {
    return this.active;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  registerDropTarget(
    id: NodeId,
    el: Element,
    canAccept?: (sourceId: NodeId) => boolean,
    options?: DropTargetOptions,
  ): () => void {
    const value: {
      el: Element;
      canAccept?: (sourceId: NodeId) => boolean;
      getInsertionIndex?: (point: { x: number; y: number }) => number | undefined;
    } = { el };
    if (canAccept) value.canAccept = canAccept;
    if (options?.getInsertionIndex) value.getInsertionIndex = options.getInsertionIndex;
    const overwriting = this.dropTargets.has(id);
    this.dropTargets.set(id, value);
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
      trace('dnd', `tryBegin ${sourceId}: REJECTED (drag already active for ${this.active.draggingId})`);
      return false;
    }
    const node = this.store.getNode(sourceId);
    if (!node?.slot) {
      trace('dnd', `tryBegin ${sourceId}: REJECTED (no slot)`);
      return false;
    }
    if (node.slot.placement?.locked === true) {
      trace('dnd', `tryBegin ${sourceId}: REJECTED (placement.locked=true)`);
      return false;
    }
    const parent = this.store.getNode(node.slot.parentId);
    if (parent?.container?.allowsDragOut === false) {
      trace('dnd', `tryBegin ${sourceId}: REJECTED (parent ${node.slot.parentId} allowsDragOut=false)`);
      return false;
    }
    this.active = { draggingId: sourceId, cursor: { x: 0, y: 0 }, hover: null };
    trace('dnd', `drag start: ${sourceId} (from parent ${node.slot.parentId}; ${this.dropTargets.size} drop targets registered)`);
    this.bindEscape();
    this.emit();
    return true;
  }

  updateHoverByPoint(x: number, y: number): void {
    if (!this.active) return;
    this.pendingPoint = { x, y };
    if (this.rafId !== null) return;
    const raf =
      typeof requestAnimationFrame !== 'undefined'
        ? requestAnimationFrame
        : ((cb: FrameRequestCallback) =>
            setTimeout(() => cb(performance.now()), 16) as unknown as number);
    this.rafId = raf(() => {
      this.rafId = null;
      if (!this.pendingPoint || !this.active) return;
      const p = this.pendingPoint;
      this.pendingPoint = null;
      this.actuallyUpdateHover(p.x, p.y);
    });
  }

  private actuallyUpdateHover(x: number, y: number): void {
    if (!this.active) return;
    // Cursor always updates, regardless of hover target. The ghost overlay
    // follows the cursor even when over no drop target.
    let best: { id: NodeId; depth: number } | null = null;
    for (const [id, { el }] of this.dropTargets) {
      const r = el.getBoundingClientRect();
      if (x < r.left || x > r.right || y < r.top || y > r.bottom) continue;
      const depth = ancestorDepth(el);
      if (!best || depth > best.depth) best = { id, depth };
    }
    if (!best) {
      this.setHover(null, { x, y });
      return;
    }
    const reg = this.dropTargets.get(best.id);
    const insertIndex = reg?.getInsertionIndex?.({ x, y });
    const accepted = this.checkAccept(best.id, insertIndex);
    const hover: NonNullable<DragState['hover']> = { targetId: best.id, accepted };
    if (insertIndex !== undefined) hover.insertIndex = insertIndex;
    this.setHover(hover, { x, y });
  }

  private checkAccept(targetId: NodeId, _insertIndex: number | undefined): boolean {
    if (!this.active) return false;
    const draggingId = this.active.draggingId;
    if (targetId === draggingId) {
      trace('dnd', `checkAccept ${targetId}: REJECT (target is the source)`);
      return false;
    }

    const targetNode = this.store.getNode(targetId);
    if (targetNode?.container?.allowsDrop === false) {
      trace('dnd', `checkAccept ${targetId}: REJECT (target.container.allowsDrop=false)`);
      return false;
    }

    // Strategy-level constraint: e.g. splitStrategy refuses anything but 2 items.
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

    const reg = this.dropTargets.get(targetId);
    if (reg?.canAccept && !reg.canAccept(draggingId)) {
      trace('dnd', `checkAccept ${targetId}: REJECT (consumer canAccept said no)`);
      return false;
    }
    return true;
  }

  private setHover(
    hover: NonNullable<DragState['hover']> | null,
    cursor: { x: number; y: number },
  ): void {
    if (!this.active) return;
    const next: DragState['hover'] = hover
      ? {
          targetId: hover.targetId,
          accepted: hover.accepted,
          ...(hover.insertIndex !== undefined ? { insertIndex: hover.insertIndex } : {}),
        }
      : null;
    const cursorChanged =
      this.active.cursor.x !== cursor.x || this.active.cursor.y !== cursor.y;
    if (sameHover(this.active.hover, next) && !cursorChanged) return;
    const previous = this.active.hover;
    this.active = { ...this.active, cursor, hover: next };
    this.reflectHoverToDom(previous, next);
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

  /** Stamp `data-drop-target` / `data-drop-rejected` onto the hovered element
   *  so CSS can paint affordances. Clears them on hover-leave / drop / cancel. */
  private reflectHoverToDom(
    previous: NonNullable<DragState['hover']> | null,
    next: NonNullable<DragState['hover']> | null,
  ): void {
    if (previous) {
      const el = this.dropTargets.get(previous.targetId)?.el;
      if (el && typeof el.removeAttribute === 'function') {
        el.removeAttribute('data-drop-target');
        el.removeAttribute('data-drop-rejected');
      }
    }
    if (next) {
      const el = this.dropTargets.get(next.targetId)?.el;
      if (el && typeof el.setAttribute === 'function') {
        if (next.accepted) el.setAttribute('data-drop-target', 'true');
        else el.setAttribute('data-drop-rejected', 'true');
      }
    }
  }

  drop(): void {
    if (!this.active) return;
    this.cancelPendingRaf();
    const { draggingId, hover } = this.active;
    if (!hover || !hover.accepted) {
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
    this.cancelPendingRaf();
    trace('dnd', `cancel: ${this.active.draggingId} reason=${reason}`);
    this.clear();
  }

  private cancelPendingRaf(): void {
    if (this.rafId !== null) {
      if (typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.pendingPoint = null;
  }

  private clear(): void {
    const previousHover = this.active?.hover ?? null;
    this.active = null;
    this.reflectHoverToDom(previousHover, null);
    this.unbindEscape();
    this.emit();
  }

  private emit(): void {
    for (const fn of this.listeners) fn(this.active);
  }

  private bindEscape(): void {
    if (this.escapeBound) return;
    if (typeof window === 'undefined') return;
    window.addEventListener('keydown', this.onKey);
    this.escapeBound = true;
  }

  private unbindEscape(): void {
    if (!this.escapeBound) return;
    if (typeof window === 'undefined') return;
    window.removeEventListener('keydown', this.onKey);
    this.escapeBound = false;
  }

  private onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') this.cancel('escape');
  };
}

function ancestorDepth(el: Element): number {
  let n = 0;
  let cur: Element | null = el;
  while (cur) {
    n++;
    cur = cur.parentElement;
  }
  return n;
}

function sameHover(a: DragState['hover'], b: DragState['hover']): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.targetId === b.targetId && a.accepted === b.accepted && a.insertIndex === b.insertIndex
  );
}
