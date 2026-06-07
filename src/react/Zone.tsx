import {
  trace,
  type LayoutItem,
  type Rect,
  type WindeaseStore,
  type WindowId,
  type WindowRecord,
  type ZoneId,
  type ZoneRecord,
} from '../index.js';
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
    ? store
        .listWindows({ zoneId: id })
        .filter((w) => w.lifecycle.state === 'visible')
    : [];

  let placements: Map<WindowId, Rect> = new Map();
  let unplaced: Set<WindowId> = new Set();
  if (zone && effectiveViewport && visible.length > 0) {
    const items: LayoutItem[] = visible.map((w) => {
      const meta = zone.itemMeta.get(w.id);
      return {
        id: w.id,
        ...(w.hints && Object.keys(w.hints).length > 0 ? { hints: w.hints } : {}),
        ...(meta && Object.keys(meta).length > 0 ? { meta } : {}),
      };
    });
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
  const locked = Boolean(store.getItemMeta(zoneId, w.id)?.locked);
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
      data-window-locked={locked ? 'true' : undefined}
      style={style}
      {...(locked ? {} : handlers)}
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
    store,
    targetZone.windowIds,
    sourceWid,
    sourceZone,
    targetId,
    target.el,
    e.clientX,
    e.clientY,
  );
  const accepted = targetZone.strategy.canAccept?.(prospective.items, targetZone.config) ?? true;
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
  const sameZone = sourceZone === targetId;
  const outlineRect = sameZone
    ? null
    : computeProspectivePlacement(store, targetZone, sourceWid, prospective.items, target.el);
  if (outlineRect) {
    renderInsertionOutline(target.el, outlineRect);
  } else {
    renderInsertionLine(target.el, prospective.insertionRect);
  }
}

function computeProspectivePlacement(
  store: WindeaseStore,
  targetZone: ZoneRecord,
  sourceWid: WindowId,
  items: { id: string }[],
  targetEl: Element,
): { left: number; top: number; width: number; height: number } | null {
  const zoneRect = targetEl.getBoundingClientRect();
  if (zoneRect.width === 0 || zoneRect.height === 0) return null;
  const targetZoneId = (targetEl.getAttribute('data-zone-id') ?? '') as ZoneId;
  const layoutItems: LayoutItem[] = items.map((it) => {
    const w = store.getWindow(it.id as WindowId);
    const meta = it.id === sourceWid ? undefined : store.getItemMeta(targetZoneId, it.id as WindowId);
    return {
      id: it.id,
      ...(w?.hints && Object.keys(w.hints).length > 0 ? { hints: w.hints } : {}),
      ...(meta && Object.keys(meta).length > 0 ? { meta } : {}),
    };
  });
  const container = { w: zoneRect.width, h: zoneRect.height };
  try {
    const withSource = targetZone.strategy.layout({
      items: layoutItems,
      container,
      state: undefined as never,
      options: targetZone.config,
    });
    const placements = withSource.placements as Map<WindowId, Rect>;
    const p = placements.get(sourceWid);
    if (!p) return null;

    // Only show the 2D outline when the source lands in a cell that doesn't
    // exist without it — i.e. dropping doesn't displace any other items.
    // Otherwise fall back to the line affordance.
    const otherItems = layoutItems.filter((it) => it.id !== sourceWid);
    if (otherItems.length > 0) {
      const withoutSource = targetZone.strategy.layout({
        items: otherItems,
        container,
        state: undefined as never,
        options: targetZone.config,
      });
      const before = withoutSource.placements as Map<WindowId, Rect>;
      for (const it of otherItems) {
        const a = before.get(it.id as WindowId);
        const b = placements.get(it.id as WindowId);
        if (!a || !b) continue;
        if (a.x !== b.x || a.y !== b.y || a.w !== b.w || a.h !== b.h) return null;
      }
    }
    return { left: zoneRect.left + p.x, top: zoneRect.top + p.y, width: p.w, height: p.h };
  } catch {
    return null;
  }
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
    store,
    targetZone.windowIds,
    sourceWid,
    sourceZone,
    targetId,
    target.el,
    e.clientX,
    e.clientY,
  );
  const accepted = targetZone.strategy.canAccept?.(prospective.items, targetZone.config) ?? true;
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
  for (const el of document.querySelectorAll('.windease-insertion-outline')) {
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
  store: WindeaseStore,
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

  // Slot-based affordance: build one candidate insertion rect per gap
  // (including end-caps), pick the slot closest to the pointer, then
  // simulate the post-drop resort to find the final landing slot.
  const slots = buildSlots(otherChildren, targetEl);
  const rawIndex = pickNearestSlot(slots, x, y);

  const prospectiveIds = [...otherIds];
  prospectiveIds.splice(rawIndex, 0, sourceWid);

  const isPinned = (id: WindowId): boolean => {
    // Cross-zone source has no meta in the target yet (moveWindow clears it).
    const meta =
      id === sourceWid && !sameZone
        ? undefined
        : store.getItemMeta(targetZoneId, id);
    return Boolean(meta?.pinned || meta?.locked);
  };
  const pinnedFinal: WindowId[] = [];
  const restFinal: WindowId[] = [];
  for (const id of prospectiveIds) {
    if (isPinned(id)) pinnedFinal.push(id);
    else restFinal.push(id);
  }
  const finalIds = [...pinnedFinal, ...restFinal];
  const finalIndex = finalIds.indexOf(sourceWid);

  const insertionRect = slots[finalIndex]?.rect ?? slots[slots.length - 1]!.rect;

  const isNoOp =
    finalIds.length === targetWindowIds.length &&
    finalIds.every((id, i) => id === targetWindowIds[i]);

  return {
    items: finalIds.map((id) => ({ id })),
    indexInTarget: finalIndex,
    insertionRect,
    isNoOp,
  };
}

