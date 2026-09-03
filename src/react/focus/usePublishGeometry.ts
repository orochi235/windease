import { type RefObject, useCallback, useEffect, useRef, useState } from 'react';
import { type NodeId, type Rect, trace } from '../../index.js';
import { useNode } from '../hooks.js';
import { useGeometryRegistry } from './useGeometrySource.js';

/** Rounding one of `rect` / `scroll` and not the other — zoom, fractional DPR —
 *  moves a document coordinate by up to half a pixel, which is half of
 *  `MIN_NAVIGABLE_PX` and so cannot change what navigation picks. */
const ORIGIN_EPSILON_PX = 0.5;

function sameOrigin(a: Rect, b: Rect): boolean {
  return (
    Math.abs(a.x - b.x) <= ORIGIN_EPSILON_PX &&
    Math.abs(a.y - b.y) <= ORIGIN_EPSILON_PX &&
    Math.abs(a.w - b.w) <= ORIGIN_EPSILON_PX &&
    Math.abs(a.h - b.h) <= ORIGIN_EPSILON_PX
  );
}

/** The part of a `useContainerLayout` result this hook reads. */
export interface PublishableLayout {
  placements: ReadonlyMap<NodeId, Rect>;
  scroll: { x: number; y: number };
}

/**
 * Report `nodeId`'s children to the geometry registry so keyboard navigation
 * can score them by position. Anything that owns child placements calls this:
 * `<Container>` and the `Zone` / `Panel` presets both do.
 *
 * Each child's rect is the container's own origin plus its placement, so a
 * whole tree lands in one coordinate space. A root — a node with no
 * `membership` — has no parent to place it, so it measures `elementRef` and
 * answers for itself in document coordinates. No `GeometryProvider` above
 * makes the whole hook a no-op.
 */
export function usePublishGeometry(
  nodeId: NodeId,
  elementRef: RefObject<Element | null>,
  layout: PublishableLayout,
): void {
  const registry = useGeometryRegistry();
  const node = useNode(nodeId);
  const selfRect = registry?.rects.get(String(nodeId));
  // Ask the store, not the registry: a registry miss is ambiguous during the
  // first commit, because a child's effects run before its parent's.
  const isRoot = node !== undefined && node.membership === undefined;
  const [, bumpOrigin] = useState(0);
  // Guarding against the registry instead would let two containers sharing one
  // id answer each other's writes forever.
  const written = useRef<Rect | null>(null);

  const measureRoot = useCallback(() => {
    if (!isRoot || !registry) return;
    const el = elementRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const next = {
      x: r.x + window.scrollX,
      y: r.y + window.scrollY, z: 0,
      w: r.width,
      h: r.height,
    };
    const key = String(nodeId);
    const prev = written.current;
    if (prev && sameOrigin(prev, next)) return;
    const live = registry.rects.get(key);
    if (live !== undefined && live !== prev) {
      trace('zone', `root origin: ${key} (overwriting another container's rect)`);
    }
    written.current = next;
    registry.rects.set(key, next);
    trace('zone', `root origin: ${key} at ${next.x},${next.y} ${next.w}x${next.h}`);
    registry.commit();
    bumpOrigin((n) => n + 1);
  }, [isRoot, registry, nodeId, elementRef]);

  // Every commit: a class toggle can move a root without resizing anything,
  // which no observer reports.
  useEffect(() => {
    measureRoot();
  });

  // Capture phase so a scroll in any ancestor scroller re-measures, not just
  // the page. Coalesced to one measurement per frame: a scroll burst would
  // otherwise pay a full-registry commit per event.
  const pendingFrame = useRef<number | null>(null);
  useEffect(() => {
    if (!isRoot) return;
    const onViewportChange = () => {
      // Same degradation as the viewport observer: measure straight through
      // rather than fail.
      if (typeof requestAnimationFrame === 'undefined') {
        measureRoot();
        return;
      }
      if (pendingFrame.current !== null) return;
      pendingFrame.current = requestAnimationFrame(() => {
        pendingFrame.current = null;
        measureRoot();
      });
    };
    window.addEventListener('resize', onViewportChange, { passive: true });
    window.addEventListener('scroll', onViewportChange, { passive: true, capture: true });
    return () => {
      window.removeEventListener('resize', onViewportChange);
      window.removeEventListener('scroll', onViewportChange, { capture: true });
      if (pendingFrame.current !== null) {
        cancelAnimationFrame(pendingFrame.current);
        pendingFrame.current = null;
      }
    };
  }, [isRoot, measureRoot]);

  useEffect(() => {
    if (!isRoot || !registry) return;
    const key = String(nodeId);
    return () => {
      written.current = null;
      registry.rects.delete(key);
      registry.commit();
    };
  }, [isRoot, registry, nodeId]);

  const placements = layout.placements;
  const scroll = layout.scroll;
  useEffect(() => {
    if (!registry) return;
    // Placements are unscrolled; the visible position is what the resolver
    // compares. Each container answers for its own offset, so the composed
    // chain lands placed and flow children in the same space.
    const originX = (selfRect?.x ?? 0) - scroll.x;
    const originY = (selfRect?.y ?? 0) - scroll.y;
    for (const [cid, r] of placements) {
      registry.rects.set(String(cid), {
        x: originX + r.x,
        y: originY + r.y, z: 0,
        w: r.w,
        h: r.h,
      });
    }
    registry.commit();
    return () => {
      for (const cid of placements.keys()) registry.rects.delete(String(cid));
      registry.commit();
    };
  }, [registry, placements, scroll, selfRect?.x, selfRect?.y]);
}
