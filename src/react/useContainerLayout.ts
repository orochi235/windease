import type { CSSProperties } from 'react';
import {
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from 'react';
import type {
  FitMode,
  LayoutEvent,
  LayoutPreview,
  NodeId,
  Overflow,
  PlacementCommit,
  View,
} from '../index.js';
import {
  ContainerHost,
  type ContainerLayout as HostLayout,
  IDENTITY_VIEW,
  observeFit,
  trace,
  viewTransform,
} from '../index.js';
import { useStore } from './Provider.js';
import { useStrategyRegistry } from './strategies.js';

/** The core's `ContainerLayout` plus the React-side dispatchers a host needs
 *  to drive affordances. */
export interface ContainerLayout extends HostLayout {
  /**
   * Feed a strategy event (e.g. drag delta on an affordance) into the
   * container's `reduce()` and persist the new state on the store. State
   * lives in a side-channel map (not snapshotted, not in undo history).
   * No-op when the strategy has no `reduce`.
   */
  dispatchAffordance: (event: LayoutEvent) => void;
  /**
   * Measure `el` as `id`'s content extent for `hints.sizing`. Returns a
   * teardown. Pass an element the layout does not size — see
   * `ContainerHost.observeNatural`.
   */
  observeNatural: (id: NodeId, el: Element) => () => void;
  /**
   * Make `id`'s placement controlled: a gesture hands the bag to `commit`
   * instead of writing the store. See `ContainerHost.registerPlacementControl`.
   */
  registerPlacementControl: (id: NodeId, commit: PlacementCommit) => () => void;
  /**
   * Track `el`'s scroll offset for this container. Returns a teardown. See
   * `ContainerHost.observeScroll` — `el` is the element that actually scrolls,
   * usually a wrapper around the container box rather than the box itself.
   */
  observeScroll: (el: Element) => () => void;
  /** Set the pan and zoom this container is shown at. See `ContainerHost.setView`. */
  setView: (view: View) => void;
}

/**
 * Measure `viewportRef`'s element (or accept an explicit viewport size),
 * resolve the strategy registered for the container's `strategyId`, and
 * return a NodeId-keyed map of placements for the container's visible
 * children. Updates on resize, container config changes, and child changes.
 *
 * A thin wrapper over `ContainerHost`, which owns all of the above and is
 * usable with no React present.
 *
 * @group Hooks
 */
export function useContainerLayout(
  parentId: NodeId,
  viewportRef: RefObject<Element | null> | null,
  fixedViewport?: { w: number; h: number },
  preview?: LayoutPreview,
): ContainerLayout {
  const store = useStore();
  const registry = useStrategyRegistry();

  const host = useMemo(
    () => new ContainerHost(store, parentId, registry),
    [store, parentId, registry],
  );
  useEffect(() => {
    // `host` comes from useMemo, so a StrictMode remount hands back the same
    // instance this cleanup destroyed. Re-attach rather than assume a fresh one.
    host.attach();
    return () => host.destroy();
  }, [host]);

  const fixedW = fixedViewport?.w;
  const fixedH = fixedViewport?.h;
  useEffect(() => {
    if (fixedW !== undefined && fixedH !== undefined) {
      host.setViewport({ w: fixedW, h: fixedH });
      return;
    }
    const el = viewportRef?.current;
    if (!el) return;
    return host.observe(el);
  }, [host, viewportRef, fixedW, fixedH]);

  // Identity of `preview` changes every pointermove; the host dedupes by value.
  const previewKey = preview
    ? `${preview.insertId}|${preview.insertIndex ?? '-'}|${preview.cursor.x}|${preview.cursor.y}` +
      `|${preview.split ? `${preview.split.ontoId}:${preview.split.axis}:${preview.split.edge}` : '-'}`
    : '';
  // biome-ignore lint/correctness/useExhaustiveDependencies: previewKey is a stable identity for `preview`.
  useEffect(() => {
    host.setPreview(preview ?? null);
  }, [host, previewKey]);

  const layout = useSyncExternalStore(host.subscribe, host.layout, host.layout);

  const dispatchAffordance = useCallback(
    (event: LayoutEvent) => host.dispatchAffordance(event),
    [host],
  );

  const observeNatural = useCallback(
    (id: NodeId, el: Element) => host.observeNatural(id, el),
    [host],
  );

  const registerPlacementControl = useCallback(
    (id: NodeId, commit: PlacementCommit) => host.registerPlacementControl(id, commit),
    [host],
  );

  const observeScroll = useCallback((el: Element) => host.observeScroll(el), [host]);

  const setView = useCallback((view: View) => host.setView(view), [host]);

  return {
    ...layout,
    dispatchAffordance,
    observeNatural,
    registerPlacementControl,
    observeScroll,
    setView,
  };
}

/**
 * Feed a container's view from its props: `fit` derives one from `frameRef`'s
 * measured size and the designed `viewport`, otherwise `view` is used as given,
 * and neither leaves the identity. `fit` wins when both are set.
 *
 * A layout effect, so the first paint is already at the fitted scale rather
 * than a frame at full size.
 */
export function useViewBinding(
  setView: (view: View) => void,
  view: View | undefined,
  fit: FitMode | undefined,
  frameRef: RefObject<Element | null>,
  viewport: { w: number; h: number } | undefined,
): void {
  const vx = view?.x;
  const vy = view?.y;
  const vs = view?.scale;
  const vw = viewport?.w;
  const vh = viewport?.h;
  useLayoutEffect(() => {
    if (fit) {
      if (vw === undefined || vh === undefined) {
        trace('layout', `fit="${fit}" ignored: no designed viewport to fit`);
        setView(IDENTITY_VIEW);
        return;
      }
      const el = frameRef.current;
      if (!el) return;
      return observeFit(el, { w: vw, h: vh }, fit, setView);
    }
    setView(
      vx === undefined || vy === undefined || vs === undefined
        ? IDENTITY_VIEW
        : { x: vx, y: vy, scale: vs },
    );
  }, [setView, fit, frameRef, vw, vh, vx, vy, vs]);
}

/** The transform that shows a laid-out box at `view`, or nothing for the
 *  identity so an unviewed container carries no transform at all. */
export function viewStyle(view: View): CSSProperties | undefined {
  const transform = viewTransform(view);
  return transform ? { transform, transformOrigin: '0 0' } : undefined;
}

/**
 * The frame a fitted container is shown in: it takes the space it is given
 * and clips, and the scaled box sits at its top-left. Under `'width'` the
 * height follows the scaled viewport, since nothing else would give it one.
 */
export function fitFrameStyle(
  fit: FitMode,
  viewport: { w: number; h: number } | undefined,
  view: View,
): CSSProperties {
  return {
    position: 'relative',
    overflow: 'hidden',
    width: '100%',
    height: fit === 'width' && viewport ? viewport.h * view.scale : '100%',
  };
}

/** Takes a fitted box out of the frame's flow, so the frame's size is the
 *  space it was given rather than the unscaled box's. */
export const FITTED_BOX: CSSProperties = { position: 'absolute', left: 0, top: 0 };

/**
 * Report `scrollRef`'s offset to the container that laid these children out,
 * so a pane's visible position is what keyboard navigation compares. A ref
 * rather than an element: `.current` is null on the first render.
 */
export function useScrollOffset(
  scrollRef: RefObject<Element | null> | undefined,
  observeScroll: (el: Element) => () => void,
): void {
  useEffect(() => {
    const el = scrollRef?.current;
    if (!el) return;
    return observeScroll(el);
  }, [scrollRef, observeScroll]);
}

/**
 * The CSS transition that animates a child between placements. A sticky child
 * animates its size only: its position tracks the scroll every frame, and an
 * eased `left` would trail behind it.
 */
export function settleTransition(ms: number, sticky: boolean): string {
  const size = `width ${ms}ms ease, height ${ms}ms ease`;
  return sticky ? size : `left ${ms}ms ease, top ${ms}ms ease, ${size}`;
}

/**
 * The box size a layout needs to hold content that exceeds its viewport, for
 * `overflowMode: 'scroll'`. Undefined when nothing overflows, so the common
 * case adds no style at all.
 *
 * The consumer puts `overflow: auto` on a wrapper around this box; without the
 * grown extent there is nothing for that wrapper to scroll. Content at negative
 * coordinates (`overflow.left` / `top`) gets a margin before the box, since a
 * scroller cannot reach anything left of or above its own origin.
 */
export function scrollExtentStyle(
  layout: Pick<ContainerLayout, 'overflow' | 'viewport'>,
): CSSProperties | undefined {
  const { overflow, viewport } = layout;
  if (!overflow || !viewport) return undefined;
  const out: CSSProperties = {};
  if (overflow.w > 0) out.width = viewport.w + overflow.w;
  if (overflow.h > 0) out.height = viewport.h + overflow.h;
  if (overflow.left) out.marginLeft = overflow.left;
  if (overflow.top) out.marginTop = overflow.top;
  return out;
}

/**
 * Hold the container's origin still on screen while the margin
 * {@link scrollExtentStyle} adds for `overflow.left` / `top` changes, by scrolling
 * `scrollRef` by the same amount. Without it, dragging a window past the left
 * edge would push every other window right. Starts from no margin, so a layout
 * that opens with one scrolls to its origin.
 */
export function useOverflowOrigin(
  scrollRef: RefObject<Element | null> | undefined,
  overflow: Overflow | undefined,
): void {
  const left = overflow?.left ?? 0;
  const top = overflow?.top ?? 0;
  const applied = useRef({ left: 0, top: 0 });
  useLayoutEffect(() => {
    const el = scrollRef?.current;
    if (!el) return;
    const dx = left - applied.current.left;
    const dy = top - applied.current.top;
    applied.current = { left, top };
    if (dx !== 0) el.scrollLeft += dx;
    if (dy !== 0) el.scrollTop += dy;
  }, [scrollRef, left, top]);
}
