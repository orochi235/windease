import { type CSSProperties, Fragment, type ReactNode, useCallback, useRef } from 'react';
import {
  type Affordance,
  accessibleName,
  clipUnderBand,
  frozenBands,
  type NodeId,
  type Rect,
  type StickyInset,
  stuckRect,
} from '../index.js';
import type { Store } from '../store.js';
import { AffordanceHandle, type WritePlacement } from './AffordanceHandle.js';
import { AFFORDANCE_BASE, CLICK_RESET, raiseOnPress } from './affordance-hit.js';
import { preventNativeDrag } from './dnd/nativeDrag.js';
import { RevealHandle } from './RevealHandle.js';
import type { ContainerLayout } from './useContainerLayout.js';

/** Args passed to function-form `affordances` callbacks. The function fully
 *  replaces the default renderer and is responsible for pointer events; call
 *  `dispatch` with `{ affordanceId, kind, payload }` to drive the strategy. */
export interface AffordanceRenderArgs {
  affordance: Affordance;
  dispatch: ContainerLayout['dispatchAffordance'];
  hitPad: number;
}

/**
 * Replaces the built-in affordance layer wholesale. Taking this over means
 * owning pointer handling and keyboard operability for every seam it draws.
 */
export type AffordanceRenderer = (args: AffordanceRenderArgs) => ReactNode;

/**
 * What a screen reader announces for a gutter. Composed from the panes the
 * affordance moves, using the same naming the focus system uses, so a consumer
 * who set `meta.title` gets a usable name without a second API.
 */
function affordanceLabel(store: Store, aff: Affordance): string | undefined {
  if (aff.name) return aff.name;
  const ids = aff.affects ?? (aff.childId ? [aff.childId] : []);
  if (ids.length === 0) return undefined;
  const names = ids.map((id) => accessibleName(store, id as NodeId));
  return `${aff.label ?? 'resize'} ${names.join(' and ')}`;
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
  /** The container's scroll in layout pixels (see `toLayoutScroll`), which a
   *  sticky seam is held against. */
  scroll?: { x: number; y: number };
  /** The container's placements and sticky insets, which a seam scrolled
   *  under a frozen pane is clipped against. */
  placements?: ReadonlyMap<NodeId, Rect>;
  sticky?: ReadonlyMap<NodeId, StickyInset> | undefined;
  /** How a seam join puts sizes back: through placement control where a child
   *  has it. Absent, straight to the store. */
  writePlacement?: WritePlacement;
}

const NO_SCROLL = { x: 0, y: 0 };

/** The axis a seam drags along, which is the one a frozen pane hides it on. */
function seamAxis(aff: Affordance): 'x' | 'y' | undefined {
  const o = aff.bounds?.orientation;
  return o === 'horizontal' ? 'x' : o === 'vertical' ? 'y' : undefined;
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
  scroll = NO_SCROLL,
  placements,
  sticky,
  writePlacement,
}: AffordanceLayerProps) {
  // Each handle keeps the DOM slot it first rendered in; stacking comes from
  // its rect's `z`. Following the strategy's order instead would move a
  // pressed handle when the press raises its window, dropping the pointer
  // capture the drag runs on.
  const firstSeen = useRef(new Map<string, number>());
  const seen = firstSeen.current;
  for (const aff of affordances) if (!seen.has(aff.id)) seen.set(aff.id, seen.size);
  const ordered = [...affordances].sort((a, b) => (seen.get(a.id) ?? 0) - (seen.get(b.id) ?? 0));
  if (!render) return null;
  const bands = placements && sticky ? frozenBands(placements, sticky, scroll) : undefined;
  return (
    <>
      {ordered.map((placed) => {
        const across = seamAxis(placed);
        const rect = stuckRect(placed.rect, placed.sticky, scroll);
        const shown = bands && across ? clipUnderBand(rect, across, bands, placed.sticky) : rect;
        const aff = shown === placed.rect ? placed : { ...placed, rect: shown };
        return typeof render === 'function' ? (
          <Fragment key={aff.id}>{render({ affordance: aff, dispatch, hitPad })}</Fragment>
        ) : aff.kind === 'click' ? (
          <ClickAffordance
            key={aff.id}
            affordance={aff}
            dispatch={dispatch}
            store={store}
            tabStop={tabStop}
            label={affordanceLabel(store, aff)}
          />
        ) : aff.reveal ? (
          <RevealHandle
            key={aff.id}
            affordance={aff}
            store={store}
            hitPad={hitPad}
            tabStop={tabStop}
            label={affordanceLabel(store, aff)}
            onActiveChange={(active) => onActiveChange(active ? aff.id : null)}
          />
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
            writePlacement={writePlacement}
          />
        );
      })}
    </>
  );
}

interface ClickAffordanceProps {
  affordance: Affordance;
  dispatch: ContainerLayout['dispatchAffordance'];
  store: Store;
  tabStop: boolean;
  label: string | undefined;
}

/** A `click` affordance: an empty native button, which sends one `'click'` event
 *  per press from the pointer, Enter or Space. The chrome beneath draws it. */
function ClickAffordance({ affordance, dispatch, store, tabStop, label }: ClickAffordanceProps) {
  const press = useCallback(() => {
    raiseOnPress(store, affordance);
    dispatch({ affordanceId: affordance.id, kind: 'click', payload: {} });
  }, [dispatch, store, affordance]);
  const { rect } = affordance;
  const style: CSSProperties = {
    ...AFFORDANCE_BASE,
    ...CLICK_RESET,
    left: rect.x,
    top: rect.y,
    width: rect.w,
    height: rect.h,
  };
  if (rect.z > 1) style.zIndex = Math.round(rect.z);
  if (affordance.cursor) style.cursor = affordance.cursor;
  return (
    <button
      type="button"
      className="windease-affordance-hit"
      style={style}
      tabIndex={tabStop ? 0 : -1}
      aria-label={label}
      data-affordance-hit={affordance.id}
      data-affordance={affordance.id}
      data-affordance-kind={affordance.kind}
      onClick={press}
      draggable={false}
      onDragStart={preventNativeDrag}
    />
  );
}