interface InsertionSlot {
  rect: { left: number; top: number; width: number; height: number };
}

/**
 * Build one InsertionSlot per gap (0..n inclusive). Interior slots sit
 * centered in the gap between adjacent siblings; their axis (vertical bar
 * vs horizontal bar) is decided per-gap from the local geometry, so a 2D
 * grid gets row-break slots where appropriate. End-cap slots sit centered
 * in the gap between the outermost child and the zone edge.
 */
function buildSlots(otherChildren: HTMLElement[], targetEl: Element): InsertionSlot[] {
  const zoneRect = targetEl.getBoundingClientRect();
  const n = otherChildren.length;
  if (n === 0) {
    const axis = zoneRect.width >= zoneRect.height ? 'x' : 'y';
    return [
      {
        rect:
          axis === 'x'
            ? { left: zoneRect.right - 2, top: zoneRect.top, width: 2, height: zoneRect.height }
            : { left: zoneRect.left, top: zoneRect.bottom - 2, width: zoneRect.width, height: 2 },
      },
    ];
  }
  const rects = otherChildren.map((c) => c.getBoundingClientRect());

  type Interior = { axis: 'x' | 'y'; rect: InsertionSlot['rect'] };
  const interiors: Interior[] = [];
  for (let k = 1; k < n; k++) {
    const prev = rects[k - 1]!;
    const next = rects[k]!;
    const dx = next.left - prev.right;
    const dy = next.top - prev.bottom;
    if (dx >= dy) {
      // Within-line (horizontal flow): vertical bar centered in horizontal gap.
      const x = (prev.right + next.left) / 2;
      const top = Math.min(prev.top, next.top);
      const bottom = Math.max(prev.bottom, next.bottom);
      interiors.push({ axis: 'x', rect: { left: x - 1, top, width: 2, height: bottom - top } });
    } else if (next.width < zoneRect.width * 0.9) {
      // Grid row-break: `next` starts a new row of multiple columns. Show a
      // vertical bar at next.left spanning the new row — "insert here, push
      // the row-start item rightward" — rather than a panel-wide horizontal
      // bar which would imply inserting a whole new row.
      interiors.push({
        axis: 'x',
        rect: { left: next.left - 1, top: next.top, width: 2, height: next.height },
      });
    } else {
      // Vertical flow (stack-like): horizontal bar centered in vertical gap,
      // spanning the zone's width.
      const y = (prev.bottom + next.top) / 2;
      interiors.push({
        axis: 'y',
        rect: { left: zoneRect.left, top: y - 1, width: zoneRect.width, height: 2 },
      });
    }
  }

  // End-cap axis: majority axis of interiors; tie / no interiors → zone aspect.
  let endAxis: 'x' | 'y';
  if (interiors.length > 0) {
    const xCount = interiors.filter((s) => s.axis === 'x').length;
    endAxis = xCount * 2 >= interiors.length ? 'x' : 'y';
  } else {
    endAxis = zoneRect.width >= zoneRect.height ? 'x' : 'y';
  }

  const slots: InsertionSlot[] = [];
  const first = rects[0]!;
  // End-cap slots sit flush with the outermost child's leading/trailing edge
  // — i.e. on the boundary between slots, not centered in the gap toward the
  // zone edge (which would put the line inside an empty grid cell that the
  // dropped item would actually occupy).
  if (endAxis === 'x') {
    slots.push({
      rect: { left: first.left - 1, top: first.top, width: 2, height: first.height },
    });
  } else {
    slots.push({
      rect: { left: first.left, top: first.top - 1, width: first.width, height: 2 },
    });
  }

  for (const s of interiors) slots.push({ rect: s.rect });

  const last = rects[n - 1]!;
  if (endAxis === 'x') {
    slots.push({
      rect: { left: last.right - 1, top: last.top, width: 2, height: last.height },
    });
  } else {
    slots.push({
      rect: { left: last.left, top: last.bottom - 1, width: last.width, height: 2 },
    });
  }

  return slots;
}

function pickNearestSlot(slots: InsertionSlot[], x: number, y: number): number {
  let best = 0;
  let bestDist = Number.POSITIVE_INFINITY;
  for (let k = 0; k < slots.length; k++) {
    const r = slots[k]!.rect;
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const d = Math.hypot(cx - x, cy - y);
    if (d < bestDist) {
      bestDist = d;
      best = k;
    }
  }
  return best;
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

function renderInsertionOutline(
  targetEl: Element,
  rect: { left: number; top: number; width: number; height: number },
): void {
  const doc = targetEl.ownerDocument;
  if (!doc) return;
  let el = doc.body.querySelector('.windease-insertion-outline') as HTMLDivElement | null;
  if (!el) {
    el = doc.createElement('div');
    el.className = 'windease-insertion-outline';
    el.style.position = 'fixed';
    el.style.pointerEvents = 'none';
    doc.body.appendChild(el);
  }
  el.style.left = `${rect.left}px`;
  el.style.top = `${rect.top}px`;
  el.style.width = `${rect.width}px`;
  el.style.height = `${rect.height}px`;
}
