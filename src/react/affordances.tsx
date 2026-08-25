import {
  type CSSProperties,
  Fragment,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  type Affordance,
  accessibleName,
  destroyBlockedBy,
  type NodeId,
  trace,
  trackJoin,
} from '../index.js';
import type { Store } from '../store.js';
import { preventNativeDrag } from './dnd/nativeDrag.js';
import type { ContainerLayout } from './useContainerLayout.js';

/** Args passed to function-form `affordances` callbacks. The function fully
 *  replaces the default renderer and is responsible for pointer events; call
 *  `dispatch` with `{ affordanceId, kind, payload }` to drive the strategy. */
export interface AffordanceRenderArgs {
  affordance: Affordance;
  dispatch: ContainerLayout['dispatchAffordance'];
  hitPad: number;
}

export type AffordanceRenderer = (args: AffordanceRenderArgs) => ReactNode;

const AFFORDANCE_BASE: CSSProperties = {
  position: 'absolute',
  touchAction: 'none',
  userSelect: 'none',
  // Sit above sibling panels so the +hitPad slack catches pointer events and
  // wins the cursor against adjacent panel content.
  zIndex: 1,
};

/**
 * What a screen reader announces for a gutter. Composed from the panes the
 * affordance moves, using the same naming the focus system uses, so a consumer
 * who set `meta.title` gets a usable name without a second API.
 */
function affordanceLabel(store: Store, aff: Affordance): string | undefined {
  const ids = aff.affects ?? (aff.childId ? [aff.childId] : []);
  if (ids.length === 0) return undefined;
  const names = ids.map((id) => accessibleName(store, id as NodeId));
  return `resize ${names.join(' and ')}`;
}

const noJoinArmChange = () => {};

export interface AffordanceLayerProps {
  /** `true` for the built-in handle, or a renderer that fully replaces it. */
  render: boolean | AffordanceRenderer;
  affordances: readonly Affordance[];
  dispatch: ContainerLayout['dispatchAffordance'];
  store: Store;
  hitPad: number;
  keyStep: number;
  tabStop: boolean;
  onActiveChange: (id: string | null) => void;
  /** The node a release would destroy right now, or null. Optional: a host
   *  with no per-pane element to mark still gets the destroy. */
  onJoinArmChange?: (victimId: NodeId | null) => void;
}

/**
 * The strategy's affordances as DOM. Shared by `<Container>` and the
 * `<Zone>` / `<Panel>` presets so a seam is the same element, with the same
 * keyboard contract, whichever path built the tree.
 */
export function AffordanceLayer({
  render,
  affordances,
  dispatch,
  store,
  hitPad,
  keyStep,
  tabStop,
  onActiveChange,
  onJoinArmChange = noJoinArmChange,
}: AffordanceLayerProps) {
  if (!render) return null;
  return (
    <>
      {affordances.map((aff) =>
        typeof render === 'function' ? (
          <Fragment key={aff.id}>{render({ affordance: aff, dispatch, hitPad })}</Fragment>
        ) : (
          <AffordanceHandle
            key={aff.id}
            affordance={aff}
            dispatch={dispatch}
            store={store}
            hitPad={hitPad}
            keyStep={keyStep}
            tabStop={tabStop}
            label={affordanceLabel(store, aff)}
            onActiveChange={(active) => onActiveChange(active ? aff.id : null)}
            onJoinArmChange={onJoinArmChange}
          />
        ),
      )}
    </>
  );
}

interface AffordanceHandleProps {
  affordance: Affordance;
  dispatch: ContainerLayout['dispatchAffordance'];
  store: Store;
  hitPad: number;
  keyStep: number;
  tabStop: boolean;
  label: string | undefined;
  onActiveChange: (active: boolean) => void;
  onJoinArmChange: (victimId: NodeId | null) => void;
}

