import type { NodeId } from '@windease/core';
import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useCallback,
  useRef,
} from 'react';
import { useChildren, useNode } from './hooks.js';
import { NodeRenderer, type ChromeMap } from './NodeRenderer.js';
import { type ContainerLayout, useContainerLayout } from './useContainerLayout.js';

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
  /**
   * Opt-in: render the strategy's affordances (e.g. binarySplit's gutter)
   * as interactive elements that drive `dispatchAffordance` on pointer drag.
   * Default false. Visual + behavior are coupled — pass a custom `overlay`
   * if you want non-default visuals.
   */
  affordances?: boolean;
  /**
   * Pixels by which each drag affordance's hit area is expanded in the
   * perpendicular direction beyond the visual rect, so a 4px gutter is
   * easier to grab. Visual placement (via `data-affordance` styling) is
   * not affected — only pointer-events. Default 4.
   */
  affordanceHitPad?: number;
}

const AFFORDANCE_BASE: CSSProperties = {
  position: 'absolute',
  touchAction: 'none',
  userSelect: 'none',
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
  affordances = false,
  affordanceHitPad = 4,
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
      {affordances &&
        layout.affordances.map((aff) => (
          <AffordanceHandle
            key={aff.id}
            affordance={aff}
            dispatch={layout.dispatchAffordance}
            hitPad={affordanceHitPad}
          />
        ))}
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

interface AffordanceHandleProps {
  affordance: import('@windease/core').Affordance;
  dispatch: ContainerLayout['dispatchAffordance'];
  hitPad: number;
}

function AffordanceHandle({ affordance, dispatch, hitPad }: AffordanceHandleProps) {
  const last = useRef<{ x: number; y: number } | null>(null);
  const onPointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    last.current = { x: e.clientX, y: e.clientY };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // jsdom or unsupported — ignore.
    }
  }, []);
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
  const onPointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    last.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  }, []);

  // Expand the hit area in the perpendicular direction so a 4px gutter is
  // easier to grab. The visible rect (consumer-styled via [data-affordance])
  // stays at the strategy's reported size via an inner div.
  const padX = affordance.kind === 'drag-x' || affordance.kind === 'drag-xy' ? hitPad : 0;
  const padY = affordance.kind === 'drag-y' || affordance.kind === 'drag-xy' ? hitPad : 0;
  const style: CSSProperties = {
    ...AFFORDANCE_BASE,
    left: affordance.rect.x - padX,
    top: affordance.rect.y - padY,
    width: affordance.rect.w + 2 * padX,
    height: affordance.rect.h + 2 * padY,
  };
  if (affordance.cursor) style.cursor = affordance.cursor;

  return (
    <div
      style={style}
      data-affordance={affordance.id}
      data-affordance-kind={affordance.kind}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    />
  );
}
