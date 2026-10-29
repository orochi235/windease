import type { CSSProperties } from 'react';
import type { Affordance, NodeId } from '../index.js';
import type { Store } from '../store.js';

export const AFFORDANCE_BASE: CSSProperties = {
  position: 'absolute',
  touchAction: 'none',
  userSelect: 'none',
  // Sit above sibling panels so the +hitPad slack catches pointer events and
  // wins the cursor against adjacent panel content.
  zIndex: 1,
};

/**
 * Raises the child an affordance belongs to — a window's title band, its
 * minimize box — when that child's parent says `raise`. The affordance draws
 * beside the child's wrapper, not inside it, so the wrapper's own click-raise
 * never sees the press. Safe on pointerdown: the pressed element is the
 * affordance, which the raise does not move.
 */
export function raiseOnPress(store: Store, affordance: Affordance): void {
  const id = affordance.childId as NodeId | undefined;
  if (!id) return;
  const parentId = store.getNode(id)?.membership?.parentId;
  if (!parentId) return;
  const raise = (store.getNode(parentId)?.container?.config as { raise?: string } | undefined)
    ?.raise;
  if (raise !== 'click' && raise !== 'focus') return;
  if (store.isLocked(parentId, 'arrange')) return;
  store.raise(id);
}

export const CLICK_RESET: CSSProperties = {
  padding: 0,
  border: 0,
  background: 'transparent',
  font: 'inherit',
  color: 'inherit',
};

/**
 * Expands the hit area perpendicular to the gutter so a 4px line is easier to
 * grab. The outer box catches pointer events; the inner one is the visible
 * rect at the strategy's reported size and carries `data-affordance`, so
 * consumer CSS styles it and not the invisible padding.
 */
export function hitArea(affordance: Affordance, hitPad: number, toward?: 1 | -1) {
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
  // With `toward`, the slack goes on that side alone: the other is a row's
  // edge or the seam before the slot.
  const before = toward === 1 ? 0 : 1;
  const sides = toward === undefined ? 2 : 1;
  const padX = isXish ? hitPad * before : 0;
  const padY = isYish ? hitPad * before : 0;
  const outerStyle: CSSProperties = {
    ...AFFORDANCE_BASE,
    left: affordance.rect.x - padX,
    top: affordance.rect.y - padY,
    width: affordance.rect.w + (isXish ? hitPad * sides : 0),
    height: affordance.rect.h + (isYish ? hitPad * sides : 0),
  };
  if (affordance.cursor) outerStyle.cursor = affordance.cursor;
  // A handle over a stacked child sits at that child's depth; later in the DOM,
  // it wins over its own child and loses to the ones above.
  if (affordance.rect.z > 1) outerStyle.zIndex = Math.round(affordance.rect.z);
  const innerStyle: CSSProperties = {
    position: 'absolute',
    left: padX,
    top: padY,
    width: affordance.rect.w,
    height: affordance.rect.h,
    pointerEvents: 'none',
  };
  return { padX, padY, outerStyle, innerStyle };
}

/** Marks an element armed to be buried. `data-join-armed` is the name it had
 *  before 2.3, still set so a consumer's styles keep matching until 3.0. */
export function buryArmed(on: boolean): Record<string, string> {
  return on ? { 'data-bury-armed': 'true', 'data-join-armed': 'true' } : {};
}
