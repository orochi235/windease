import type { CSSProperties, ReactNode } from 'react';
import type { NodeId } from '../../index.js';
import { useDragHandle } from './useDragHandle.js';

export interface DragHandleProps {
  nodeId: NodeId;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}

/** @group Components */
export function DragHandle({ nodeId, children, className, style }: DragHandleProps) {
  const handlers = useDragHandle(nodeId);
  return (
    <div
      className={className}
      style={style}
      data-windease-drag-handle={nodeId}
      onPointerDown={handlers.onPointerDown}
      onPointerMove={handlers.onPointerMove}
      onPointerUp={handlers.onPointerUp}
      onPointerCancel={handlers.onPointerCancel}
    >
      {children}
    </div>
  );
}
