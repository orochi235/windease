import type { Affordance, NodeId } from '../index.js';
import {
  type CSSProperties,
  Fragment,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { useChildren, useNode } from './hooks.js';
import { NodeRenderer, type Chrome } from './NodeRenderer.js';
import { type ContainerLayout, useContainerLayout } from './useContainerLayout.js';
import { DragContext } from './dnd/DragProvider.js';
import { childRectsForContainer, insertionIndexByMidpoint } from './dnd/insertionIndex.js';

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
   *  dispatch. Use this for declarative trees built with <Panel>/<Group>/<Zone>.
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
   * Render the strategy's affordances (e.g. splitStrategy's gutter) as
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
}: ContainerProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const parent = useNode(parentId);
  const children = useChildren(parentId);
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
          cursor: dragState.hover.cursor,
        }
      : undefined;

  const layout = useContainerLayout(parentId, ref, viewport, preview);

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
  const effectiveSettleMs = draggingAffordanceId !== null ? 0 : settleMs;

  const containerStyle: CSSProperties = viewport
    ? { ...CONTAINER_BASE, width: viewport.w, height: viewport.h, ...style }
    : { ...CONTAINER_BASE, width: '100%', height: '100%', ...style };

  if (!parent?.container || !chrome) {
    return (
      <div
        ref={ref}
        className={className}
        style={containerStyle}
        data-node-container={parentId}
      />
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
        // Source during preview: render the rect but skip chrome (the ghost
        // overlay is what the user sees). This keeps the slot reserved so
        // siblings reflow into their preview positions.
        if (id === previewSourceId) {
          return <div key={id} style={childStyle} data-node={id} data-preview-source="true" />;
        }
        if (!isReal) return null;
        return (
          <div key={id} style={childStyle} data-node={id}>
            <NodeRenderer id={id} chrome={chrome} />
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
              onActiveChange={(active) => setDraggingAffordanceId(active ? aff.id : null)}
            />
          ),
        )}
      {renderedOverlay}
    </div>
  );
}

interface AffordanceHandleProps {
  affordance: Affordance;
  dispatch: ContainerLayout['dispatchAffordance'];
  hitPad: number;
  onActiveChange: (active: boolean) => void;
}

function AffordanceHandle({
  affordance,
  dispatch,
  hitPad,
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
      dispatch({ affordanceId: affordance.id, kind: 'drag', payload: { dx, dy } });
    },
    [dispatch, affordance.id],
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

  // Expand the hit area perpendicular to the gutter so a 4px line is easier
  // to grab. The outer div catches pointer events; the inner div is the
  // visible rect at the strategy's reported size and carries `data-affordance`
  // so consumer CSS styles it (not the invisible padding).
  const padX = affordance.kind === 'drag-x' || affordance.kind === 'drag-xy' ? hitPad : 0;
  const padY = affordance.kind === 'drag-y' || affordance.kind === 'drag-xy' ? hitPad : 0;
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
    <div
      style={outerStyle}
      data-affordance-hit={affordance.id}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <div
        style={innerStyle}
        data-affordance={affordance.id}
        data-affordance-kind={affordance.kind}
      />
    </div>
  );
}

