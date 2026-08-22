import {
  type CSSProperties,
  Fragment,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { childRectsForContainer, insertionIndexByMidpoint } from '../dnd/insertionIndex.js';
import { type Affordance, accessibleName, type ChildOrderCommit, type NodeId } from '../index.js';
import { DragContext } from './dnd/DragProvider.js';
import { useFocusBinding } from './focus/FocusProvider.js';
import { useGeometryRegistry } from './focus/useGeometrySource.js';
import { useChildren, useFocusedNode, useNode } from './hooks.js';
import { type Chrome, NodeRenderer } from './NodeRenderer.js';
import { useStore } from './Provider.js';
import { type ContainerLayout, useContainerLayout } from './useContainerLayout.js';

/** Live layout snapshot passed to function-form `overlay` callbacks. */
export interface OverlayContext extends ContainerLayout {
  /** ID of the affordance currently being dragged, or null. */
  draggingAffordanceId: string | null;
}

/** Args passed to function-form `affordances` callbacks. The function fully
 *  replaces the default renderer and is responsible for pointer events; call
 *  `dispatch` with `{ affordanceId, kind, payload }` to drive the strategy. */
export interface AffordanceRenderArgs {
  affordance: Affordance;
  dispatch: ContainerLayout['dispatchAffordance'];
  hitPad: number;
}

export type AffordanceRenderer = (args: AffordanceRenderArgs) => ReactNode;
export type OverlayRenderer = (ctx: OverlayContext) => ReactNode;

export interface ContainerProps {
  /** The container node whose children to render. */
  parentId: NodeId;
  /** A `(args) => ReactNode` handler, or a role-keyed map (see `Chrome`).
   *  Optional when `children` is provided. */
  chrome?: Chrome;
  /** When provided, Container renders these directly and skips the chrome
   *  dispatch. Use this for declarative trees built with Panel/Zone presets.
   *  When omitted, Container reads children from the store and renders each
   *  via `chrome`. */
  children?: ReactNode;
  /** Fixed viewport; omit to auto-measure via ResizeObserver. */
  viewport?: { w: number; h: number };
  className?: string;
  style?: CSSProperties;
  /**
   * Rendered after children + affordances. Pass a function to read the live
   * layout (placements, affordances, viewport, draggingAffordanceId) — useful
   * for drop indicators, debug overlays, or readouts during resize.
   */
  overlay?: ReactNode | OverlayRenderer;
  /**
   * Settle animation duration in ms for children moving between placements.
   * Set to 0 to disable. Default 150. The library only animates position
   * (left/top/width/height); chrome handlers can layer their own.
   */
  settleMs?: number;
  /**
   * Render the strategy's affordances (e.g. strip's resize gutter) as
   * interactive elements. `true` ships the default rect renderer with a
   * widened hit area and auto-suppresses the settle animation during drag.
   *
   * Pass a function to fully replace it per affordance — see
   * `AffordanceRenderArgs`. Custom renderers handle their own pointer
   * events; if you also want settle suppressed during your gestures, set
   * `settleMs={0}` (or condition it via `overlay`'s `draggingAffordanceId`
   * by managing a parallel state).
   *
   * Default false.
   */
  affordances?: boolean | AffordanceRenderer;
  /**
   * When `affordances={true}`, pad the hit area by this many pixels in the
   * perpendicular direction so a 4px gutter becomes a wider grab target.
   * Visual placement (via `data-affordance` styling) is not affected.
   * Default 4.
   */
  affordanceHitPad?: number;
  /**
   * Pixels an arrow key moves a focused resize affordance. `Home` / `End` jump
   * to the affordance's reported minimum / maximum instead. Default 8.
   */
  affordanceKeyStep?: number;
  /**
   * Whether resize affordances are tab stops. Correct per the WAI-ARIA window
   * splitter pattern and tiring in a dock of many panes, where every seam
   * lands between two panels in the tab order. Set false to keep the ARIA and
   * drop the stops. Default true.
   */
  affordanceTabStops?: boolean;
  /**
   * Take ownership of this container's child order. When set, a drop that
   * would change the order calls this with the order it *would* have produced
   * instead of writing it — commit it to your own store and re-render.
   *
   * The controlled counterpart to `preserveStoreOrder`, which keeps a drop
   * without telling the host about it. Only library-mediated gestures are
   * intercepted: `store.reorderInParent` called directly still commits, since
   * that is the host acting on itself.
   */
  onChildOrderChange?: ChildOrderCommit;
}

const AFFORDANCE_BASE: CSSProperties = {
  position: 'absolute',
  touchAction: 'none',
  userSelect: 'none',
  // Sit above sibling panels so the +hitPad slack catches pointer events and
  // wins the cursor against adjacent panel content.
  zIndex: 1,
};

const CONTAINER_BASE: CSSProperties = { position: 'relative' };
const CHILD_BASE: CSSProperties = { position: 'absolute' };

const DEFAULT_SETTLE_MS = 150;

/**
 * Renders a container node's visible children at the placements produced by
 * its registered strategy. Each child is absolute-positioned inside the
 * container at the strategy's rect; the chrome handler for the child's
 * kind decides the actual contents.
 *
 * Pair with `<Root>` for top-level layout, or use directly for
 * a container nested inside another component.
 *
 * @group Components
 */
export function Container(props: ContainerProps) {
  // Declarative-children path: render children directly, skip any strategy
  // hooks (so the consumer doesn't need a StrategyRegistryProvider).
  if (props.children !== undefined) {
    return <DeclarativeContainer {...props} />;
  }
  return <StoreContainer {...props} />;
}

function DeclarativeContainer({
  parentId,
  children: childrenProp,
  viewport,
  className,
  style,
}: ContainerProps) {
  const containerStyle: CSSProperties = viewport
    ? { ...CONTAINER_BASE, width: viewport.w, height: viewport.h, ...style }
    : { ...CONTAINER_BASE, width: '100%', height: '100%', ...style };
  return (
    <div className={className} style={containerStyle} data-node-container={parentId}>
      {childrenProp}
    </div>
  );
}

function StoreContainer({
  parentId,
  chrome,
  viewport,
  className,
  style,
  overlay,
  settleMs = DEFAULT_SETTLE_MS,
  affordances = false,
  affordanceHitPad = 4,
  affordanceKeyStep = 8,
  affordanceTabStops = true,
  onChildOrderChange,
}: ContainerProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const store = useStore();
  const parent = useNode(parentId);
  const children = useChildren(parentId);
  const focusBinding = useFocusBinding();
  const rovingId = useFocusedNode()?.id ?? focusBinding?.entryId ?? null;
  const dragController = useContext(DragContext);
  const dragState = useSyncExternalStore(
    useCallback(
      (cb) => (dragController ? dragController.subscribe(cb) : () => {}),
      [dragController],
    ),
    useCallback(() => (dragController ? dragController.state() : null), [dragController]),
    useCallback(() => null, []),
  );

  // Compute preview from current drag state. Only when this container is
  // the hover target AND the hover is accepted; otherwise preview is omitted.
  const preview =
    dragState?.hover?.targetId === parentId && dragState.hover.accepted
      ? {
          insertId: dragState.draggingId,
          ...(dragState.hover.insertIndex !== undefined
            ? { insertIndex: dragState.hover.insertIndex }
            : {}),
          cursor: dragState.cursor,
        }
      : undefined;

  const layout = useContainerLayout(parentId, ref, viewport, preview);

  const geometryRegistry = useGeometryRegistry();
  const selfRect = geometryRegistry?.rects.get(String(parentId));
  useEffect(() => {
    if (!geometryRegistry) return;
    const originX = selfRect?.x ?? 0;
    const originY = selfRect?.y ?? 0;
    for (const [cid, r] of layout.placements) {
      geometryRegistry.rects.set(String(cid), {
        x: originX + r.x,
        y: originY + r.y,
        w: r.w,
        h: r.h,
      });
    }
    geometryRegistry.commit();
    return () => {
      for (const cid of layout.placements.keys()) geometryRegistry.rects.delete(String(cid));
      geometryRegistry.commit();
    };
  }, [geometryRegistry, layout.placements, selfRect?.x, selfRect?.y]);

  useEffect(() => {
    if (!dragController || !onChildOrderChange) return;
    return dragController.registerOrderControl(parentId, onChildOrderChange);
  }, [dragController, parentId, onChildOrderChange]);

  // Register a default getInsertionIndex on the container element so the
  // controller can resolve cursor → child slot without consumer wiring.
  // Strategy axis is inferred from container.config.axis (defaults to 'y'
  // for stack, 'x' for strip — for grid we leave it undefined and let the
  // strategy's fast path handle it via list order).
  useEffect(() => {
    if (!dragController) return;
    const el = ref.current;
    if (!el) return;
    const cfg = (parent?.container?.config ?? {}) as { axis?: 'x' | 'y' };
    const strategyId = parent?.container?.strategyId;
    const axis: 'x' | 'y' = cfg.axis ?? (strategyId === 'strip' ? 'x' : 'y');
    return dragController.registerDropTarget(parentId, el, undefined, {
      getInsertionIndex: (point) => {
        const rects = childRectsForContainer(el);
        if (rects.length === 0) return 0;
        // Skip the source itself for same-parent previews.
        const sourceId = dragController.state()?.draggingId;
        const filtered = sourceId ? rects.filter((r) => r.id !== sourceId) : rects;
        const main = axis === 'y' ? point.y : point.x;
        return insertionIndexByMidpoint(
          filtered.map((r) => r.rect),
          main,
          axis,
        );
      },
    });
  }, [dragController, parentId, parent?.container?.strategyId, parent?.container?.config]);

  // Track which affordance is currently being dragged (if any) so we can
  // suppress the settle transition (cursor IS the motion) AND expose the id
  // to overlay/affordance render functions.
  const [draggingAffordanceId, setDraggingAffordanceId] = useState<string | null>(null);
  const reducedMotion =
    typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const effectiveSettleMs = draggingAffordanceId !== null || reducedMotion ? 0 : settleMs;

  const containerStyle: CSSProperties = viewport
    ? { ...CONTAINER_BASE, width: viewport.w, height: viewport.h, ...style }
    : { ...CONTAINER_BASE, width: '100%', height: '100%', ...style };

  if (!parent?.container || !chrome) {
    return (
      <div ref={ref} className={className} style={containerStyle} data-node-container={parentId} />
    );
  }

  const renderedOverlay =
    typeof overlay === 'function'
      ? (overlay as OverlayRenderer)({ ...layout, draggingAffordanceId })
      : overlay;

  // During preview, the source's real chrome is suppressed (it appears as the
  // ghost). For same-parent previews, the source is in `children`; for
  // cross-parent previews, it's not — but its rect is in `layout.placements`
  // (we skip rendering chrome for it either way because the ghost handles it).
  const previewSourceId = layout.isPreview ? dragState?.draggingId : undefined;

  // Build the render list = real children ∪ ghost (if cross-parent). For
  // same-parent the ghost id is already a child; for cross-parent we synthesize
  // a placeholder entry so we render the preview rect (but with no chrome —
  // the DragProvider portal-ghost is what the user sees).
  const renderEntries = new Map<NodeId, { isReal: boolean }>();
  for (const c of children) {
    if (c.lifecycle.state !== 'visible') continue;
    renderEntries.set(c.id, { isReal: true });
  }
  if (previewSourceId && !renderEntries.has(previewSourceId)) {
    renderEntries.set(previewSourceId, { isReal: false });
  }

  return (
    <div
      ref={ref}
      className={className}
      style={containerStyle}
      data-node-container={parentId}
      data-preview={layout.isPreview ? 'true' : undefined}
    >
      {Array.from(renderEntries.entries()).map(([id, { isReal }]) => {
        const rect = layout.placements.get(id);
        if (!rect) return null;
        const childStyle: CSSProperties = {
          ...CHILD_BASE,
          left: rect.x,
          top: rect.y,
          width: rect.w,
          height: rect.h,
        };
        if (effectiveSettleMs > 0) {
          childStyle.transition = `left ${effectiveSettleMs}ms ease, top ${effectiveSettleMs}ms ease, width ${effectiveSettleMs}ms ease, height ${effectiveSettleMs}ms ease`;
        }
        // Source during preview: render the chrome with visibility:hidden so
        // it occupies its prospective rect (siblings reflow around it) and
        // the ghost overlay is what the user sees — but the DOM stays alive
        // so the DragHandle's pointer capture isn't broken mid-drag.
        // (Cross-parent previews fall through to the !isReal branch below
        // because the source isn't yet a real child of this container.)
        if (id === previewSourceId && isReal) {
          // Source during preview: render the chrome with opacity:0 so the
          // ghost overlay is what the user "sees" — but the DOM and pointer
          // event flow stay alive (visibility:hidden disables pointer events
          // even on captured elements in some browsers, which freezes the drag).
          return (
            <div
              key={id}
              style={{ ...childStyle, opacity: 0 }}
              data-node={id}
              data-preview-source="true"
            >
              <NodeRenderer id={id} chrome={chrome} />
            </div>
          );
        }
        if (id === previewSourceId) {
          // Cross-parent preview placeholder — source isn't here yet, just
          // reserve the slot.
          return <div key={id} style={childStyle} data-node={id} data-preview-source="true" />;
        }
        if (!isReal) return null;
        return (
          // biome-ignore lint/a11y/useSemanticElements: <fieldset> carries form semantics and UA styling; this is a layout pane.
          <div
            key={id}
            style={childStyle}
            data-node={id}
            tabIndex={rovingId === id ? 0 : -1}
            role="group"
            aria-label={accessibleName(store, id)}
          >
            {store.getNode(id)?.hints?.sizing ? (
              <MeasuredContent
                id={id}
                widthByContent={store.getNode(id)?.hints?.sizing?.w === 'content'}
                observe={layout.observeNatural}
              >
                <NodeRenderer id={id} chrome={chrome} />
              </MeasuredContent>
            ) : (
              <NodeRenderer id={id} chrome={chrome} />
            )}
          </div>
        );
      })}
      {affordances &&
        layout.affordances.map((aff) =>
          typeof affordances === 'function' ? (
            <Fragment key={aff.id}>
              {affordances({
                affordance: aff,
                dispatch: layout.dispatchAffordance,
                hitPad: affordanceHitPad,
              })}
            </Fragment>
          ) : (
            <AffordanceHandle
              key={aff.id}
              affordance={aff}
              dispatch={layout.dispatchAffordance}
              hitPad={affordanceHitPad}
              keyStep={affordanceKeyStep}
              tabStop={affordanceTabStops}
              label={affordanceLabel(store, aff)}
              onActiveChange={(active) => setDraggingAffordanceId(active ? aff.id : null)}
            />
          ),
        )}
      {renderedOverlay}
    </div>
  );
}

/**
 * What a screen reader announces for a gutter. Composed from the panes the
 * affordance moves, using the same naming the focus system uses, so a consumer
 * who set `meta.title` gets a usable name without a second API.
 */
function affordanceLabel(store: ReturnType<typeof useStore>, aff: Affordance): string | undefined {
  const ids = aff.affects ?? (aff.childId ? [aff.childId] : []);
  if (ids.length === 0) return undefined;
  const names = ids.map((id) => accessibleName(store, id as NodeId));
  return `resize ${names.join(' and ')}`;
}

/**
 * Measurement box for `hints.sizing`. The pane wrapper carries the extent the
 * layout just wrote, so measuring it would measure our own output; this div is
 * auto-sized on the axis that asked, and reports what the content needs.
 *
 * The observer is attached in an effect rather than from a callback ref: a
 * ref whose identity changes each render is torn down each render, and the
 * teardown drops the measurement — so the size never sticks and the pane sits
 * at its fallback forever.
 */
function MeasuredContent({
  id,
  widthByContent,
  observe,
  children,
}: {
  id: NodeId;
  widthByContent: boolean;
  observe: ContainerLayout['observeNatural'];
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    return observe(id, el);
  }, [observe, id]);
  return (
    <div
      ref={ref}
      className={widthByContent ? 'windease-measure windease-measure--w' : 'windease-measure'}
    >
      {children}
    </div>
  );
}

