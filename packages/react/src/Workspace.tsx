import * as React from 'react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import type {
  Affordance,
  ItemId,
  LayoutEvent,
  LayoutItem,
  LayoutStrategy,
  Rect,
  Size,
  SplitNode,
} from '@windease/core';
import { WindeaseError } from '@windease/core';
import { dragCoordinator } from './dnd/dragCoordinator.js';
import { usePointerDrag } from './dnd/usePointerDrag.js';
import { useHistory } from './hooks.js';

interface WorkspaceProps<TState, TMeta> {
  strategy: LayoutStrategy<TState, ItemId, TMeta>;
  items: LayoutItem[];
  options?: Record<string, unknown>;
  initialState?: TState;
  /** Controlled layout state. When provided, the Workspace becomes controlled. */
  state?: TState;
  /** Skips ResizeObserver when provided. */
  container?: Size;
  onStateChange?(state: TState): void;
  onGestureStart?(): void;
  onGestureEnd?(): void;
  children: (item: LayoutItem, placement: Rect) => ReactNode;
  affordanceRenderers?: Record<
    string,
    (affordance: Affordance<TMeta>, dispatch: (event: LayoutEvent) => void) => ReactNode
  >;
}

const BUILTIN_KINDS = new Set(['drag-x', 'drag-y', 'drag-xy', 'click', 'keypress']);

