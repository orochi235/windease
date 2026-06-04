import { trace, type LayoutItem, type Rect, type WindeaseStore, type WindowId, type WindowRecord, type ZoneId } from '@windease/core';
import type * as React from 'react';
import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from 'react';
import { dragCoordinator } from './dnd/dragCoordinator.js';
import { usePointerDrag } from './dnd/usePointerDrag.js';
import { useHistory, useWindease, useZone } from './hooks.js';

interface ZoneProps {
  id: ZoneId;
  /** If provided, skips ResizeObserver measurement and uses this viewport. */
  viewport?: { w: number; h: number };
  children: (window: WindowRecord, placement: Rect) => ReactNode;
}

const warned = new Set<string>();
function warnOnce(key: string, message: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(message);
}

export function Zone({ id, viewport, children }: ZoneProps): React.JSX.Element {
  const store = useWindease();
  const zone = useZone(id);
  const ref = useRef<HTMLDivElement | null>(null);
  const [measured, setMeasured] = useState<{ w: number; h: number } | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: Depend on whether viewport is provided, not on its identity — consumers commonly pass inline-literal viewport props.
  useEffect(() => {
    if (viewport || !ref.current) return;
    const el = ref.current;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r) setMeasured({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [viewport === undefined]);

  const effectiveViewport = viewport ?? measured;
  const visible: WindowRecord[] = zone
    ? zone.windowIds
        .map((wid) => store.getWindow(wid))
        .filter((w): w is WindowRecord => w?.lifecycle.state === 'visible')
    : [];

  let placements: Map<WindowId, Rect> = new Map();
  let unplaced: Set<WindowId> = new Set();
  if (zone && effectiveViewport && visible.length > 0) {
    const items: LayoutItem[] = visible.map((w) => ({
      id: w.id,
      ...(w.hints && Object.keys(w.hints).length > 0 ? { hints: w.hints } : {}),
    }));
    const result = zone.strategy.layout({
      items,
      container: effectiveViewport,
      state: undefined as never,
      options: zone.config,
    });
    placements = result.placements as Map<WindowId, Rect>;
    if (result.unplaced) unplaced = new Set(result.unplaced as WindowId[]);
  }

  return (
    <div ref={ref} className="windease-zone" data-zone-id={id}>
      {visible.map((w) => {
        const p = placements.get(w.id);
        if (!p) {
          if (!unplaced.has(w.id)) {
            warnOnce(
              `${id}:${w.id}`,
              `[windease] zone "${id}" strategy "${zone?.strategy.name}" produced no placement for window "${w.id}"`,
            );
          }
          return null;
        }
        return (
          <WindowItem key={w.id} w={w} p={p} zoneId={id}>
            {children(w, p)}
          </WindowItem>
        );
      })}
    </div>
  );
}

interface WindowItemProps {
  w: WindowRecord;
  p: Rect;
  zoneId: ZoneId;
  children: ReactNode;
}

function WindowItem({ w, p, zoneId, children }: WindowItemProps): React.JSX.Element {
  const store = useWindease();
  const history = useHistory<unknown>();
  const handlers = usePointerDrag({
    onDragStart: () => {
      const ok = dragCoordinator.tryBegin('window');
      if (ok && history) history.controller.beginTransaction();
    },
    onDragMove: (e) => {
      if (dragCoordinator.active() !== 'window') return;
      handleWindowDragMove(e, w.id, zoneId, store);
    },
    onDragEnd: (e, didDrag) => {
      const wasMine = dragCoordinator.active() === 'window';
      try {
        if (didDrag && wasMine) handleWindowDrop(e, w.id, zoneId, store);
      } finally {
        clearAllDropMarkers();
        if (wasMine && history) history.controller.endTransaction(history.capture());
        if (wasMine) dragCoordinator.end();
      }
    },
  });
  const style: CSSProperties = {
    '--w-x': `${p.x}px`,
    '--w-y': `${p.y}px`,
    '--w-w': `${p.w}px`,
    '--w-h': `${p.h}px`,
  } as CSSProperties;
  return (
    <div
      className="windease-window"
      data-window-id={w.id}
      data-window-kind={w.kind}
      data-window-state={w.lifecycle.state}
      style={style}
      {...handlers}
    >
      {children}
    </div>
  );
}

// ---- DnD module-scope helpers ----

function handleWindowDragMove(
  e: PointerEvent,
  sourceWid: WindowId,
  sourceZone: ZoneId,
  store: WindeaseStore,
): void {
  const target = findZoneAtPoint(e.clientX, e.clientY);
  clearAllDropMarkers();
  if (!target) return;
  const targetId = target.id as ZoneId;
  const targetZone = store.getZone(targetId);
  if (!targetZone) return;
  const prospective = buildProspectiveItems(
    targetZone.windowIds,
    sourceWid,
    sourceZone,
    targetId,
    target.el,
    e.clientX,
    e.clientY,
  );
  const accepted = targetZone.strategy.canAccept?.(prospective.items) ?? true;
  if (!accepted) {
    trace('dnd', `move: ${sourceWid} over ${targetId} REJECTED by canAccept`);
    target.el.setAttribute('data-drop-rejected', 'true');
    return;
  }
  if (prospective.isNoOp) {
    trace('dnd', `move: ${sourceWid} over ${targetId} is no-op (no indicator)`);
    return;
  }
  trace('dnd', `move: ${sourceWid} → ${targetId}@${prospective.indexInTarget}`);
  target.el.setAttribute('data-drop-target', 'true');
  renderInsertionLine(target.el, prospective.insertionRect);
}

function handleWindowDrop(
  e: PointerEvent,
  sourceWid: WindowId,
  sourceZone: ZoneId,
  store: WindeaseStore,
): void {
  const target = findZoneAtPoint(e.clientX, e.clientY);
  if (!target) return;
  const targetId = target.id as ZoneId;
  const targetZone = store.getZone(targetId);
  if (!targetZone) return;
  const prospective = buildProspectiveItems(
    targetZone.windowIds,
    sourceWid,
    sourceZone,
    targetId,
    target.el,
    e.clientX,
    e.clientY,
  );
  const accepted = targetZone.strategy.canAccept?.(prospective.items) ?? true;
  if (!accepted) return;
  if (prospective.isNoOp) return;
  if (targetId === sourceZone) {
    trace('dnd', `drop: reorder in ${sourceZone}`);
    store.reorderInZone(sourceZone, prospective.items.map((it) => it.id as WindowId));
  } else {
    trace('dnd', `drop: move ${sourceWid} ${sourceZone}→${targetId}@${prospective.indexInTarget}`);
    store.moveWindow(sourceWid, targetId, prospective.indexInTarget);
  }
}

function findZoneAtPoint(x: number, y: number): { id: string; el: Element } | null {
  const els = document.elementsFromPoint(x, y);
  for (const el of els) {
    const zone = el.closest('[data-zone-id]');
    if (zone) {
      const id = zone.getAttribute('data-zone-id');
      if (id) return { id, el: zone };
    }
  }
  return null;
}

function clearAllDropMarkers(): void {
  for (const el of document.querySelectorAll('[data-drop-target]')) {
    el.removeAttribute('data-drop-target');
  }
  for (const el of document.querySelectorAll('[data-drop-rejected]')) {
    el.removeAttribute('data-drop-rejected');
  }
  for (const el of document.querySelectorAll('.windease-insertion-line')) {
    el.remove();
  }
}

interface ProspectiveResult {
  items: { id: string }[];
  indexInTarget: number;
  insertionRect: { left: number; top: number; width: number; height: number };
  isNoOp: boolean;
}

function buildProspectiveItems(
  targetWindowIds: WindowId[],
  sourceWid: WindowId,
  sourceZone: ZoneId,
  targetZoneId: ZoneId,
  targetEl: Element,
  x: number,
  y: number,
): ProspectiveResult {
  const sameZone = sourceZone === targetZoneId;
  const otherIds = sameZone ? targetWindowIds.filter((id) => id !== sourceWid) : targetWindowIds.slice();
  const children = Array.from(
    targetEl.querySelectorAll(':scope > .windease-window'),
  ) as HTMLElement[];
  const otherChildren = sameZone
    ? children.filter((el) => el.getAttribute('data-window-id') !== sourceWid)
    : children;

  const axis = inferAxis(otherChildren, targetEl);
  let insertionIndex = otherChildren.length;
  let insertionRect = endRect(targetEl, axis);
  if (otherChildren.length > 0) {
    let bestIdx = 0;
    let bestDist = Number.POSITIVE_INFINITY;
    let bestCenterMain = 0;
    let bestRect: DOMRect | null = null;
    for (let i = 0; i < otherChildren.length; i++) {
      const r = otherChildren[i]!.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const d = Math.hypot(cx - x, cy - y);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
        bestCenterMain = axis === 'x' ? cx : cy;
        bestRect = r;
      }
    }
    const pointerMain = axis === 'x' ? x : y;
    const before = pointerMain <= bestCenterMain;
    insertionIndex = before ? bestIdx : bestIdx + 1;
    if (bestRect) {
      insertionRect = insertionRectFor(targetEl, bestRect, before, axis);
    }
  }

  const prospectiveIds = [...otherIds];
  prospectiveIds.splice(insertionIndex, 0, sourceWid);
  const isNoOp =
    prospectiveIds.length === targetWindowIds.length &&
    prospectiveIds.every((id, i) => id === targetWindowIds[i]);
  return {
    items: prospectiveIds.map((id) => ({ id })),
    indexInTarget: insertionIndex,
    insertionRect,
    isNoOp,
  };
}

function endRect(
  targetEl: Element,
  axis: 'x' | 'y',
): { left: number; top: number; width: number; height: number } {
  const r = targetEl.getBoundingClientRect();
  if (axis === 'x') {
    return { left: r.right - 2, top: r.top, width: 2, height: r.height };
  }
  return { left: r.left, top: r.bottom - 2, width: r.width, height: 2 };
}

function insertionRectFor(
  targetEl: Element,
  childRect: DOMRect,
  before: boolean,
  axis: 'x' | 'y',
): { left: number; top: number; width: number; height: number } {
  const r = targetEl.getBoundingClientRect();
  if (axis === 'x') {
    const x = before ? childRect.left : childRect.right;
    return { left: x - 1, top: r.top, width: 2, height: r.height };
  }
  const yPos = before ? childRect.top : childRect.bottom;
  return { left: r.left, top: yPos - 1, width: r.width, height: 2 };
}

/**
 * Infer the primary layout axis from sibling positions. With 2+ children we
 * use the dominant axis of separation between adjacent (in DOM order) siblings.
 * With 0–1 children we fall back to the zone's aspect ratio.
 */
function inferAxis(children: HTMLElement[], targetEl: Element): 'x' | 'y' {
  if (children.length >= 2) {
    let dx = 0;
    let dy = 0;
    for (let i = 1; i < children.length; i++) {
      const a = children[i - 1]!.getBoundingClientRect();
      const b = children[i]!.getBoundingClientRect();
      dx += Math.abs((b.left + b.width / 2) - (a.left + a.width / 2));
      dy += Math.abs((b.top + b.height / 2) - (a.top + a.height / 2));
    }
    return dx >= dy ? 'x' : 'y';
  }
  const r = targetEl.getBoundingClientRect();
  return r.width >= r.height ? 'x' : 'y';
}

function renderInsertionLine(
  targetEl: Element,
  rect: { left: number; top: number; width: number; height: number },
): void {
  const doc = targetEl.ownerDocument;
  if (!doc) return;
  let line = doc.body.querySelector('.windease-insertion-line') as HTMLDivElement | null;
  if (!line) {
    line = doc.createElement('div');
    line.className = 'windease-insertion-line';
    line.style.position = 'fixed';
    line.style.pointerEvents = 'none';
    doc.body.appendChild(line);
  }
  line.style.left = `${rect.left}px`;
  line.style.top = `${rect.top}px`;
  line.style.width = `${rect.width}px`;
  line.style.height = `${rect.height}px`;
}
