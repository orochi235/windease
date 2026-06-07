import type { LayoutStrategy, NodeId, Store } from '../../index.js';
import { trace } from '../../index.js';

/** Looks up a strategy by id. DragController uses it to consult
 *  `strategy.canAccept` on the prospective post-drop child list. */
export type StrategyLookup = (id: string) => LayoutStrategy<unknown, string, unknown> | undefined;

export type DragCancelReason = 'rejected' | 'outside' | 'escape' | 'unregistered';

export interface DragState {
  draggingId: NodeId;
  hover: { targetId: NodeId; accepted: boolean } | null;
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
    { el: Element; canAccept?: (sourceId: NodeId) => boolean }
  >();
  private escapeBound = false;

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
  ): () => void {
    const value: { el: Element; canAccept?: (sourceId: NodeId) => boolean } = { el };
    if (canAccept) value.canAccept = canAccept;
    this.dropTargets.set(id, value);
    return () => {
      this.dropTargets.delete(id);
    };
  }

  tryBegin(sourceId: NodeId): boolean {
    if (this.active) return false;
    const node = this.store.getNode(sourceId);
    if (!node?.slot) return false;
    if (node.slot.placement?.locked === true) return false;
    const parent = this.store.getNode(node.slot.parentId);
    if (parent?.container?.allowsDragOut === false) return false;
    this.active = { draggingId: sourceId, hover: null };
    trace('dnd', `drag start: ${sourceId}`);
    this.bindEscape();
    this.emit();
    return true;
  }

  updateHoverByPoint(x: number, y: number): void {
    if (!this.active) return;
    let best: { id: NodeId; depth: number } | null = null;
    for (const [id, { el }] of this.dropTargets) {
      const r = el.getBoundingClientRect();
      if (x < r.left || x > r.right || y < r.top || y > r.bottom) continue;
      const depth = ancestorDepth(el);
      if (!best || depth > best.depth) best = { id, depth };
    }
    if (!best) {
      this.setHover(null);
      return;
    }
    const accepted = this.checkAccept(best.id);
    this.setHover({ targetId: best.id, accepted });
  }

  private checkAccept(targetId: NodeId): boolean {
    if (!this.active) return false;
    const draggingId = this.active.draggingId;
    if (targetId === draggingId) return false;

    const targetNode = this.store.getNode(targetId);
    if (targetNode?.container?.allowsDrop === false) return false;

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
        if (!strategy.canAccept(items, options)) return false;
      }
    }

    const reg = this.dropTargets.get(targetId);
    if (reg?.canAccept) return reg.canAccept(draggingId);
    return true;
  }

  private setHover(hover: { targetId: NodeId; accepted: boolean } | null): void {
    if (!this.active) return;
    if (sameHover(this.active.hover, hover)) return;
    this.active = { ...this.active, hover };
    if (hover) {
      trace('dnd', `hover: target=${hover.targetId} accepted=${hover.accepted}`);
    }
    this.emit();
  }

  drop(): void {
    if (!this.active) return;
    const { draggingId, hover } = this.active;
    if (!hover || !hover.accepted) {
      this.cancel(hover ? 'rejected' : 'outside');
      return;
    }
    try {
      this.store.moveNode(draggingId, hover.targetId);
      trace('dnd', `drop: ${draggingId} → ${hover.targetId}`);
    } catch (err) {
      trace('dnd', `drop failed: ${(err as Error).message}`);
    }
    this.clear();
  }

  cancel(reason: DragCancelReason = 'outside'): void {
    if (!this.active) return;
    trace('dnd', `cancel: ${this.active.draggingId} reason=${reason}`);
    this.clear();
  }

  private clear(): void {
    this.active = null;
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
  return a.targetId === b.targetId && a.accepted === b.accepted;
}