export function Workspace<TState, TMeta>(props: WorkspaceProps<TState, TMeta>): React.JSX.Element {
  const {
    strategy,
    items,
    options,
    container,
    onStateChange,
    onGestureStart,
    onGestureEnd,
    children,
    affordanceRenderers,
  } = props;
  const opts = options ?? {};

  const initial = useMemo<TState>(() => {
    if ('state' in props && props.state !== undefined) {
      return props.state as TState;
    }
    if ('initialState' in props && props.initialState !== undefined) {
      return props.initialState as TState;
    }
    if (strategy.initialState) return strategy.initialState(items);
    throw new WindeaseError(
      'NO_INITIAL_STATE',
      `NO_INITIAL_STATE: strategy "${strategy.name}" has no initial state and no initialState prop was provided`,
    );
    // biome-ignore lint/correctness/useExhaustiveDependencies: initial state should only be computed once on mount
  }, []);

  const isControlled = props.state !== undefined;
  const [internalState, setInternalState] = useState<TState>(initial);
  const state: TState = isControlled ? (props.state as TState) : internalState;

  const stateRef = useRef<TState>(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const applyState = useCallback(
    (updater: TState | ((prev: TState) => TState)) => {
      const next =
        typeof updater === 'function'
          ? (updater as (p: TState) => TState)(stateRef.current)
          : updater;
      if (!isControlled) setInternalState(next);
      if (onStateChange) onStateChange(next);
    },
    [isControlled, onStateChange],
  );

  const history = useHistory<unknown>();

  const gestureStart = useCallback(() => {
    history?.controller.beginTransaction();
    onGestureStart?.();
  }, [history, onGestureStart]);

  const gestureEnd = useCallback(() => {
    if (history) history.controller.endTransaction(history.capture());
    onGestureEnd?.();
  }, [history, onGestureEnd]);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const [measured, setMeasured] = useState<Size | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Depend on whether container is provided, not its identity.
  useEffect(() => {
    if (container || !rootRef.current) return;
    const el = rootRef.current;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r) setMeasured({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [container === undefined]);

  const size: Size | null = container ?? measured;

  const dispatch = useCallback(
    (event: LayoutEvent) => {
      if (!strategy.reduce) return;
      if (!size) return;
      applyState((prev) => strategy.reduce!(prev, event, { container: size, options: opts }));
    },
    [strategy, size, opts, applyState],
  );

  const result = useMemo(() => {
    if (!size) return null;
    return strategy.layout({ items, container: size, state, options: opts });
  }, [strategy, items, size, state, opts]);

  const zoneDragSourceRef = useRef<string | null>(null);

  const zoneDragHandlers = usePointerDrag({
    onDragStart: () => {
      if (!dragCoordinator.tryBegin('zone')) {
        zoneDragSourceRef.current = null;
        return;
      }
      gestureStart();
    },
    onDragMove: (e) => {
      if (dragCoordinator.active() !== 'zone') return;
      const sourceId = zoneDragSourceRef.current;
      if (!sourceId) return;
      const target = findPeerZone(e.clientX, e.clientY, rootRef.current, sourceId);
      clearZoneDropMarkers();
      if (target) target.setAttribute('data-zone-drop-target', 'true');
    },
    onDragEnd: (e, didDrag) => {
      const source = zoneDragSourceRef.current;
      zoneDragSourceRef.current = null;
      clearZoneDropMarkers();
      const wasZoneDrag = dragCoordinator.active() === 'zone';
      dragCoordinator.end();
      if (!wasZoneDrag) return;
      try {
        if (!didDrag || !source) return;
        if (strategy.name !== 'recursiveSplit') return;
        const target = findPeerZone(e.clientX, e.clientY, rootRef.current, source);
        if (!target) return;
        const targetId = target.getAttribute('data-zone-id');
        if (!targetId) return;
        applyState((prev) => swapLeaves(prev as unknown as SplitNode, source, targetId) as unknown as TState);
      } finally {
        gestureEnd();
      }
    },
  });

  const onRootPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const tgt = e.target as Element;
      if (tgt.closest('.windease-window')) return; // window-drag handles
      if (tgt.closest('.windease-affordance')) return; // affordance handles
      const zone = tgt.closest('[data-zone-id]');
      if (!zone) return;
      if (!rootRef.current?.contains(zone)) return;
      zoneDragSourceRef.current = zone.getAttribute('data-zone-id');
      zoneDragHandlers.onPointerDown(e);
    },
    [zoneDragHandlers],
  );

  return (
    <div
      ref={rootRef}
      className="windease-workspace"
      style={{ position: 'relative', width: '100%', height: '100%' }}
      onPointerDown={onRootPointerDown}
      onPointerMove={zoneDragHandlers.onPointerMove}
      onPointerUp={zoneDragHandlers.onPointerUp}
      onPointerCancel={zoneDragHandlers.onPointerCancel}
    >
      {result &&
        items.map((item) => {
          const rect = result.placements.get(item.id);
          if (!rect) return null;
          const style: CSSProperties = {
            position: 'absolute',
            '--w-x': `${rect.x}px`,
            '--w-y': `${rect.y}px`,
            '--w-w': `${rect.w}px`,
            '--w-h': `${rect.h}px`,
            left: rect.x,
            top: rect.y,
            width: rect.w,
            height: rect.h,
          } as CSSProperties;
          return (
            <div
              key={item.id}
              className="windease-workspace-item"
              data-item-id={item.id}
              style={style}
            >
              {children(item, rect)}
            </div>
          );
        })}
      {result &&
        result.affordances.map((aff) => (
          <AffordanceView
            key={aff.id}
            affordance={aff as Affordance<TMeta>}
            dispatch={dispatch}
            customRenderers={affordanceRenderers}
            onGestureStart={gestureStart}
            onGestureEnd={gestureEnd}
          />
        ))}
    </div>
  );
}

interface AffordanceViewProps<TMeta> {
  affordance: Affordance<TMeta>;
  dispatch: (event: LayoutEvent) => void;
  customRenderers?:
    | Record<string, (a: Affordance<TMeta>, d: (e: LayoutEvent) => void) => ReactNode>
    | undefined;
  onGestureStart: () => void;
  onGestureEnd: () => void;
}

function AffordanceView<TMeta>({
  affordance,
  dispatch,
  customRenderers,
  onGestureStart,
  onGestureEnd,
}: AffordanceViewProps<TMeta>) {
  const isBuiltin = BUILTIN_KINDS.has(affordance.kind);
  if (!isBuiltin) {
    const renderer = customRenderers?.[affordance.kind];
    if (!renderer) {
      throw new WindeaseError(
        'UNKNOWN_AFFORDANCE_KIND',
        `no built-in or custom renderer for affordance kind "${affordance.kind}"`,
      );
    }
    return <>{renderer(affordance, dispatch)}</>;
  }

  const { kind } = affordance;
  if (kind === 'drag-x' || kind === 'drag-y' || kind === 'drag-xy') {
    return (
      <DragAffordance
        affordance={affordance}
        dispatch={dispatch}
        onGestureStart={onGestureStart}
        onGestureEnd={onGestureEnd}
      />
    );
  }
  if (kind === 'click') {
    return <ClickAffordance affordance={affordance} dispatch={dispatch} />;
  }
  return <KeypressAffordance affordance={affordance} dispatch={dispatch} />;
}

function baseAffordanceStyle<TMeta>(a: Affordance<TMeta>): CSSProperties {
  return {
    position: 'absolute',
    left: a.rect.x,
    top: a.rect.y,
    width: a.rect.w,
    height: a.rect.h,
    cursor: a.cursor ?? 'default',
    userSelect: 'none',
    touchAction: 'none',
  };
}

function DragAffordance<TMeta>({
  affordance,
  dispatch,
  onGestureStart,
  onGestureEnd,
}: {
  affordance: Affordance<TMeta>;
  dispatch: (event: LayoutEvent) => void;
  onGestureStart: () => void;
  onGestureEnd: () => void;
}) {
  const lastRef = useRef({ x: 0, y: 0 });
  const activeRef = useRef(false);
  const safetyNetRef = useRef<(() => void) | null>(null);
  const { id, kind } = affordance;

  const endGesture = () => {
    if (!activeRef.current) return;
    activeRef.current = false;
    safetyNetRef.current?.();
    safetyNetRef.current = null;
    onGestureEnd();
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    lastRef.current.x = e.clientX;
    lastRef.current.y = e.clientY;
    activeRef.current = true;
    // Window-level safety net so we always end the gesture.
    const pointerId = e.pointerId;
    const onWindowUp = (we: PointerEvent) => {
      if (we.pointerId === pointerId) endGesture();
    };
    const onWindowCancel = (we: PointerEvent) => {
      if (we.pointerId === pointerId) endGesture();
    };
    const onLostCapture = (we: PointerEvent) => {
      if (we.pointerId === pointerId) endGesture();
    };
    const onBlur = () => endGesture();
    const onVis = () => { if (document.hidden) endGesture(); };
    window.addEventListener('pointerup', onWindowUp);
    window.addEventListener('pointercancel', onWindowCancel);
    window.addEventListener('lostpointercapture', onLostCapture);
    window.addEventListener('blur', onBlur);
    document.addEventListener('visibilitychange', onVis);
    safetyNetRef.current = () => {
      window.removeEventListener('pointerup', onWindowUp);
      window.removeEventListener('pointercancel', onWindowCancel);
      window.removeEventListener('lostpointercapture', onLostCapture);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('visibilitychange', onVis);
    };
    onGestureStart();
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!activeRef.current) return;
    const dx = e.clientX - lastRef.current.x;
    const dy = e.clientY - lastRef.current.y;
    lastRef.current.x = e.clientX;
    lastRef.current.y = e.clientY;
    dispatch({ affordanceId: id, kind: 'drag', payload: { dx, dy } });
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    }
    endGesture();
  };

  return (
    <div
      className="windease-affordance"
      data-affordance-id={id}
      data-kind={kind}
      style={baseAffordanceStyle(affordance)}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    />
  );
}

