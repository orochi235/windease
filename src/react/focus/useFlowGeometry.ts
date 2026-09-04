import { type RefObject, useCallback, useEffect, useRef } from 'react';
import { childRectsForContainer } from '../../dnd/insertionIndex.js';
import type { NodeId, Rect } from '../../index.js';
import { useGeometryRegistry } from './useGeometrySource.js';

/**
 * Report the children of a container the browser arranged, for the focus
 * resolver to score by position. In flow there are no placements to publish,
 * so the rects come from measuring the DOM instead — composed against the
 * container's own published origin, so flow and placed containers report into
 * one coordinate space.
 *
 * `<Container>` and the `Zone` / `Panel` presets both call this; it is the
 * flow counterpart to `usePublishGeometry`. Pass `enabled: false` and it does
 * nothing, so a placed container can call it unconditionally.
 *
 * `childKey` re-observes when the child set changes; it is never read.
 */
export function useFlowGeometry(
  nodeId: NodeId,
  elementRef: RefObject<Element | null>,
  enabled: boolean,
  childKey: string,
): void {
  const registry = useGeometryRegistry();
  const published = useRef<string[]>([]);
  const composedAgainst = useRef<Rect | null>(null);

  const measure = useCallback(() => {
    const el = elementRef.current;
    if (!el || !registry) return;
    const self = el.getBoundingClientRect();
    const selfOrigin = registry.rects.get(String(nodeId));
    composedAgainst.current = selfOrigin ?? null;
    const originX = (selfOrigin?.x ?? 0) - self.x;
    const originY = (selfOrigin?.y ?? 0) - self.y;
    published.current = [];
    for (const child of childRectsForContainer(el)) {
      published.current.push(child.id);
      registry.rects.set(child.id, {
        x: originX + child.rect.x,
        y: originY + child.rect.y,
        z: 0,
        w: child.rect.width,
        h: child.rect.height,
      });
    }
    registry.commit();
  }, [elementRef, registry, nodeId]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: childKey re-observes when the child set changes; it is never read.
  useEffect(() => {
    if (!enabled || !registry) return;
    const el = elementRef.current;
    if (!el) return;
    measure();
    const forget = () => {
      for (const cid of published.current) registry.rects.delete(cid);
      published.current = [];
      registry.commit();
    };
    // Same degradation as the viewport observer: measure once and hold there
    // rather than fail.
    if (typeof ResizeObserver === 'undefined') return forget;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    for (const k of Array.from(el.querySelectorAll('[data-node]'))) ro.observe(k);
    return () => {
      ro.disconnect();
      forget();
    };
  }, [enabled, registry, childKey, measure, elementRef]);

  // Our own rect is written by whoever places us, whose effects run after
  // ours — so the first measurement composes against an origin that is not
  // there yet, and nothing re-renders us when it arrives. Re-measure when it
  // moves. Safe against a loop: our own commit leaves this origin untouched.
  useEffect(() => {
    if (!enabled || !registry) return;
    return registry.subscribe(() => {
      const now = registry.rects.get(String(nodeId));
      const was = composedAgainst.current;
      if (now?.x === was?.x && now?.y === was?.y) return;
      measure();
    });
  }, [enabled, registry, nodeId, measure]);

  // A class toggle can move a pane without resizing anything, which no
  // observer reports. Re-measuring per commit covers every such change that
  // React drove; the observers cover the ones it did not.
  useEffect(() => {
    if (enabled) measure();
  });
}
