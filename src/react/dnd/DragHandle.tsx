import type { CSSProperties, ReactNode } from 'react';
import type { NodeId } from '../../index.js';
import { preventNativeDrag } from './nativeDrag.js';
import { useDragHandle } from './useDragHandle.js';

/** Props for {@link DragHandle}. */
export interface DragHandleProps {
  nodeId: NodeId;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  /** Let a touch on the handle scroll the page instead of dragging. Off by
   *  default: the handle sets `touch-action: none` so a finger drags. */
  touchScroll?: boolean;
}

/**
 * Wraps content in an element that starts a drag of `nodeId`. Use it when only
 * part of a panel should be grabbable — a title bar rather than the whole
 * surface, which is what `<Panel draggable>` gives you.
 * @group Components
 */
export function DragHandle({
  nodeId,
  children,
  className,
  style,
  touchScroll = false,
}: DragHandleProps) {
  const handlers = useDragHandle(nodeId);
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: a drag grip carries a pointer gesture rather than acting as a control; the keyboard route to the same move is Shift+arrow on the pane.
    <div
      className={className}
      style={touchScroll ? style : { touchAction: 'none', ...style }}
      data-windease-drag-handle={nodeId}
      onPointerDown={handlers.onPointerDown}
      draggable={false}
      onDragStart={preventNativeDrag}
    >
      {children}
    </div>
  );
}