interface AffordanceHandleProps {
  affordance: Affordance;
  dispatch: ContainerLayout['dispatchAffordance'];
  hitPad: number;
  keyStep: number;
  tabStop: boolean;
  label: string | undefined;
  onActiveChange: (active: boolean) => void;
}

function AffordanceHandle({
  affordance,
  dispatch,
  hitPad,
  keyStep,
  tabStop,
  label,
  onActiveChange,
}: AffordanceHandleProps) {
  const last = useRef<{ x: number; y: number } | null>(null);
  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      last.current = { x: e.clientX, y: e.clientY };
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // jsdom or unsupported — ignore.
      }
      onActiveChange(true);
    },
    [onActiveChange],
  );
  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!last.current) return;
      const dx = e.clientX - last.current.x;
      const dy = e.clientY - last.current.y;
      if (dx === 0 && dy === 0) return;
      last.current = { x: e.clientX, y: e.clientY };
      // Container-relative pointer, for strategies whose extents are quantized
      // and cannot accumulate a few pixels at a time. Derived from this
      // handle's own box against the rect the strategy gave it, so no ancestor
      // needs measuring.
      const box = e.currentTarget.getBoundingClientRect();
      const point = {
        x: affordance.rect.x - padXRef.current + (e.clientX - box.left),
        y: affordance.rect.y - padYRef.current + (e.clientY - box.top),
      };
      dispatch({ affordanceId: affordance.id, kind: 'drag', payload: { dx, dy, point } });
    },
    [dispatch, affordance.id, affordance.rect.x, affordance.rect.y],
  );
  const onPointerUp = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const wasDragging = last.current !== null;
      last.current = null;
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
      if (wasDragging) onActiveChange(false);
    },
    [onActiveChange],
  );

  const bounds = affordance.bounds;
  const padXRef = useRef(0);
  const padYRef = useRef(0);
  const onKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      if (!bounds) return;
      const horizontal = bounds.orientation === 'horizontal';
      const back = horizontal ? 'ArrowLeft' : 'ArrowUp';
      const fwd = horizontal ? 'ArrowRight' : 'ArrowDown';
      // A strategy whose units are not pixels says how far one press goes;
      // 8 of something is meaningless in cell counts.
      const step = bounds.step ?? keyStep;
      let delta: number;
      if (e.key === back) delta = -step;
      else if (e.key === fwd) delta = step;
      else if (e.key === 'Home') delta = bounds.valueMin - bounds.valueNow;
      else if (e.key === 'End') delta = bounds.valueMax - bounds.valueNow;
      // Anything else — including the perpendicular arrows — bubbles, so pane
      // navigation still works while a gutter holds focus.
      else return;
      e.preventDefault();
      if (delta === 0) return;
      // The same event the pointer sends: the strategy clamps once, where it
      // already clamps.
      dispatch({
        affordanceId: affordance.id,
        kind: 'drag',
        payload: horizontal ? { dx: delta, dy: 0 } : { dx: 0, dy: delta },
      });
    },
    [bounds, dispatch, affordance.id, keyStep],
  );

  // Expand the hit area perpendicular to the gutter so a 4px line is easier
  // to grab. The outer div catches pointer events; the inner div is the
  // visible rect at the strategy's reported size and carries `data-affordance`
  // so consumer CSS styles it (not the invisible padding).
  const isXish =
    affordance.kind === 'drag-x' ||
    affordance.kind === 'drag-xy' ||
    affordance.kind === 'resize-x' ||
    affordance.kind === 'resize-xy';
  const isYish =
    affordance.kind === 'drag-y' ||
    affordance.kind === 'drag-xy' ||
    affordance.kind === 'resize-y' ||
    affordance.kind === 'resize-xy';
  const padX = isXish ? hitPad : 0;
  const padY = isYish ? hitPad : 0;
  padXRef.current = padX;
  padYRef.current = padY;
  const outerStyle: CSSProperties = {
    ...AFFORDANCE_BASE,
    left: affordance.rect.x - padX,
    top: affordance.rect.y - padY,
    width: affordance.rect.w + 2 * padX,
    height: affordance.rect.h + 2 * padY,
  };
  if (affordance.cursor) outerStyle.cursor = affordance.cursor;
  const innerStyle: CSSProperties = {
    position: 'absolute',
    left: padX,
    top: padY,
    width: affordance.rect.w,
    height: affordance.rect.h,
    pointerEvents: 'none',
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: role is separator whenever the key handler is attached; the rule cannot see through the conditional.
    // biome-ignore lint/a11y/useAriaPropsSupportedByRole: same conditional — aria-orientation is set only alongside role="separator", which supports it.
    <div
      style={outerStyle}
      data-affordance-hit={affordance.id}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={bounds ? onKeyDown : undefined}
      role={bounds ? 'separator' : undefined}
      tabIndex={bounds && tabStop ? 0 : undefined}
      aria-orientation={bounds?.orientation}
      aria-valuenow={bounds ? Math.round(bounds.valueNow) : undefined}
      aria-valuemin={bounds ? Math.round(bounds.valueMin) : undefined}
      aria-valuemax={bounds ? Math.round(bounds.valueMax) : undefined}
      aria-label={bounds ? label : undefined}
    >
      <div
        style={innerStyle}
        data-affordance={affordance.id}
        data-affordance-kind={affordance.kind}
      />
    </div>
  );
}
