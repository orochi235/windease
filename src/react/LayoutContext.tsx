import { type ReactNode, createContext, useContext } from 'react';
import type { NodeId } from '../index.js';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LayoutInfo {
  placements: ReadonlyMap<NodeId, Rect>;
  /** Settle animation duration in ms — children should transition between
   *  placements over this duration. 0 = no transition. */
  settleMs: number;
}

const EMPTY_LAYOUT: LayoutInfo = { placements: new Map(), settleMs: 0 };

export const LayoutContext = createContext<LayoutInfo>(EMPTY_LAYOUT);

/** @group Components */
export function LayoutScope({
  value,
  children,
}: {
  value: LayoutInfo;
  children: ReactNode;
}) {
  return <LayoutContext.Provider value={value}>{children}</LayoutContext.Provider>;
}

/** @group Hooks */
export function useLayoutForSelf(id: NodeId): Rect | undefined {
  return useContext(LayoutContext).placements.get(id);
}

/** @group Hooks */
export function useLayoutContext(): LayoutInfo {
  return useContext(LayoutContext);
}
