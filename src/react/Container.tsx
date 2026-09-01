import {
  type CSSProperties,
  type ReactNode,
  type RefObject,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type { AcceptContext } from '../dnd/DragEngine.js';
import type { DropIntent } from '../dnd/dropIntent.js';
import type { EdgeScrollOptions } from '../dnd/edgeScroll.js';
import { accessibleName, type ChildOrderCommit, type NodeId } from '../index.js';

export type { DropIntentContext } from './dnd/useDropIntentTarget.js';

import { AffordanceLayer, type AffordanceRenderer } from './affordances.js';
import { DragContext } from './dnd/DragProvider.js';
import { type DropIntentContext, useDropIntentTarget } from './dnd/useDropIntentTarget.js';
import { useFocusBinding } from './focus/FocusProvider.js';
import { useFlowGeometry } from './focus/useFlowGeometry.js';
import { usePublishGeometry } from './focus/usePublishGeometry.js';
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
  /**
   * Let a drop onto the middle of a child stack the two into one tabbed
   * container rather than inserting beside it. Off by default: the gesture
   * restructures the tree, and a consumer with no tab strip drawn would end up
   * with children it cannot reach.
   */
  stackOnDrop?: boolean;
  /**
   * Let a drop in a cross-axis band of a child split that child: the child's
   * slot becomes a two-pane strip holding it and the dropped node. Off by
   * default, like `stackOnDrop`, because it restructures the tree.
   *
   * With `stackOnDrop` off the centre of a child still resolves to an insert —
   * the centre band is only carved for stacking — which is the "edges split,
   * everything else inserts" model a consumer without tabs wants.
   */
  splitOnDrop?: boolean;
  /**
   * What a prospective split draws.
   *
   * `'layout'` (default) lays the destination out as if the drop had happened:
   * the onto-pane shrinks to the half it will actually get and the dragged
   * node's rect fills the other, both placed by the strategy the group will be
   * created with. `'element'` leaves the onto-pane full-size and only draws
   * over it. Both position a `div.windease-split-preview` on the half the
   * dragged node would take; restyle it through that class.
   *
   * `'none'` draws nothing, for consumers drawing their own through
   * `<DragProvider dragOverlay>`, whose context already carries the intent.
   */
  splitPreview?: 'none' | 'element' | 'layout';
  /**
   * Replace the built-in drop hit-test. Receives the measured child rects with
   * the dragged node already removed, the cursor, this container's own axis,
   * and the dragged node's id; returns what the drop means.
   *
   * The default is
   * `resolveDropIntent(rects, point, axis, { stack: stackOnDrop, split: splitOnDrop })`.
   * Use this to change band thickness, add quadrant zones, or refuse an intent
   * on small panes — `resolveDropIntent` is exported, so a tweak is one call.
   */
  dropIntent?: (ctx: DropIntentContext) => DropIntent | undefined;
  /**
   * The element that scrolls this container's content — the wrapper carrying
   * `overflow: auto`, not the box itself. Reports its offset so a pane's
   * visible position is what keyboard navigation compares. Without it a
   * scrolled container navigates against unscrolled positions.
   */
  scrollRef?: RefObject<Element | null>;
  /**
   * Decide whether this container accepts a drop, overriding the strategy's
   * own `canAccept`. `true` accepts where the strategy would refuse, `false`
   * refuses, `undefined` defers to it. A `lock.accept` refuses regardless.
   *
   * Runs on every drag `pointermove` — keep it O(items.length) or smaller.
   */
  acceptPolicy?: (ctx: AcceptContext) => boolean | undefined;
  /** Ramp shape for edge scrolling during a drag. Inert without `scrollRef`. */
  edgeScroll?: EdgeScrollOptions;
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
  scrollRef,
  className,
  style,
  overlay,
  settleMs = DEFAULT_SETTLE_MS,
  affordances = false,
  affordanceHitPad = 4,
  affordanceKeyStep = 8,
  affordanceTabStops = true,
  onChildOrderChange,
  stackOnDrop = false,
  splitOnDrop = false,
  splitPreview = 'layout',
  dropIntent,
  acceptPolicy,
  edgeScroll,
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
  const hover =
    dragState?.hover?.targetId === parentId && dragState.hover.accepted ? dragState.hover : null;
  const splitIntent = hover?.intent?.kind === 'split' ? hover.intent : null;
  const previewSplit =
    splitPreview === 'layout' && splitIntent
      ? {
          ontoId: splitIntent.ontoId,
          edge: splitIntent.edge,
          axis: splitIntent.axis,
          ...(dragController?.splitConfig ? { config: dragController.splitConfig } : {}),
        }
      : undefined;
  const preview =
    hover && dragState
      ? {
          insertId: dragState.draggingId,
          ...(hover.insertIndex !== undefined ? { insertIndex: hover.insertIndex } : {}),
          cursor: dragState.cursor,
          ...(previewSplit ? { split: previewSplit } : {}),
        }
      : undefined;

  const layout = useContainerLayout(parentId, ref, viewport, preview);

  usePublishGeometry(parentId, ref, layout);

  const isFlow = layout.mode === 'flow';
  const childKey = children.map((c) => String(c.id)).join('|');
  useFlowGeometry(parentId, ref, isFlow, childKey);

  const observeScroll = layout.observeScroll;
  useEffect(() => {
    const el = scrollRef?.current;
    if (!el) return;
    return observeScroll(el);
  }, [scrollRef, observeScroll]);

  useEffect(() => {
    if (!dragController || !onChildOrderChange) return;
    return dragController.registerOrderControl(parentId, onChildOrderChange);
  }, [dragController, parentId, onChildOrderChange]);

  const containerCfg = (parent?.container?.config ?? {}) as { axis?: 'x' | 'y' };
  useDropIntentTarget(parentId, ref, {
    ...(containerCfg.axis ? { axis: containerCfg.axis } : {}),
    ...(parent?.container?.strategyId ? { strategyId: parent.container.strategyId } : {}),
    isFlow,
    stackOnDrop,
    splitOnDrop,
    ...(dropIntent ? { dropIntent } : {}),
    ...(scrollRef ? { scrollRef } : {}),
    ...(acceptPolicy ? { acceptPolicy } : {}),
    ...(edgeScroll ? { edgeScroll } : {}),
  });

  // Track which affordance is currently being dragged (if any) so we can
  // suppress the settle transition (cursor IS the motion) AND expose the id
  // to overlay/affordance render functions.
  const [draggingAffordanceId, setDraggingAffordanceId] = useState<string | null>(null);
  const [joinArmedId, setJoinArmedId] = useState<NodeId | null>(null);
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

  // The half a prospective split would hand the dragged node. Geometry comes
  // from placements, the space the children above are positioned in — no second
  // measurement per pointermove. Which placement differs by mode: under
  // 'layout' the source already holds the interior half, while under 'element'
  // the onto-child still holds the whole slot and the half has to be derived.
  const drawSplit = splitPreview !== 'none' && splitIntent ? splitIntent : null;
  const splitHalf =
    drawSplit && splitPreview === 'layout' && dragState
      ? layout.placements.get(dragState.draggingId)
      : undefined;
  const splitOnto = drawSplit ? layout.placements.get(drawSplit.ontoId as NodeId) : undefined;
  let splitStyle: CSSProperties | null = null;
  if (splitHalf) {
    splitStyle = {
      ...CHILD_BASE,
      left: splitHalf.x,
      top: splitHalf.y,
      width: splitHalf.w,
      height: splitHalf.h,
    };
  } else if (drawSplit && splitOnto) {
    splitStyle =
      drawSplit.axis === 'y'
        ? {
            ...CHILD_BASE,
            left: splitOnto.x,
            width: splitOnto.w,
            height: splitOnto.h / 2,
            top: drawSplit.edge === 'start' ? splitOnto.y : splitOnto.y + splitOnto.h / 2,
          }
        : {
            ...CHILD_BASE,
            top: splitOnto.y,
            height: splitOnto.h,
            width: splitOnto.w / 2,
            left: drawSplit.edge === 'start' ? splitOnto.x : splitOnto.x + splitOnto.w / 2,
          };
  }

  return (
    <div
      ref={ref}
      className={className}
      style={containerStyle}
      data-node-container={parentId}
      data-preview={layout.isPreview ? 'true' : undefined}
      data-split-preview={previewSplit && layout.isPreview ? 'true' : undefined}
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
            data-join-armed={joinArmedId === id ? 'true' : undefined}
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
        onJoinArmChange={setJoinArmedId}
      />
      {splitStyle ? (
        <div className="windease-split-preview" style={splitStyle} aria-hidden="true" />
      ) : null}
      {renderedOverlay}
    </div>
  );
}
