import type { CollapseDrag } from '../collapse.js';
import { cancelOnEscape, watchRelease } from '../gesture-dom.js';
import type { NodeId } from '../node.js';
import type { Store } from '../store.js';
import { trace } from '../trace.js';
import { toLayoutDelta } from '../view.js';
import { elementScale } from '../view-dom.js';
import {
  type AcceptPolicy,
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

/**
 * How one element behaves as a drop target: which container it stands for,
 * which restructuring drops it permits, and any overrides of the built-in
 * hit-test and acceptance rules.
 */
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
  /** Overrides `strategy.canAccept` for this target. See `DropTarget.acceptPolicy`. */
  acceptPolicy?: AcceptPolicy;
}

function rectOf(el: Element): { x: number; y: number; z: number; w: number; h: number } {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, z: 0, w: r.right - r.left, h: r.bottom - r.top };
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
  /**
   * The `<DragProvider splitConfig>` this controller commits a split with.
   * Public because `<Container splitPreview="layout">` lays the preview out
   * with it — reading the same object is what stops the preview and the drop
   * from disagreeing over `gap`.
   */
  readonly splitConfig: Record<string, unknown> | undefined;
  private readonly engine: DragEngine;
  private readonly elements = new Map<NodeId, Element>();
  private stamped: NodeId | null = null;
  private unbindEscape: (() => void) | null = null;
  private unbindRelease: (() => void) | null = null;
  /** The pointer that began the drag, when the host said which. The safety
   *  net ignores every other pointer's release. */
  private pointerId: number | undefined;

  constructor(
    store: Store,
    getStrategy?: StrategyLookup,
    stackConfig?: Record<string, unknown>,
    splitConfig?: Record<string, unknown>,
  ) {
    const options: {
      getStrategy?: StrategyLookup;
      schedule: FrameScheduler;
      stackConfig?: Record<string, unknown>;
      splitConfig?: Record<string, unknown>;
    } = {
      schedule: rafScheduler,
    };
    this.splitConfig = splitConfig;
    if (getStrategy) options.getStrategy = getStrategy;
    if (stackConfig) options.stackConfig = stackConfig;
    if (splitConfig) options.splitConfig = splitConfig;
    this.engine = new DragEngine(store, options);
    // First subscriber, so attributes and window listeners are settled before
    // any consumer listener sees the new state.
    this.engine.subscribe((state) => {
      this.reflectHover(state);
      if (state) {
        this.unbindEscape ??= cancelOnEscape(() => this.cancel('escape'));
        this.bindWindowUp();
      } else {
        this.unbindEscape?.();
        this.unbindEscape = null;
        this.unbindRelease?.();
        this.unbindRelease = null;
        this.pointerId = undefined;
      }
    });
  }

  state(): DragState | null {
    return this.engine.state();
  }

  subscribe(fn: (state: DragState | null) => void): () => void {
    return this.engine.subscribe(fn);
  }

  registerDropTarget(id: NodeId, el: Element, options?: DropTargetOptions): () => void {
    const below = this.elements.get(id);
    this.elements.set(id, el);
    const off = this.engine.addDropTarget(id, {
      bounds: () => rectOf(el),
      depth: () => ancestorDepth(el),
      ...(options?.acceptPolicy ? { acceptPolicy: options.acceptPolicy } : {}),
      ...(options?.getInsertionIndex ? { getInsertionIndex: options.getInsertionIndex } : {}),
      ...(options?.getDropIntent ? { getDropIntent: options.getDropIntent } : {}),
      ...(options?.scrollEl
        ? {
            scroll: {
              bounds: () => rectOf(options.scrollEl as Element),
              // The ramp runs in screen pixels; a scroller inside a scaled view
              // scrolls in its own, so the same rate on screen needs dividing.
              by: (dx: number, dy: number) => {
                const box = options.scrollEl as Element;
                const local = toLayoutDelta(dx, dy, elementScale(box));
                box.scrollLeft += local.dx;
                box.scrollTop += local.dy;
              },
              ...(options.edgeScroll ? { options: options.edgeScroll } : {}),
            },
          }
        : {}),
    });
    return () => {
      // An earlier registration for this id is still standing: hand it back.
      if (this.elements.get(id) === el) {
        if (below && below !== el) this.elements.set(id, below);
        else this.elements.delete(id);
      }
      // The element may stay mounted after it stops being a target, and would
      // keep painting as one.
      if (this.elements.get(id) !== el) {
        el.removeAttribute('data-drop-target');
        el.removeAttribute('data-drop-rejected');
      }
      off();
    };
  }

  /** Start dragging `sourceId`. Pass the `pointerId` of the press that began
   *  it, so another pointer's release elsewhere does not end it. */
  tryBegin(sourceId: NodeId, options?: { pointerId?: number }): boolean {
    // Set first: the engine notifies subscribers, which bind the safety net, inside tryBegin.
    this.pointerId = options?.pointerId;
    if (this.engine.tryBegin(sourceId)) return true;
    if (!this.state()) this.pointerId = undefined;
    return false;
  }

  /** The drag in flight as a collapse policy is told about it. See
   *  `DragEngine.collapseDrag`. */
  collapseDrag(): CollapseDrag | null {
    return this.engine.collapseDrag();
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

  /** Window-level pointerup safety net. The DragHandle's onPointerUp is the
   *  primary drop trigger, but setPointerCapture can be silently lost (cursor
   *  leaves the window, the captured element gets unmounted by a re-render,
   *  browser edge cases). Without this fallback, a missed pointerup leaves
   *  the controller permanently active — ghost stuck, future drags rejected. */
  private bindWindowUp(): void {
    this.unbindRelease ??= watchRelease(this.pointerId, {
      up: () => {
        if (!this.state()) return;
        trace('dnd', 'window pointerup safety net fired — dispatching drop');
        this.drop();
      },
      // The browser took the pointer away (a scroll, a system gesture), which
      // the user did not mean as a release, so nothing commits.
      cancel: () => {
        if (!this.state()) return;
        trace('dnd', 'window pointercancel safety net fired — dispatching cancel');
        this.cancel('outside');
      },
    });
  }
}
