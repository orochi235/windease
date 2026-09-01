import { createContext, type ReactNode, useContext } from 'react';
import type { NodeId, PlacementCommit } from '../index.js';

/** A child's placement in its parent's coordinate space. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** What a container publishes to its children: their placements, which of
 *  them went unplaced, and the settle duration for moves between them. */
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

/**
 * Raw layout context. Defaults to an empty layout, so a preset rendered
 * outside any container reads no placement rather than throwing — which is
 * what lets the same component render both inside a zone and standalone.
 */
export const LayoutContext = createContext<LayoutInfo>(EMPTY_LAYOUT);

/**
 * Publishes one container's layout to its subtree. Container presets do this
 * for you; use it directly only when hosting a strategy by hand.
 * @group Components
 */
export function LayoutScope({ value, children }: { value: LayoutInfo; children: ReactNode }) {
  return <LayoutContext.Provider value={value}>{children}</LayoutContext.Provider>;
}

/**
 * This node's rect from the enclosing container's last layout pass, or
 * `undefined` before one has run or when the strategy withheld it. Read it to
 * position custom chrome; the presets already apply it themselves.
 * @group Hooks
 */
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

/**
 * The enclosing container's whole {@link LayoutInfo}. Prefer
 * {@link useLayoutForSelf} when one rect is all you need.
 * @group Hooks
 */
export function useLayoutContext(): LayoutInfo {
  return useContext(LayoutContext);
}
