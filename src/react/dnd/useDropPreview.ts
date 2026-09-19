import {
  type CSSProperties,
  type RefObject,
  useCallback,
  useContext,
  useSyncExternalStore,
} from 'react';
import type { LayoutPreview, NodeId, Rect } from '../../index.js';
import { elementScale, toLocalPoint } from '../../index.js';
import { DragContext } from './DragProvider.js';

/** What a prospective split draws. See `<Container splitPreview>`. */
export type SplitPreviewMode = 'none' | 'element' | 'layout';

/** The prospective split a hover resolved to, ready to hand `LayoutPreview`. */
type SplitBag = NonNullable<LayoutPreview['split']>;

/** What a container needs to draw the drop it is hovering: the bag its layout
 *  runs with, and the pieces its render reads back. */
export interface DropPreviewState {
  /** Hand to `useContainerLayout`. Undefined unless this container is the
   *  hover target and the hover was accepted. */
  preview: LayoutPreview | undefined;
  /** The node in flight, while this container is previewing it. */
  sourceId: NodeId | undefined;
  /** The split to draw, or null under `'none'` and for an insert hover. */
  drawSplit: SplitBag | null;
  /** Whether `preview` carries the split — i.e. the placements hold the
   *  post-drop interior rather than the un-split slot. */
  laidOut: boolean;
}

const NOTHING: DropPreviewState = {
  preview: undefined,
  sourceId: undefined,
  drawSplit: null,
  laidOut: false,
};

/**
 * The live drop preview for one container: what its strategy should lay out as
 * if the drop had happened, and what its render should draw over the result.
 *
 * Both `<Container>` and the container presets run this, so a split aimed at a
 * preset previews exactly as one aimed at a `<Container>` does.
 */
export function useDropPreview(
  parentId: NodeId,
  mode: SplitPreviewMode,
  boxRef?: RefObject<Element | null>,
): DropPreviewState {
  const controller = useContext(DragContext);
  const dragState = useSyncExternalStore(
    useCallback((cb) => (controller ? controller.subscribe(cb) : () => {}), [controller]),
    useCallback(() => (controller ? controller.state() : null), [controller]),
    useCallback(() => null, []),
  );

  const hover =
    dragState?.hover?.targetId === parentId && dragState.hover.accepted ? dragState.hover : null;
  // A tear lands at the cursor, free of the layout, so there is no slot to open.
  if (!hover || !dragState || hover.tear) return NOTHING;

  const intent = hover.intent?.kind === 'split' ? hover.intent : null;
  const split: SplitBag | null = intent
    ? {
        ontoId: intent.ontoId,
        edge: intent.edge,
        axis: intent.axis,
        ...(controller?.splitConfig ? { config: controller.splitConfig } : {}),
      }
    : null;
  const laidOut = mode === 'layout' && split !== null;

  return {
    preview: {
      insertId: dragState.draggingId,
      ...(hover.insertIndex !== undefined ? { insertIndex: hover.insertIndex } : {}),
      cursor: localCursor(dragState.cursor, boxRef?.current ?? null),
      ...(laidOut && split ? { split } : {}),
    },
    sourceId: dragState.draggingId,
    drawSplit: mode === 'none' ? null : split,
    laidOut,
  };
}

/**
 * The drag cursor in the container's own layout pixels, which is what
 * `LayoutPreview.cursor` promises a strategy. The drag samples screen pixels;
 * under a view those differ by the box's offset and scale.
 */
function localCursor(cursor: { x: number; y: number }, box: Element | null) {
  if (!box) return cursor;
  const r = box.getBoundingClientRect();
  return toLocalPoint(cursor, { x: r.left, y: r.top }, elementScale(box));
}

const CHILD_BASE: CSSProperties = { position: 'absolute' };

/**
 * Where to draw the shaded half a prospective split would hand the dragged
 * node. Geometry comes from the placements the children are already positioned
 * in, so a hover costs no second measurement.
 *
 * Which placement differs by mode: under `'layout'` the source already holds
 * the interior half, while under `'element'` the onto-child still holds the
 * whole slot and the half has to be derived from it.
 */
export function splitPreviewStyle(
  placements: ReadonlyMap<NodeId, Rect>,
  state: DropPreviewState,
): CSSProperties | null {
  const { drawSplit, sourceId, laidOut } = state;
  if (!drawSplit) return null;
  const half = laidOut && sourceId ? placements.get(sourceId) : undefined;
  if (half) {
    return { ...CHILD_BASE, left: half.x, top: half.y, width: half.w, height: half.h };
  }
  const onto = placements.get(drawSplit.ontoId as NodeId);
  if (!onto) return null;
  return drawSplit.axis === 'y'
    ? {
        ...CHILD_BASE,
        left: onto.x,
        width: onto.w,
        height: onto.h / 2,
        top: drawSplit.edge === 'start' ? onto.y : onto.y + onto.h / 2,
      }
    : {
        ...CHILD_BASE,
        top: onto.y,
        height: onto.h,
        width: onto.w / 2,
        left: drawSplit.edge === 'start' ? onto.x : onto.x + onto.w / 2,
      };
}
