import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  axisFromRects,
  childRectsForContainer,
  insertionIndexByMidpoint,
} from '../dnd/insertionIndex.js';
import { accessibleName, type ChildOrderCommit, type NodeId } from '../index.js';
import { AffordanceLayer, type AffordanceRenderer } from './affordances.js';
import { DragContext } from './dnd/DragProvider.js';
import { useFocusBinding } from './focus/FocusProvider.js';
import { useGeometryRegistry } from './focus/useGeometrySource.js';
import { useChildren, useFocusedNode, useNode } from './hooks.js';
import { MeasuredContent } from './measure.js';
import { type Chrome, NodeRenderer } from './NodeRenderer.js';
import { useStore } from './Provider.js';
import {
  type ContainerLayout,
  scrollExtentStyle,
  useContainerLayout,
} from './useContainerLayout.js';

/** Live layout snapshot passed to function-form `overlay` callbacks. */
export interface OverlayContext extends ContainerLayout {
  /** ID of the affordance currently being dragged, or null. */
  draggingAffordanceId: string | null;
}
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

  const isFlow = layout.mode === 'flow';
  const childKey = children.map((c) => String(c.id)).join('|');
  const flowRects = useRef<string[]>([]);

  // In flow the browser owns the arrangement, so the rects the focus resolver
  // needs come from measurement rather than from placements. Composed against
  // this container's own origin so both modes report into one space.
  const measureFlow = useCallback(() => {
    const el = ref.current;
    if (!el || !geometryRegistry) return;
    const self = el.getBoundingClientRect();
    const origin = geometryRegistry.rects.get(String(parentId));
    const originX = (origin?.x ?? 0) - self.x;
    const originY = (origin?.y ?? 0) - self.y;
    flowRects.current = [];
    for (const child of childRectsForContainer(el)) {
      flowRects.current.push(child.id);
      geometryRegistry.rects.set(child.id, {
        x: originX + child.rect.x,
        y: originY + child.rect.y,
        w: child.rect.width,
        h: child.rect.height,
      });
    }
    geometryRegistry.commit();
  }, [geometryRegistry, parentId]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: childKey re-observes when the child set changes; it is never read.
  useEffect(() => {
    if (!isFlow || !geometryRegistry) return;
    const el = ref.current;
    if (!el) return;
    measureFlow();
    const forget = () => {
      for (const cid of flowRects.current) geometryRegistry.rects.delete(cid);
      flowRects.current = [];
      geometryRegistry.commit();
    };
    // Same degradation as the viewport observer: measure once and hold there
    // rather than fail.
    if (typeof ResizeObserver === 'undefined') return forget;
    const ro = new ResizeObserver(measureFlow);
    ro.observe(el);
    for (const k of Array.from(el.querySelectorAll('[data-node]'))) ro.observe(k);
    return () => {
      ro.disconnect();
      forget();
    };
  }, [isFlow, geometryRegistry, childKey, measureFlow]);

  // A class toggle can move a pane without resizing anything, which no
  // observer reports. Re-measuring per commit covers every such change that
  // React drove; the observers cover the ones it did not.
  useEffect(() => {
    if (isFlow) measureFlow();
  });

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
    return dragController.registerDropTarget(parentId, el, undefined, {
      getInsertionIndex: (point) => {
        const rects = childRectsForContainer(el);
        if (rects.length === 0) return 0;
        // Skip the source itself for same-parent previews.
        const sourceId = dragController.state()?.draggingId;
        const filtered = sourceId ? rects.filter((r) => r.id !== sourceId) : rects;
        // A flow container has no strategy to infer an axis from and no reason
        // to have set one, so read it off the arrangement CSS produced.
        const axis: 'x' | 'y' =
          cfg.axis ?? (isFlow ? axisFromRects(filtered) : strategyId === 'strip' ? 'x' : 'y');
        const main = axis === 'y' ? point.y : point.x;
        return insertionIndexByMidpoint(
          filtered.map((r) => r.rect),
          main,
          axis,
        );
      },
    });
  }, [dragController, parentId, parent?.container?.strategyId, parent?.container?.config, isFlow]);

  // Track which affordance is currently being dragged (if any) so we can
  // suppress the settle transition (cursor IS the motion) AND expose the id
  // to overlay/affordance render functions.
  const [draggingAffordanceId, setDraggingAffordanceId] = useState<string | null>(null);
  const reducedMotion =
    typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const effectiveSettleMs = draggingAffordanceId !== null || reducedMotion ? 0 : settleMs;

  const containerStyle: CSSProperties = viewport
    ? {
        ...CONTAINER_BASE,
        width: viewport.w,
        height: viewport.h,
        ...scrollExtentStyle(layout),
        ...style,
      }
    : { ...CONTAINER_BASE, width: '100%', height: '100%', ...scrollExtentStyle(layout), ...style };

  if (!parent?.container || !chrome) {
    return (
      <div ref={ref} className={className} style={containerStyle} data-node-container={parentId} />
    );
  }

  const renderedOverlay =
    typeof overlay === 'function'
      ? (overlay as OverlayRenderer)({ ...layout, draggingAffordanceId })
      : overlay;

  // Flow: no placements to read, so every visible child renders in order and
  // the consumer's CSS arranges them. No affordances, no settle transition,
  // and no `sizing` measurement — all three need the strategy pass.
  if (isFlow) {
    return (
      <div ref={ref} className={className} style={containerStyle} data-node-container={parentId}>
        {children
          .filter((c) => c.lifecycle.state === 'visible')
          .map((c) => (
            // biome-ignore lint/a11y/useSemanticElements: <fieldset> carries form semantics and UA styling; this is a layout pane.
            <div
              key={c.id}
              data-node={c.id}
              tabIndex={rovingId === c.id ? 0 : -1}
              role="group"
              aria-label={accessibleName(store, c.id)}
            >
              <NodeRenderer id={c.id} chrome={chrome} />
            </div>
          ))}
        {renderedOverlay}
      </div>
    );
  }

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
      <AffordanceLayer
        render={affordances}
        affordances={layout.affordances}
        dispatch={layout.dispatchAffordance}
        store={store}
        hitPad={affordanceHitPad}
        keyStep={affordanceKeyStep}
        tabStop={affordanceTabStops}
        onActiveChange={setDraggingAffordanceId}
      />
      {renderedOverlay}
    </div>
  );
}