function AffordanceHandle({
  affordance,
  dispatch,
  store,
  hitPad,
  keyStep,
  tabStop,
  label,
  onActiveChange,
  onJoinArmChange,
}: AffordanceHandleProps) {
  const last = useRef<{ x: number; y: number } | null>(null);
  const overshoot = useRef<number | null>(null);
  const [armedId, setArmedId] = useState<NodeId | null>(null);
  const armedRef = useRef<NodeId | null>(null);
  const [dragging, setDragging] = useState(false);

  const setArmed = useCallback(
    (victimId: NodeId | null) => {
      if (armedRef.current === victimId) return;
      trace(
        'dnd',
        `join ${victimId ? 'armed' : 'disarmed'}: ${affordance.id} → ${victimId ?? armedRef.current}`,
      );
      armedRef.current = victimId;
      setArmedId(victimId);
      onJoinArmChange(victimId);
    },
    [onJoinArmChange, affordance.id],
  );

  const endGesture = useCallback(
    (commit: boolean) => {
      const victim = armedRef.current;
      setArmed(null);
      overshoot.current = null;
      if (commit && victim) {
        trace('store', `join: ${affordance.id} destroys ${victim}`);
        store.unregisterNode(victim);
      }
    },
    [setArmed, store, affordance.id],
  );

  const advanceJoin = useCallback(
    (delta: number) => {
      const join = affordance.join;
      const b = affordance.bounds;
      if (!join || !b) return;
      const state = trackJoin({
        join,
        overshoot: overshoot.current ?? 0,
        delta,
        atMin: b.atMin,
        atMax: b.atMax,
        canDestroy: (id) => destroyBlockedBy(store, id as NodeId) === null,
      });
      overshoot.current = state.overshoot;
      setArmed(state.armed ? ((state.candidateId as NodeId | undefined) ?? null) : null);
    },
    [affordance.join, affordance.bounds, store, setArmed],
  );

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      last.current = { x: e.clientX, y: e.clientY };
      overshoot.current = null;
      setDragging(true);
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // jsdom or unsupported — ignore.
      }
      onActiveChange(true);
    },
    [onActiveChange],
  );
  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!last.current) return;
      const dx = e.clientX - last.current.x;
      const dy = e.clientY - last.current.y;
      if (dx === 0 && dy === 0) return;
      last.current = { x: e.clientX, y: e.clientY };
      // Container-relative pointer, for strategies whose extents are quantized
      // and cannot accumulate a few pixels at a time. Derived from this
      // handle's own box against the rect the strategy gave it, so no ancestor
      // needs measuring.
      const box = e.currentTarget.getBoundingClientRect();
      const point = {
        x: affordance.rect.x - padXRef.current + (e.clientX - box.left),
        y: affordance.rect.y - padYRef.current + (e.clientY - box.top),
      };
      dispatch({ affordanceId: affordance.id, kind: 'drag', payload: { dx, dy, point } });
      advanceJoin(affordance.bounds?.orientation === 'vertical' ? dy : dx);
    },
    [dispatch, affordance.id, affordance.rect.x, affordance.rect.y, affordance.bounds, advanceJoin],
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
      endGesture(commit);
      if (wasDragging) onActiveChange(false);
    },
    [onActiveChange, endGesture],
  );
  const onPointerUp = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => finish(e, true),
    [finish],
  );
  // A cancelled gesture must not commit the join: same shape, opposite verdict.
  const onPointerCancel = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => finish(e, false),
    [finish],
  );

  const notifyArm = useRef(onJoinArmChange);
  useEffect(() => {
    notifyArm.current = onJoinArmChange;
  });
  // A commit clears the marking before it destroys, so this only fires when the
  // handle goes away with a gesture still armed.
  useEffect(
    () => () => {
      if (armedRef.current !== null) notifyArm.current(null);
    },
    [],
  );

  useEffect(() => {
    if (!dragging) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      last.current = null;
      setDragging(false);
      endGesture(false);
      onActiveChange(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dragging, endGesture, onActiveChange]);

  const bounds = affordance.bounds;
  const padXRef = useRef(0);
  const padYRef = useRef(0);
  const onKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      if (!bounds) return;
      if (e.key === 'Enter') {
        // Unarmed, Enter is not ours: leave it to whatever the host binds.
        if (armedRef.current === null) return;
        e.preventDefault();
        endGesture(true);
        return;
      }
      if (e.key === 'Escape') {
        if (armedRef.current === null && (overshoot.current ?? 0) === 0) return;
        e.preventDefault();
        endGesture(false);
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
      // The same event the pointer sends: the strategy clamps once, where it
      // already clamps.
      dispatch({
        affordanceId: affordance.id,
        kind: 'drag',
        payload: horizontal ? { dx: delta, dy: 0 } : { dx: 0, dy: delta },
      });
      advanceJoin(delta);
    },
    [bounds, dispatch, affordance.id, keyStep, advanceJoin, endGesture],
  );

  const onBlur = useCallback(() => {
    // A pointer gesture owns its accumulation; focus leaving mid-drag is not
    // the user abandoning it.
    if (last.current) return;
    endGesture(false);
  }, [endGesture]);

  // Expand the hit area perpendicular to the gutter so a 4px line is easier
  // to grab. The outer div catches pointer events; the inner div is the
  // visible rect at the strategy's reported size and carries `data-affordance`
  // so consumer CSS styles it (not the invisible padding).
  const isXish =
    affordance.kind === 'drag-x' ||
    affordance.kind === 'drag-xy' ||
    affordance.kind === 'resize-x' ||
    affordance.kind === 'resize-xy';
  const isYish =
    affordance.kind === 'drag-y' ||
    affordance.kind === 'drag-xy' ||
    affordance.kind === 'resize-y' ||
    affordance.kind === 'resize-xy';
  const padX = isXish ? hitPad : 0;
  const padY = isYish ? hitPad : 0;
  padXRef.current = padX;
  padYRef.current = padY;
  const outerStyle: CSSProperties = {
    ...AFFORDANCE_BASE,
    left: affordance.rect.x - padX,
    top: affordance.rect.y - padY,
    width: affordance.rect.w + 2 * padX,
    height: affordance.rect.h + 2 * padY,
  };
  if (affordance.cursor) outerStyle.cursor = affordance.cursor;
  const innerStyle: CSSProperties = {
    position: 'absolute',
    left: padX,
    top: padY,
    width: affordance.rect.w,
    height: affordance.rect.h,
    pointerEvents: 'none',
  };

  const armedName = armedId !== null ? accessibleName(store, armedId) : null;

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
        data-join-armed={armedId !== null ? 'true' : undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        draggable={false}
        onDragStart={preventNativeDrag}
        onKeyDown={bounds ? onKeyDown : undefined}
        onBlur={onBlur}
        role={bounds ? 'separator' : undefined}
        tabIndex={bounds && tabStop ? 0 : undefined}
        aria-orientation={bounds?.orientation}
        aria-valuenow={bounds ? Math.round(bounds.valueNow) : undefined}
        aria-valuemin={bounds ? Math.round(bounds.valueMin) : undefined}
        aria-valuemax={bounds ? Math.round(bounds.valueMax) : undefined}
        aria-label={bounds ? label : undefined}
        aria-disabled={rangeless ? true : undefined}
      >
        <div
          style={innerStyle}
          data-affordance={affordance.id}
          data-affordance-kind={affordance.kind}
        />
      </div>
      {affordance.join ? (
        <div
          className="windease-live-region"
          aria-live="polite"
          aria-atomic="true"
          data-join-live=""
        >
          {armedName ? `${armedName} will close. Press Enter to confirm, Escape to cancel.` : ''}
        </div>
      ) : null}
    </>
  );
}
