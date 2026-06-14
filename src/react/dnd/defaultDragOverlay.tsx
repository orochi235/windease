import type { CSSProperties, ReactNode } from 'react';
import type { Node, NodeId } from '../../index.js';

export interface DragOverlayContext {
  draggingId: NodeId;
  cursor: { x: number; y: number };
  node: Node | undefined;
  hover: {
    targetId: NodeId;
    accepted: boolean;
    insertIndex?: number;
  } | null;
  rejected: boolean;
}

export type DragOverlayRenderer = (ctx: DragOverlayContext) => ReactNode;

const BASE_STYLE: CSSProperties = {
  position: 'fixed',
  pointerEvents: 'none',
  zIndex: 9999,
  transform: 'translate(-50%, -50%)',
  padding: '6px 10px',
  borderRadius: 4,
  fontSize: 13,
  fontFamily: 'system-ui, sans-serif',
  whiteSpace: 'nowrap',
  userSelect: 'none',
};

const ACCEPTED_STYLE: CSSProperties = {
  background: 'rgba(40, 90, 180, 0.85)',
  color: 'white',
  border: '1px solid rgba(255, 255, 255, 0.6)',
  cursor: 'grabbing',
};

const REJECTED_STYLE: CSSProperties = {
  background: 'rgba(180, 40, 40, 0.85)',
  color: 'white',
  border: '1px solid rgba(255, 220, 220, 0.8)',
  cursor: 'not-allowed',
};

/**
 * Default cursor-following ghost. Shipped as a named export so consumers can
 * compose / wrap / override. Renders a small chip with the node's `meta.title`
 * (falling back to its id), switching to a red `not-allowed` style when the
 * drag would be rejected at the current hover.
 *
 * @group Components
 */
export const defaultDragOverlay: DragOverlayRenderer = ({ draggingId, cursor, node, rejected }) => {
  const label =
    ((node?.meta as Record<string, unknown> | undefined)?.title as string | undefined) ??
    draggingId;
  const style: CSSProperties = {
    ...BASE_STYLE,
    ...(rejected ? REJECTED_STYLE : ACCEPTED_STYLE),
    left: cursor.x,
    top: cursor.y,
  };
  return (
    <div
      data-testid="windease-drag-overlay"
      data-rejected={rejected ? 'true' : 'false'}
      style={style}
    >
      {label}
    </div>
  );
};
