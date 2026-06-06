import type { NodeId } from '@windease/core';
import { type CSSProperties, type ReactNode, useRef } from 'react';
import { useChildren, useNode } from './hooks.js';
import { NodeRenderer, type ChromeMap } from './NodeRenderer.js';
import { useContainerLayout } from './useContainerLayout.js';

export interface NodeContainerProps {
  parentId: NodeId;
  chrome: ChromeMap;
  /** Fixed viewport; if omitted the wrapper measures via ResizeObserver. */
  viewport?: { w: number; h: number };
  className?: string;
  style?: CSSProperties;
  /** Render slot for overlays (drop indicators, etc.). */
  overlay?: ReactNode;
  /**
   * Settle animation duration in ms for children moving between placements.
   * Set to 0 to disable. Default 150ms. The library only animates position
   * (left/top/width/height); chrome handlers can layer their own.
   */
  settleMs?: number;
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
 * Pair with `<WindeaseNodeRoot>` for top-level layout, or use directly for
 * a container nested inside another component.
 */
export function NodeContainer({
  parentId,
  chrome,
  viewport,
  className,
  style,
  overlay,
  settleMs = DEFAULT_SETTLE_MS,
}: NodeContainerProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const parent = useNode(parentId);
  const children = useChildren(parentId);
  const layout = useContainerLayout(parentId, ref, viewport);

  const containerStyle: CSSProperties = viewport
    ? { ...CONTAINER_BASE, width: viewport.w, height: viewport.h, ...style }
    : { ...CONTAINER_BASE, width: '100%', height: '100%', ...style };

  if (!parent?.container) {
    return (
      <div
        ref={ref}
        className={className}
        style={containerStyle}
        data-node-container={parentId}
      />
    );
  }

  return (
    <div
      ref={ref}
      className={className}
      style={containerStyle}
      data-node-container={parentId}
    >
      {children.map((child) => {
        const rect = layout.placements.get(child.id);
        if (!rect) return null;
        if (child.lifecycle.state !== 'visible') return null;
        const childStyle: CSSProperties = {
          ...CHILD_BASE,
          left: rect.x,
          top: rect.y,
          width: rect.w,
          height: rect.h,
        };
        if (settleMs > 0) {
          childStyle.transition = `left ${settleMs}ms ease, top ${settleMs}ms ease, width ${settleMs}ms ease, height ${settleMs}ms ease`;
        }
        return (
          <div key={child.id} style={childStyle} data-node={child.id}>
            <NodeRenderer id={child.id} chrome={chrome} />
          </div>
        );
      })}
      {overlay}
    </div>
  );
}
