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
  captureSeam,
  commitBury,
  destroyBlockedBy,
  elementScale,
  type NodeId,
  type SeamCapture,
  toLayoutDelta,
  toLocalPoint,
  trackBury,
} from '../index.js';
import { buryOf } from '../layout/seam-bury.js';
import type { Store } from '../store.js';
import { buryArmed, hitArea, raiseOnPress } from './affordance-hit.js';
import { preventNativeDrag } from './dnd/nativeDrag.js';
import type { ContainerLayout } from './useContainerLayout.js';
import { useGesture } from './useGesture.js';

export type WritePlacement = ContainerLayout['writePlacement'];

function travelKeys(travel: NonNullable<Affordance['travel']>): string {
  return [travel.x && 'ArrowLeft ArrowRight', travel.y && 'ArrowUp ArrowDown']
    .filter(Boolean)
    .join(' ');
}

export interface AffordanceHandleProps {
  affordance: Affordance;
  dispatch: ContainerLayout['dispatchAffordance'];
  store: Store;
  hitPad: number;
  keyStep: number;
  tabStop: boolean;
  label: string | undefined;
  onActiveChange: (active: boolean) => void;
  onBuryArmChange: (victimId: NodeId | null) => void;
  writePlacement: WritePlacement | undefined;
}

export function AffordanceHandle({
  affordance,
  dispatch,
  store,
  hitPad,
  keyStep,
  tabStop,
  label,
  onActiveChange,
  onBuryArmChange,
  writePlacement,
}: AffordanceHandleProps) {
  const last = useRef<{ x: number; y: number } | null>(null);
  // Screen pixels per layout pixel, read once per gesture: a view that zooms
  // mid-drag is not something a pointer delta can be reconciled against.
  const scale = useRef<AxisScale>({ x: 1, y: 1 });
  const overshoot = useRef<number | null>(null);
  const [dragging, setDragging] = useState(false);
  // What a hiding bury restores. Taken when the gesture begins, before it
  // writes anything.
  const captured = useRef<SeamCapture | null>(null);
  const bury = buryOf(affordance);
  const hides = bury?.action === 'hide';
  const capture = useCallback(() => {
    if (hides && captured.current === null) captured.current = captureSeam(store, affordance);
  }, [hides, store, affordance]);

  const [gesture, { armed: armedId, message }] = useGesture<NodeId>({
    name: `seam ${affordance.id}`,
    // Hiding destroys nothing, so a destroy lock does not refuse it.
    permits: (id) => (hides ? !store.isLocked(id, 'hide') : destroyBlockedBy(store, id) === null),
    commit: (victim) => {
      const write = writePlacement
        ? (id: NodeId, patch: Record<string, unknown>) => writePlacement(id, patch, affordance.id)
        : undefined;
      commitBury(store, affordance, victim, captured.current ?? undefined, write);
    },
    describe: (victim) =>
      `${accessibleName(store, victim)} will ${hides ? 'hide' : 'close'}. Press Enter to confirm, Escape to cancel.`,
    onArm: onBuryArmChange,
    onEnd: () => {
      overshoot.current = null;
      captured.current = null;
    },
  });
  // A keyboard gesture begins on its first step; a pointer one on the press.
  const ensureBegun = useCallback(() => {
    if (!gesture.state().active) gesture.begin();
  }, [gesture]);

  const endGesture = useCallback(
    (commit: boolean, reason: string) => {
      if (commit) gesture.release();
      else gesture.cancel(reason);
    },
    [gesture],
  );

  const advanceBury = useCallback(
    (delta: number) => {
      const b = affordance.bounds;
      if (!bury || !b) return;
      // The lock check is the gesture's, asked only of a candidate past the
      // threshold.
      const state = trackBury({
        bury,
        overshoot: overshoot.current ?? 0,
        delta,
        atMin: b.atMin,
        atMax: b.atMax,
        canDestroy: () => true,
      });
      overshoot.current = state.overshoot;
      gesture.offer(state.armed ? ((state.candidateId as NodeId | undefined) ?? null) : null);
    },
    [bury, affordance.bounds, gesture],
  );

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      last.current = { x: e.clientX, y: e.clientY };
      scale.current = elementScale(e.currentTarget);
      raiseOnPress(store, affordance);
      gesture.cancel('pressed again');
      gesture.begin();
      capture();
      setDragging(true);
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // jsdom or unsupported — ignore.
      }
      onActiveChange(true);
    },
    [onActiveChange, store, affordance, capture, gesture],
  );
  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!last.current) return;
      const sx = e.clientX - last.current.x;
      const sy = e.clientY - last.current.y;
      if (sx === 0 && sy === 0) return;
      last.current = { x: e.clientX, y: e.clientY };
      // The pointer moves in screen pixels and the strategy in layout pixels;
      // under a view they differ by the scale, nested views' included.
      const { dx, dy } = toLayoutDelta(sx, sy, scale.current);
      // Container-relative pointer, for strategies whose extents are quantized
      // and cannot accumulate a few pixels at a time. Derived from this
      // handle's own box against the rect the strategy gave it, so no ancestor
      // needs measuring.
      const box = e.currentTarget.getBoundingClientRect();
      const within = toLocalPoint(
        { x: e.clientX, y: e.clientY },
        { x: box.left, y: box.top },
        scale.current,
      );
      const point = {
        x: affordance.rect.x - padXRef.current + within.x,
        y: affordance.rect.y - padYRef.current + within.y,
      };
      dispatch({ affordanceId: affordance.id, kind: 'drag', payload: { dx, dy, point } });
      advanceBury(affordance.bounds?.orientation === 'vertical' ? dy : dx);
    },
    [dispatch, affordance.id, affordance.rect.x, affordance.rect.y, affordance.bounds, advanceBury],
  );
  const finish = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>, commit: boolean) => {
      const wasDragging = last.current !== null;
      last.current = null;
      setDragging(false);
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
      endGesture(commit, 'pointercancel');
      if (wasDragging) onActiveChange(false);
    },
    [onActiveChange, endGesture],
  );
  const onPointerUp = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => finish(e, true),
    [finish],
  );
  // A cancelled gesture must not commit the bury: same shape, opposite verdict.
  const onPointerCancel = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => finish(e, false),
    [finish],
  );

  useEffect(() => {
    if (!dragging) return;
    return cancelOnEscape(() => {
      last.current = null;
      setDragging(false);
      endGesture(false, 'escape');
      onActiveChange(false);
    });
  }, [dragging, endGesture, onActiveChange]);

  const bounds = affordance.bounds;
  const padXRef = useRef(0);
  const padYRef = useRef(0);
  const travel = bounds ? undefined : affordance.travel;
  const [moved, setMoved] = useState(false);
  const onKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      if (travel) {
        const step = travel.step ?? keyStep;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        // An arrow on an axis this handle does not move on bubbles, as the
        // perpendicular arrows do on a seam.
        if ((dx === 0 || !travel.x) && (dy === 0 || !travel.y)) return;
        e.preventDefault();
        ensureBegun();
        capture();
        dispatch({ affordanceId: affordance.id, kind: 'drag', payload: { dx, dy } });
        setMoved(true);
        return;
      }
      if (!bounds) return;
      if (e.key === 'Enter') {
        // Unarmed, Enter is not ours: leave it to whatever the host binds.
        if (gesture.state().armed === null) return;
        e.preventDefault();
        endGesture(true, 'enter');
        return;
      }
      if (e.key === 'Escape') {
        if (gesture.state().armed === null && (overshoot.current ?? 0) === 0) return;
        e.preventDefault();
        endGesture(false, 'escape');
        return;
      }
      const horizontal = bounds.orientation === 'horizontal';
      const back = horizontal ? 'ArrowLeft' : 'ArrowUp';
      const fwd = horizontal ? 'ArrowRight' : 'ArrowDown';
      // A strategy whose units are not pixels says how far one press goes;
      // 8 of something is meaningless in cell counts.
      const step = bounds.step ?? keyStep;
      let delta: number;
      if (e.key === back) delta = -step;
      else if (e.key === fwd) delta = step;
      else if (e.key === 'Home') delta = bounds.valueMin - bounds.valueNow;
      else if (e.key === 'End') delta = bounds.valueMax - bounds.valueNow;
      // Anything else — including the perpendicular arrows — bubbles, so pane
      // navigation still works while a gutter holds focus.
      else return;
      e.preventDefault();
      if (delta === 0) return;
      ensureBegun();
      capture();
      // The same event the pointer sends: the strategy clamps once, where it
      // already clamps.
      dispatch({
        affordanceId: affordance.id,
        kind: 'drag',
        payload: horizontal ? { dx: delta, dy: 0 } : { dx: 0, dy: delta },
      });
      advanceBury(delta);
    },
    [
      bounds,
      travel,
      dispatch,
      affordance.id,
      keyStep,
      advanceBury,
      endGesture,
      capture,
      ensureBegun,
      gesture,
    ],
  );

  const onBlur = useCallback(() => {
    setMoved(false);
    // A pointer gesture owns its accumulation; focus leaving mid-drag is not
    // the user abandoning it.
    if (last.current) return;
    endGesture(false, 'blur');
  }, [endGesture]);

  const { padX, padY, outerStyle, innerStyle } = hitArea(affordance, hitPad);
  padXRef.current = padX;
  padYRef.current = padY;

  // A container squeezed under the sum of its panes' floors leaves every pane
  // at its floor, and the seam between them reports a range of one point.
  // Reported disabled rather than as a slider promising travel it cannot make.
  const rangeless = bounds !== undefined && bounds.valueMax <= bounds.valueMin;

  return (
    <>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: role is separator whenever the key handler is attached; the rule cannot see through the conditional. */}
      {/* biome-ignore lint/a11y/useAriaPropsSupportedByRole: same conditional — aria-orientation is set only alongside role="separator", which supports it. */}
      <div
        className="windease-affordance-hit"
        style={outerStyle}
        data-affordance-hit={affordance.id}
        {...buryArmed(armedId !== null)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        draggable={false}
        onDragStart={preventNativeDrag}
        onKeyDown={bounds || travel ? onKeyDown : undefined}
        onBlur={onBlur}
        role={bounds ? 'separator' : travel ? 'button' : undefined}
        tabIndex={(bounds || travel) && tabStop ? 0 : undefined}
        aria-roledescription={travel ? 'move handle' : undefined}
        aria-keyshortcuts={travel ? travelKeys(travel) : undefined}
        aria-orientation={bounds?.orientation}
        aria-valuenow={bounds ? Math.round(bounds.valueNow) : undefined}
        aria-valuemin={bounds ? Math.round(bounds.valueMin) : undefined}
        aria-valuemax={bounds ? Math.round(bounds.valueMax) : undefined}
        aria-label={bounds || travel ? label : undefined}
        aria-disabled={rangeless ? true : undefined}
      >
        <div
          style={innerStyle}
          data-affordance={affordance.id}
          data-affordance-kind={affordance.kind}
        />
      </div>
      {travel ? (
        <div
          className="windease-live-region"
          aria-live="polite"
          aria-atomic="true"
          data-move-live=""
        >
          {moved && affordance.childId !== undefined
            ? `${accessibleName(store, affordance.childId as NodeId)} at ${Math.round(affordance.rect.x)}, ${Math.round(affordance.rect.y)}`
            : ''}
        </div>
      ) : null}
      {bury ? (
        <div
          className="windease-live-region"
          aria-live="polite"
          aria-atomic="true"
          data-bury-live=""
        >
          {message}
        </div>
      ) : null}
    </>
  );
}
