import { type ReactNode, useEffect, useRef } from 'react';
import type { NodeId } from '../index.js';
import type { ContainerLayout } from './useContainerLayout.js';

/**
 * Measurement box for `hints.sizing`. The pane wrapper carries the extent the
 * layout just wrote, so measuring it would measure our own output; this div is
 * auto-sized on the axis that asked, and reports what the content needs.
 *
 * The observer is attached in an effect rather than from a callback ref: a
 * ref whose identity changes each render is torn down each render, and the
 * teardown drops the measurement — so the size never sticks and the pane sits
 * at its fallback forever.
 */
export function MeasuredContent({
  id,
  widthByContent,
  observe,
  children,
}: {
  id: NodeId;
  widthByContent: boolean;
  observe: ContainerLayout['observeNatural'];
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    return observe(id, el);
  }, [observe, id]);
  return (
    <div
      ref={ref}
      className={widthByContent ? 'windease-measure windease-measure--w' : 'windease-measure'}
    >
      {children}
    </div>
  );
}
