import { type RefObject, useContext, useEffect, useRef } from 'react';
import type { AcceptPolicy, Point } from '../../dnd/DragEngine.js';
import { type DropIntent, resolveDropIntent } from '../../dnd/dropIntent.js';
import type { EdgeScrollOptions } from '../../dnd/edgeScroll.js';
import { axisFromRects, childRectsForContainer } from '../../dnd/insertionIndex.js';
import { visibleSeamOf } from '../../dnd/seamIndex.js';
import { type NodeId, type Rect, trace } from '../../index.js';
import { layoutPointIn } from '../../view-dom.js';
import { useStore } from '../Provider.js';
import { DragContext } from './DragProvider.js';

/** What a `dropIntent` callback is handed. The container has already measured
 *  and inferred the axis; the callback only decides what the drop means. */
export interface DropIntentContext {
  /** Direct children in DOM order, with the dragged node removed. A strategy
   *  that withholds children (other pages, hidden tabs) draws fewer than are
   *  visible, while an `insert` index counts every visible child. */
  rects: readonly { id: string; rect: Rect }[];
  /** Cursor, in the space the host samples in. */
  point: Point;
  /** This container's own main axis — a split runs across it. */
  axis: 'x' | 'y';
  /** The node being dragged. */
  sourceId: NodeId;
}

export interface DropIntentTargetOptions {
  /** Skip registration. For a caller that must invoke the hook
   *  unconditionally to hold hook order stable. Defaults to true. */
  enabled?: boolean | undefined;
  /** The container's declared main axis, from `container.config.axis`. */
  axis?: 'x' | 'y' | undefined;
  /** Which strategy places the children, for inferring an axis when the
   *  container declared none. */
  strategyId?: string | undefined;
  /** No strategy places these children — CSS does — so the axis is read off
   *  the arrangement produced. */
  isFlow?: boolean | undefined;
  stackOnDrop?: boolean | undefined;
  splitOnDrop?: boolean | undefined;
  dropIntent?: ((ctx: DropIntentContext) => DropIntent | undefined) | undefined;
  /** The empty cell under a point in the container's layout pixels, for
   *  `drop.cell`. A free cell under the cursor wins over an index. */
  cellAt?:
    | ((point: Point, sourceId: NodeId) => { col: number; row: number } | undefined)
    | undefined;
  /** The ref to the element that scrolls this container's content. A ref, not
   *  an element: `.current` is null on the first render and the effect must
   *  read it when it runs. */
  scrollRef?: RefObject<Element | null> | undefined;
  acceptPolicy?: AcceptPolicy | undefined;
  /** Ramp shape for edge scrolling. Inert without `scrollRef`. */
  edgeScroll?: EdgeScrollOptions | undefined;
}

/** `childRectsForContainer` reports DOMRects; the resolver takes plain bounds. */
function domRectToRect(r: DOMRect): Rect {
  return { x: r.left, y: r.top, z: 0, w: r.width, h: r.height };
}

/**
 * Register `parentId`'s element as a drop target that resolves a cursor into a
 * `DropIntent`, rather than one that always appends.
 *
 * The hit-test both `<Container>` and the declarative presets run: harvest the
 * direct chrome children, drop the dragged node from the list, infer the axis,
 * and resolve. A host element publishing no `data-node-container` harvests its
 * grandchildren too — see `childRectsForContainer`.
 */
export function useDropIntentTarget(
  parentId: NodeId,
  ref: RefObject<Element | null>,
  opts: DropIntentTargetOptions = {},
): void {
  const {
    enabled,
    axis: declaredAxis,
    strategyId,
    isFlow,
    stackOnDrop,
    splitOnDrop,
    dropIntent,
    cellAt,
    scrollRef,
    acceptPolicy,
    edgeScroll,
  } = opts;
  const controller = useContext(DragContext);
  const store = useStore();
  // The last harvest taken while nothing was displacing children. A split
  // preview moves a child that is *not* the source, so hit-testing the live
  // DOM would resolve the intent against geometry the preview itself
  // produced — cross into a pane's top band, the pane shrinks out from under
  // the cursor, and the next pointermove reads the drop as an insert.
  // Filtering the source (below) covers an insertion preview; nothing covered
  // this one.
  const undisplaced = useRef<{ id: string; rect: DOMRect }[] | null>(null);
  useEffect(() => {
    if (enabled === false) return;
    if (!controller) return;
    const el = ref.current;
    if (!el) return;
    return controller.registerDropTarget(parentId, el, {
      scrollEl: scrollRef?.current ?? null,
      ...(acceptPolicy ? { acceptPolicy } : {}),
      ...(edgeScroll ? { edgeScroll } : {}),
      getDropIntent: (point) => {
        const live = childRectsForContainer(el);
        const displaced = el.getAttribute('data-split-preview') === 'true';
        if (!displaced) undisplaced.current = live;
        const rects = displaced ? (undisplaced.current ?? live) : live;
        // Skip the source itself for same-parent previews.
        const sourceId = controller.state()?.draggingId;
        if (cellAt && sourceId && !dropIntent) {
          const cell = cellAt(layoutPointIn(point, el), sourceId);
          if (cell) return { kind: 'cell', cell };
        }
        if (rects.length === 0) return { kind: 'insert', index: 0 };
        const filtered = sourceId ? rects.filter((r) => r.id !== sourceId) : rects;
        // A flow container has no strategy to infer an axis from and no reason
        // to have set one, so read it off the arrangement CSS produced.
        const axis: 'x' | 'y' =
          declaredAxis ?? (isFlow ? axisFromRects(filtered) : strategyId === 'strip' ? 'x' : 'y');
        const mapped = filtered.map((r) => ({ id: r.id, rect: domRectToRect(r.rect) }));
        if (dropIntent && sourceId) {
          return dropIntent({ rects: mapped, point, axis, sourceId });
        }
        const intent = resolveDropIntent(mapped, point, axis, {
          ...(stackOnDrop ? { stack: true } : {}),
          ...(splitOnDrop ? { split: true } : {}),
        });
        if (intent.kind !== 'insert') return intent;
        const drawn = mapped.map((r) => r.id);
        const index = visibleSeamOf(store, parentId, sourceId, drawn, intent.index);
        if (index !== intent.index)
          trace(
            'dnd',
            `drop ${parentId}: seam ${intent.index} among drawn → ${index} among visible`,
          );
        return index === intent.index ? intent : { ...intent, index };
      },
    });
  }, [
    controller,
    store,
    parentId,
    ref,
    enabled,
    declaredAxis,
    strategyId,
    isFlow,
    stackOnDrop,
    splitOnDrop,
    dropIntent,
    cellAt,
    scrollRef,
    acceptPolicy,
    edgeScroll,
  ]);
}
