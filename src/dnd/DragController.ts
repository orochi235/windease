import type { NodeId } from '../node.js';
import type { Store } from '../store.js';
import { trace } from '../trace.js';
import {
  type ChildOrderCommit,
  type DragCancelReason,
  DragEngine,
  type DragState,
  type FrameScheduler,
  type Point,
  type StrategyLookup,
} from './DragEngine.js';
import type { DropIntent } from './dropIntent.js';
import type { EdgeScrollOptions } from './edgeScroll.js';

export type {
  ChildOrderChange,
  ChildOrderCommit,
  DragCancelReason,
  DragState,
  DropTarget,
  FrameScheduler,
  Point,
  StrategyLookup,
} from './DragEngine.js';

export interface DropTargetOptions {
  /** Map cursor (viewport coords) → prospective insertion index (0-based).
   *  Return undefined to leave `insertIndex` unset. */
  getInsertionIndex?: (point: Point) => number | undefined;
  /** Map cursor → what kind of drop it is asking for. Takes precedence over
   *  `getInsertionIndex`. */
  getDropIntent?: (point: Point) => DropIntent | undefined;
  /**
   * The element that scrolls this target's content — the wrapper carrying
   * `overflow: auto`. Dragging toward its edge scrolls it. Omit and the
   * target never auto-scrolls.
   */
  scrollEl?: Element | null;
  /** Ramp shape for that scrolling. See `edgeScrollDelta`. */
  edgeScroll?: EdgeScrollOptions;
}

function rectOf(el: Element): { x: number; y: number; w: number; h: number } {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.right - r.left, h: r.bottom - r.top };
}

