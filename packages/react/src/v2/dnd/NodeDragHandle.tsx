import type { NodeId } from '@windease/core';
import type { CSSProperties, ReactNode } from 'react';
import { useNodeDragHandle } from './useNodeDragHandle.js';

export interface NodeDragHandleProps {
  nodeId: NodeId;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}

export function NodeDragHandle({ nodeId, children, className, style }: NodeDragHandleProps) {
  const handlers = useNodeDragHandle(nodeId);
  return (
    <span
      className={className}
      style={style}
      onPointerDown={handlers.onPointerDown}
      onPointerMove={handlers.onPointerMove}
      onPointerUp={handlers.onPointerUp}
      onPointerCancel={handlers.onPointerCancel}
    >
      {children}
    </span>
  );
}
