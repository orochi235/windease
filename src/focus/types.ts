import type { Rect } from '../layout-types.js';
import type { NodeId } from '../node.js';

/** Where a node sits, in one coordinate space shared by the whole tree. The
 *  resolver never measures — a host supplies this. */
export interface GeometrySource {
  rectOf(id: NodeId): Rect | null;
}

export type NavIntent =
  | 'next'
  | 'prev'
  | 'first'
  | 'last'
  | 'left'
  | 'right'
  | 'up'
  | 'down'
  | 'cycleNext'
  | 'cyclePrev';

export type NavDirection = 'left' | 'right' | 'up' | 'down';

/** Reflects model focus onto whatever the host platform's focus is. The DOM
 *  implementation moves the caret; a canvas host draws a ring. Input flows the
 *  other way through store methods, so it needs no surface here. */
export interface FocusAdapter {
  present(id: NodeId | null): void;
  announce(text: string): void;
}