const rafScheduler: FrameScheduler = {
  request(cb) {
    if (typeof requestAnimationFrame !== 'undefined') return requestAnimationFrame(() => cb());
    return setTimeout(cb, 16) as unknown as number;
  },
  cancel(handle) {
    if (typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(handle);
    else clearTimeout(handle as unknown as ReturnType<typeof setTimeout>);
  },
};

function ancestorDepth(el: Element): number {
  let n = 0;
  let cur: Element | null = el;
  while (cur) {
    n++;
    cur = cur.parentElement;
  }
  return n;
}

/**
 * The DOM host for `DragEngine`: element rects instead of `bounds()`, window
 * listeners for the gestures the handle can miss, `data-drop-*` attributes for
 * CSS, and per-frame coalescing of pointer samples. The engine underneath owns
 * ownership and acceptance and never touches any of this.
 *
 * One controller per `<DragProvider>`; consumers subscribe via `useDragState`.
 * Hit-testing is consumer-driven — `useDropTarget` registers element rects,
 * and pointermove walks the registry to find the deepest match.
 */
export class DragController {
  private readonly engine: DragEngine;
  private readonly elements = new Map<NodeId, Element>();
  private stamped: NodeId | null = null;
  private escapeBound = false;
  private windowUpBound = false;

  constructor(store: Store, getStrategy?: StrategyLookup, stackConfig?: Record<string, unknown>) {
    const options: {
      getStrategy?: StrategyLookup;
      schedule: FrameScheduler;
      stackConfig?: Record<string, unknown>;
    } = {
      schedule: rafScheduler,
    };
    if (getStrategy) options.getStrategy = getStrategy;
    if (stackConfig) options.stackConfig = stackConfig;
    this.engine = new DragEngine(store, options);
    // First subscriber, so attributes and window listeners are settled before
    // any consumer listener sees the new state.
    this.engine.subscribe((state) => {
      this.reflectHover(state);
      if (state) {
        this.bindEscape();
        this.bindWindowUp();
      } else {
        this.unbindEscape();
        this.unbindWindowUp();
      }
    });
  }

  state(): DragState | null {
    return this.engine.state();
  }

  subscribe(fn: (state: DragState | null) => void): () => void {
    return this.engine.subscribe(fn);
  }

  registerDropTarget(
    id: NodeId,
    el: Element,
    canAccept?: (sourceId: NodeId) => boolean,
    options?: DropTargetOptions,
  ): () => void {
    this.elements.set(id, el);
    const off = this.engine.addDropTarget(id, {
      bounds: () => rectOf(el),
      depth: () => ancestorDepth(el),
      ...(canAccept ? { canAccept } : {}),
      ...(options?.getInsertionIndex ? { getInsertionIndex: options.getInsertionIndex } : {}),
      ...(options?.getDropIntent ? { getDropIntent: options.getDropIntent } : {}),
      ...(options?.scrollEl
        ? {
            scroll: {
              bounds: () => rectOf(options.scrollEl as Element),
              by: (dx: number, dy: number) => {
                const box = options.scrollEl as Element;
                box.scrollLeft += dx;
                box.scrollTop += dy;
              },
              ...(options.edgeScroll ? { options: options.edgeScroll } : {}),
            },
          }
        : {}),
    });
    return () => {
      this.elements.delete(id);
      off();
    };
  }

  tryBegin(sourceId: NodeId): boolean {
    return this.engine.tryBegin(sourceId);
  }

  /** Hand this container's child order to the host. See
   *  `DragEngine.registerOrderControl`. */
  registerOrderControl(id: NodeId, commit: ChildOrderCommit): () => void {
    return this.engine.registerOrderControl(id, commit);
  }

  updateHoverByPoint(x: number, y: number): void {
    this.engine.updateHoverByPoint(x, y);
  }

  drop(): void {
    this.engine.drop();
  }

  cancel(reason: DragCancelReason = 'outside'): void {
    this.engine.cancel(reason);
  }

  /** Stamp `data-drop-target` / `data-drop-rejected` onto the hovered element
   *  so CSS can paint affordances. Clears them on hover-leave / drop / cancel. */
  private reflectHover(state: DragState | null): void {
    const next = state?.hover ?? null;
    if (this.stamped !== null && this.stamped !== next?.targetId) {
      const prev = this.elements.get(this.stamped);
      prev?.removeAttribute('data-drop-target');
      prev?.removeAttribute('data-drop-rejected');
    }
    this.stamped = next?.targetId ?? null;
    if (!next) return;
    const el = this.elements.get(next.targetId);
    if (!el) return;
    el.setAttribute(next.accepted ? 'data-drop-target' : 'data-drop-rejected', 'true');
    el.removeAttribute(next.accepted ? 'data-drop-rejected' : 'data-drop-target');
  }

  private bindEscape(): void {
    if (this.escapeBound || typeof window === 'undefined') return;
    window.addEventListener('keydown', this.onKey);
    this.escapeBound = true;
  }

  private unbindEscape(): void {
    if (!this.escapeBound || typeof window === 'undefined') return;
    window.removeEventListener('keydown', this.onKey);
    this.escapeBound = false;
  }

  /** Window-level pointerup safety net. The DragHandle's onPointerUp is the
   *  primary drop trigger, but setPointerCapture can be silently lost (cursor
   *  leaves the window, the captured element gets unmounted by a re-render,
   *  browser edge cases). Without this fallback, a missed pointerup leaves
   *  the controller permanently active — ghost stuck, future drags rejected. */
  private bindWindowUp(): void {
    if (this.windowUpBound || typeof window === 'undefined') return;
    window.addEventListener('pointerup', this.onWindowPointerUp);
    window.addEventListener('pointercancel', this.onWindowPointerUp);
    this.windowUpBound = true;
  }

  private unbindWindowUp(): void {
    if (!this.windowUpBound || typeof window === 'undefined') return;
    window.removeEventListener('pointerup', this.onWindowPointerUp);
    window.removeEventListener('pointercancel', this.onWindowPointerUp);
    this.windowUpBound = false;
  }

  private onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') this.cancel('escape');
  };

  private onWindowPointerUp = (): void => {
    if (!this.state()) return;
    trace('dnd', 'window pointerup safety net fired — dispatching drop');
    this.drop();
  };
}
