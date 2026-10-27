import {
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { cancelOnEscape } from '../gesture-dom.js';
import {
  type Affordance,
  type AxisScale,
  accessibleName,
  commitReveal,
  elementScale,
  type NodeId,
  toLayoutDelta,
  trace,
  trackReveal,
} from '../index.js';
import type { Store } from '../store.js';
import { CLICK_RESET, hitArea } from './affordance-hit.js';
import { preventNativeDrag } from './dnd/nativeDrag.js';
import { useGesture } from './useGesture.js';

export interface RevealHandleProps {
  affordance: Affordance;
  store: Store;
  hitPad: number;
  tabStop: boolean;
  label: string | undefined;
  onActiveChange: (active: boolean) => void;
}

/**
 * The handle over a hidden pane's slot. Dragged the way the pane opens it arms,
 * and releasing there shows the pane; Enter or Space shows it outright. A
 * pointer click does nothing, so it listens for the keys rather than `click`.
 * It sends the strategy nothing: there is no size to write until the pane is
 * back.
 */
export function RevealHandle({
  affordance,
  store,
  hitPad,
  tabStop,
  label,
  onActiveChange,
}: RevealHandleProps) {
  const reveal = affordance.reveal;
  const last = useRef<{ x: number; y: number } | null>(null);
  const scale = useRef<AxisScale>({ x: 1, y: 1 });
  const travel = useRef(0);
  const [dragging, setDragging] = useState(false);
  const name = reveal ? accessibleName(store, reveal.id as NodeId) : '';
  const [gesture, { armed, message }] = useGesture<string>({
    name: `reveal ${affordance.id}`,
    commit: () => commitReveal(store, affordance),
    describe: () => `${name} will show. Release to confirm, Escape to cancel.`,
    onEnd: () => {
      travel.current = 0;
      last.current = null;
      setDragging(false);
    },
  });

  const endGesture = useCallback(
    (commit: boolean, reason = 'pointercancel') => {
      if (commit) gesture.release();
      else gesture.cancel(reason);
    },
    [gesture],
  );

  const step = useCallback(
    (clientX: number, clientY: number) => {
      if (!last.current || !reveal) return;
      const sx = clientX - last.current.x;
      const sy = clientY - last.current.y;
      if (sx === 0 && sy === 0) return;
      last.current = { x: clientX, y: clientY };
      const { dx, dy } = toLayoutDelta(sx, sy, scale.current);
      const state = trackReveal({
        reveal,
        travel: travel.current,
        delta: affordance.kind === 'resize-y' ? dy : dx,
      });
      travel.current = state.travel;
      gesture.offer(state.armed ? reveal.id : null);
    },
    [reveal, affordance.kind, gesture],
  );
  const unlisten = useRef<(() => void) | null>(null);
  const finish = useCallback(
    (target: HTMLButtonElement, pointerId: number, commit: boolean) => {
      unlisten.current?.();
      unlisten.current = null;
      const wasDragging = last.current !== null;
      try {
        target.releasePointerCapture(pointerId);
      } catch {
        // ignore
      }
      endGesture(commit);
      if (wasDragging) onActiveChange(false);
    },
    [onActiveChange, endGesture],
  );
  useEffect(() => () => unlisten.current?.(), []);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLButtonElement>) => {
      gesture.cancel('pressed again');
      gesture.begin();
      last.current = { x: e.clientX, y: e.clientY };
      scale.current = elementScale(e.currentTarget);
      setDragging(true);
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // jsdom or unsupported — ignore.
      }
      // WebKit gives a press in its overlay scrollbar's strip to the scrollbar: no capture or
      // pointermove follows and the pointerup can land elsewhere, so the release is read here.
      unlisten.current?.();
      const target = e.currentTarget;
      const { pointerId } = e;
      const onUp = (up: PointerEvent) => {
        if (up.pointerId !== pointerId) return;
        step(up.clientX, up.clientY);
        trace('dnd', `reveal release: ${affordance.id} travel ${travel.current}`);
        finish(target, pointerId, true);
      };
      window.addEventListener('pointerup', onUp, true);
      unlisten.current = () => window.removeEventListener('pointerup', onUp, true);
      onActiveChange(true);
    },
    [onActiveChange, step, finish, affordance.id, gesture],
  );
  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLButtonElement>) => step(e.clientX, e.clientY),
    [step],
  );
  const onPointerCancel = useCallback(
    (e: ReactPointerEvent<HTMLButtonElement>) => finish(e.currentTarget, e.pointerId, false),
    [finish],
  );

  useEffect(() => {
    if (!dragging) return;
    return cancelOnEscape(() => {
      unlisten.current?.();
      unlisten.current = null;
      endGesture(false, 'escape');
      onActiveChange(false);
    });
  }, [dragging, endGesture, onActiveChange]);

  const onKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLButtonElement>) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      commitReveal(store, affordance);
    },
    [store, affordance],
  );

  const { outerStyle, innerStyle } = hitArea(affordance, hitPad, reveal?.direction);

  return (
    <>
      <button
        type="button"
        className="windease-affordance-hit"
        style={{ ...CLICK_RESET, ...outerStyle }}
        data-affordance-hit={affordance.id}
        data-reveal-armed={armed !== null ? 'true' : undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerCancel={onPointerCancel}
        draggable={false}
        onDragStart={preventNativeDrag}
        onKeyDown={onKeyDown}
        tabIndex={tabStop ? 0 : -1}
        aria-label={label}
      >
        <span
          style={innerStyle}
          data-affordance={affordance.id}
          data-affordance-kind={affordance.kind}
        />
      </button>
      <div
        className="windease-live-region"
        aria-live="polite"
        aria-atomic="true"
        data-reveal-live=""
      >
        {message}
      </div>
    </>
  );
}
