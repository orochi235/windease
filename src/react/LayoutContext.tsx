import { createContext, type ReactNode, useContext } from 'react';
import type { NodeId, PlacementCommit } from '../index.js';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LayoutInfo {
  placements: ReadonlyMap<NodeId, Rect>;
  /** Children a strategy ran and deliberately withheld. Empty whenever no
   *  strategy ran — flow mode, and a zone whose strategy isn't registered —
   *  which is what lets membership here mean "render nothing" rather than
   *  "nobody placed me". */
  unplaced: ReadonlyArray<NodeId>;
  /** Settle animation duration in ms — children should transition between
   *  placements over this duration. 0 = no transition. */
  settleMs: number;
  /** Lets a child declare that its host owns its placement. Absent when no
   *  container is providing layout, which is why a child must tolerate it. */
  registerPlacementControl?: (id: NodeId, commit: PlacementCommit) => () => void;
  /** Lets a child offer an element as its measured content extent, for
   *  `hints.sizing`. Absent for the same reason. */
  observeNatural?: (id: NodeId, el: Element) => () => void;
}

const EMPTY_LAYOUT: LayoutInfo = { placements: new Map(), unplaced: [], settleMs: 0 };

export const LayoutContext = createContext<LayoutInfo>(EMPTY_LAYOUT);

/** @group Components */
export function LayoutScope({ value, children }: { value: LayoutInfo; children: ReactNode }) {
  return <LayoutContext.Provider value={value}>{children}</LayoutContext.Provider>;
}

/** @group Hooks */
export function useLayoutForSelf(id: NodeId): Rect | undefined {
  return useContext(LayoutContext).placements.get(id);
}

/** Whether the parent's strategy ran and withheld this child. False when no
 *  strategy ran at all.
 *
 *  @group Hooks */
export function useIsUnplaced(id: NodeId): boolean {
  return useContext(LayoutContext).unplaced.includes(id);
}

/** @group Hooks */
export function useLayoutContext(): LayoutInfo {
  return useContext(LayoutContext);
}