function ClickAffordance<TMeta>({
  affordance,
  dispatch,
}: {
  affordance: Affordance<TMeta>;
  dispatch: (event: LayoutEvent) => void;
}) {
  return (
    <div
      className="windease-affordance"
      data-affordance-id={affordance.id}
      data-kind="click"
      style={baseAffordanceStyle(affordance)}
      onClick={() => dispatch({ affordanceId: affordance.id, kind: 'click', payload: {} })}
    />
  );
}

function KeypressAffordance<TMeta>({
  affordance,
  dispatch,
}: {
  affordance: Affordance<TMeta>;
  dispatch: (event: LayoutEvent) => void;
}) {
  return (
    <div
      className="windease-affordance"
      data-affordance-id={affordance.id}
      data-kind="keypress"
      tabIndex={0}
      style={baseAffordanceStyle(affordance)}
      onKeyDown={(e) => dispatch({ affordanceId: affordance.id, kind: 'key', payload: { key: e.key } })}
    />
  );
}

function findPeerZone(x: number, y: number, root: HTMLElement | null, sourceId: string): Element | null {
  if (!root) return null;
  const els = document.elementsFromPoint(x, y);
  for (const el of els) {
    const zone = el.closest('[data-zone-id]');
    if (!zone || !root.contains(zone)) continue;
    if (zone.getAttribute('data-zone-id') === sourceId) continue;
    return zone;
  }
  return null;
}

function clearZoneDropMarkers(): void {
  for (const el of document.querySelectorAll('[data-zone-drop-target]')) {
    el.removeAttribute('data-zone-drop-target');
  }
}

function swapLeaves(node: SplitNode, idA: string, idB: string): SplitNode {
  if (node.kind === 'leaf') {
    if (node.id === idA) return { kind: 'leaf', id: idB };
    if (node.id === idB) return { kind: 'leaf', id: idA };
    return node;
  }
  return { ...node, a: swapLeaves(node.a, idA, idB), b: swapLeaves(node.b, idA, idB) };
}
