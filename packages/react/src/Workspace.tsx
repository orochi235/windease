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

interface WorkspaceProps<TState, TMeta> {
  strategy: LayoutStrategy<TState, ItemId, TMeta>;
  items: LayoutItem[];
  options?: Record<string, unknown>;
  initialState?: TState;
  /** Skips ResizeObserver when provided. */
  container?: Size;
  onStateChange?(state: TState): void;
  children: (item: LayoutItem, placement: Rect) => ReactNode;
  affordanceRenderers?: Record<
    string,
    (affordance: Affordance<TMeta>, dispatch: (event: LayoutEvent) => void) => ReactNode
  >;
}

const BUILTIN_KINDS = new Set(['drag-x', 'drag-y', 'drag-xy', 'click', 'keypress']);

export function Workspace<TState, TMeta>(props: WorkspaceProps<TState, TMeta>): React.JSX.Element {
  const { strategy, items, options, container, onStateChange, children, affordanceRenderers } = props;
  const opts = options ?? {};

  const initial = useMemo<TState>(() => {
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
  const [state, setState] = useState<TState>(initial);

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
      setState((prev) => {
        const next = strategy.reduce!(prev, event, { container: size, options: opts });
        if (onStateChange) onStateChange(next);
        return next;
      });
    },
    [strategy, size, opts, onStateChange],
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
      }
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
      if (!didDrag || !source || !wasZoneDrag) return;
      if (strategy.name !== 'recursiveSplit') return;
      const target = findPeerZone(e.clientX, e.clientY, rootRef.current, source);
      if (!target) return;
      const targetId = target.getAttribute('data-zone-id');
      if (!targetId) return;
      setState((prev) => {
        const next = swapLeaves(prev as unknown as SplitNode, source, targetId) as unknown as TState;
        if (onStateChange) onStateChange(next);
        return next;
      });
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
}

function AffordanceView<TMeta>({
  affordance,
  dispatch,
  customRenderers,
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
    return <DragAffordance affordance={affordance} dispatch={dispatch} />;
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
}: {
  affordance: Affordance<TMeta>;
  dispatch: (event: LayoutEvent) => void;
}) {
  const lastRef = useRef({ x: 0, y: 0 });
  const { id, kind } = affordance;

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    lastRef.current.x = e.clientX;
    lastRef.current.y = e.clientY;
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    const dx = e.clientX - lastRef.current.x;
    const dy = e.clientY - lastRef.current.y;
    lastRef.current.x = e.clientX;
    lastRef.current.y = e.clientY;
    dispatch({ affordanceId: id, kind: 'drag', payload: { dx, dy } });
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
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
