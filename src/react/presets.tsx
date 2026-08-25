import {
  type CSSProperties,
  createContext,
  type ReactNode,
  type RefObject,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ChildSort } from '../child-sort.js';
import type { DropIntent, Node, NodeHints, NodeId, PlacementCommit, Store } from '../index.js';
import {
  accessibleName,
  createNode,
  reconcileChildOrder,
  reconcileContainerConfig,
  reconcileContainerState,
  reconcileHints,
  reconcilePinned,
  reconcilePlacement,
} from '../index.js';
import type { LockSet } from '../lock.js';
import { AffordanceLayer, type AffordanceRenderer } from './affordances.js';
import { DragHandle } from './dnd/DragHandle.js';
import { type DropIntentContext, useDropIntentTarget } from './dnd/useDropIntentTarget.js';
import { useFocusBinding } from './focus/FocusProvider.js';
import { usePublishGeometry } from './focus/usePublishGeometry.js';
import { useChildren, useFocusedNode } from './hooks.js';
import {
  type LayoutInfo,
  LayoutScope,
  type Rect,
  useIsUnplaced,
  useLayoutContext,
  useLayoutForSelf,
} from './LayoutContext.js';
import { MeasuredContent } from './measure.js';
import { ChildRegistryContext, ParentScope, useChildRegistry } from './ParentContext.js';
import { useStore } from './Provider.js';
import { useOptionalStrategyRegistry } from './strategies.js';
import { scrollExtentStyle, useContainerLayout } from './useContainerLayout.js';
import { JSX_OWNER_META_KEY, useNodeBinding } from './useNodeBinding.js';

interface CommonBindingProps {
  id?: NodeId;
  parentId?: NodeId;
  order?: number;
  meta?: Record<string, unknown>;
  placement?: Record<string, unknown>;
  /** Layout hints a strategy reads: `minSize`, `maxSize`, `preferredSize`, and
   *  `sizing` for content-measured axes. Reconciled on change. */
  hints?: NodeHints;
  hidden?: boolean;
  /** When true, registers this preset's wrapper element as a drop target so
   *  consumers can drag items into it. The element must have a container
   *  capability (Zone always does; Panel needs the `container` prop). */
  acceptsDrops?: boolean;
  /** Let a drop onto the middle of a child stack the two into one tabbed
   *  container. Off by default, like `<Container stackOnDrop>`: the gesture
   *  restructures the tree. Requires `acceptsDrops`. */
  stackOnDrop?: boolean;
  /** Let a drop in a cross-axis band of a child split that child's slot into a
   *  two-pane strip. Off by default. Requires `acceptsDrops`. */
  splitOnDrop?: boolean;
  /** Replace the built-in drop hit-test — the callback `<Container dropIntent>`
   *  takes, on the preset that hosts the layout. */
  dropIntent?: (ctx: DropIntentContext) => DropIntent | undefined;
  /** Permissions restricting what the user may do to this node. `true` locks
   *  every axis the node's capabilities support. */
  lock?: boolean | LockSet;
  /** Hold a slot in the parent's childOrder. `true` holds the current index. */
  pinned?: boolean | number;
}

interface PresentationalProps {
  className?: string;
  style?: CSSProperties;
  title?: ReactNode;
  children?: ReactNode;
  'data-testid'?: string;
}

const DEFAULT_SETTLE_MS = 150;

/** The pane an armed seam-join would destroy, published by the preset that owns
 *  the affordance layer and read by that pane's own shell. Internal — a preset's
 *  children render their own wrappers, so a prop cannot reach them. */
const JoinArmContext = createContext<NodeId | null>(null);

function compose(...parts: Array<string | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

/** Build an object containing only keys whose values are not undefined.
 *  Needed because tsconfig has `exactOptionalPropertyTypes: true`. */
function defined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

/** Forces a re-render when `targetId`'s lock changes. Nothing else re-renders
 *  the caller on a bare lock flip, so a render-time reconcile gated on
 *  `isLocked(targetId, ...)` would otherwise stay stuck after an unlock. */
function useForceRerenderOnLockChange(store: Store, targetId: NodeId | undefined): void {
  const [, forceRerender] = useState(0);
  useEffect(() => {
    if (targetId === undefined) return;
    return store.events.on('node.lockChanged', (e) => {
      if (e.id === targetId) forceRerender((t) => t + 1);
    });
  }, [store, targetId]);
}

/** Seam-rendering knobs shared by the presets that can host a layout. Mirrors
 *  the same-named props on `<Container>`; see those for the full contract. */
interface AffordanceHostProps {
  /** Render the strategy's affordances (e.g. strip's resize gutter). Pass a
   *  function to fully replace the built-in handle per affordance. */
  affordances?: boolean | AffordanceRenderer;
  /** Pad the hit area by this many pixels perpendicular to the gutter, so a
   *  4px seam is easier to grab. Default 4. */
  affordanceHitPad?: number;
  /** Pixels an arrow key moves a focused seam. `Home` / `End` jump to its
   *  reported minimum / maximum instead. Default 8. */
  affordanceKeyStep?: number;
  /** Whether seams are tab stops. Default true. */
  affordanceTabStops?: boolean;
}

/* ---------- Panel ---------- */

export interface PanelProps extends CommonBindingProps, PresentationalProps, AffordanceHostProps {
  /** Promotes this panel to a container with the given strategy. Lets it host
   *  nested presets (`<Panel container={...}><Panel /></Panel>`). When absent,
   *  Panel is a leaf — nested presets will fail with "parent has no container".
   *  `config` reconciles the way `<Zone config>` does. */
  container?: { strategyId: string; config?: unknown };
  /** When true, wraps the panel's rendered content in a DragHandle so the
   *  user can drag this panel to another acceptsDrops target. */
  draggable?: boolean;
  /**
   * Makes this panel's placement controlled: a seam drag hands the bag it
   * would have written here instead of committing it, and the panel renders
   * whatever `placement` the host feeds back. The controlled counterpart to
   * declaring `placement` and letting the store own it.
   *
   * Without this, a declared `placement` is re-forced on every render and a
   * drag is reverted on the next one — declare one or the other, not both.
   */
  onPlacementChange?: PlacementCommit;
}

/** Registers `commit` as `id`'s placement control on whichever container is
 *  providing layout above. Absent context (a Panel outside a laid-out parent)
 *  is a no-op rather than an error — the same component renders both ways. */
function usePlacementControl(id: NodeId, commit: PlacementCommit | undefined): void {
  const { registerPlacementControl } = useLayoutContext();
  const latest = useRef(commit);
  latest.current = commit;
  // Registration turns on the presence of a handler, not its identity: an
  // inline arrow is a new function every render, and depending on it would
  // unregister and re-register the control on each one. The ref keeps the
  // call current without that churn.
  const enabled = commit !== undefined;
  useEffect(() => {
    if (!enabled || !registerPlacementControl) return;
    return registerPlacementControl(id, (next, change) => latest.current?.(next, change));
  }, [id, registerPlacementControl, enabled]);
}

/** The measurement box a node's `hints.sizing` asks for, bound to whichever
 *  container is providing layout above. Read before this preset provides a
 *  scope of its own, so a nested container measures against its parent. */
function useMeasure(store: Store, id: NodeId, parent: LayoutInfo): PresetShellProps['measure'] {
  const sizing = store.getNode(id)?.hints?.sizing;
  const observe = parent.observeNatural;
  if (!sizing || !observe) return undefined;
  return { observe, widthByContent: sizing.w === 'content' };
}

/** @group Components */
export function Panel(props: PanelProps) {
  const declaredConfig = useRef<unknown>(props.container?.config ?? {});
  const { id } = useNodeBinding({
    ...defined({ id: props.id, parentId: props.parentId, order: props.order }),
    kindHintForAutoId: 'panel',
    factory: (id, parentId) => {
      if (!parentId) {
        throw new Error(
          `windease: <Panel id="${id}"> needs a parent — wrap it in a <Zone> or pass parentId explicitly.`,
        );
      }
      return createNode({
        id,
        parentId,
        focus: true,
        kind: 'panel',
        meta: props.meta,
        placement: props.placement,
        hints: props.hints,
        order: props.order,
        ...(props.container
          ? {
              container: {
                strategyId: props.container.strategyId,
                config: props.container.config ?? {},
              },
            }
          : null),
      });
    },
    reconcile: (store, id) => {
      makeReconciler(props)(store, id);
      if (props.container) {
        reconcileContainerConfig(store, id, props.container.config ?? {}, declaredConfig.current);
        declaredConfig.current = props.container.config ?? {};
      }
    },
  });

  // A pending `pinned` prop that skipped because the parent was arrange-
  // locked needs a re-render on unlock to re-run the reconcile above.
  const store = useStore();
  useForceRerenderOnLockChange(store, store.getNode(id)?.membership?.parentId);
  usePlacementControl(id, props.onPlacementChange);
  // Read the parent's scope here, before PanelWithLayout provides its own.
  const measure = useMeasure(store, id, useLayoutContext());

  // Mirror Zone's layout-providing path: if this Panel is a container AND a
  // matching strategy is registered, run the layout and provide placements
  // to descendants via LayoutContext. Otherwise stay a plain shell.
  const registry = useOptionalStrategyRegistry();
  const canProvideLayout =
    !!props.container && !!registry && registry.has(props.container.strategyId);

  if (canProvideLayout) {
    return <PanelWithLayout {...props} id={id} measure={measure} />;
  }

  return (
    <PresetShell
      kind="panel"
      id={id}
      className={props.className}
      style={props.style}
      title={props.title}
      testId={props['data-testid']}
      acceptsDrops={props.acceptsDrops}
      drop={{
        ...(props.stackOnDrop ? { stackOnDrop: props.stackOnDrop } : {}),
        ...(props.splitOnDrop ? { splitOnDrop: props.splitOnDrop } : {}),
        ...(props.dropIntent ? { dropIntent: props.dropIntent } : {}),
      }}
      measure={measure}
    >
      {props.draggable ? <DragHandle nodeId={id}>{props.children}</DragHandle> : props.children}
    </PresetShell>
  );
}

interface PanelWithLayoutProps extends PanelProps {
  id: NodeId;
  measure: PresetShellProps['measure'];
}

/**
 * Panel variant that runs `useContainerLayout` and provides placements to
 * descendants via `LayoutContext`. Only rendered when this Panel was promoted
 * to a container via the `container` prop AND a strategy registry containing
 * that strategyId is in scope. Mirrors `ZoneWithLayout`, but a Panel has no
 * `viewport` prop — it measures its own DOM box.
 */
function PanelWithLayout(props: PanelWithLayoutProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const layout = useContainerLayout(props.id, ref);
  usePublishGeometry(props.id, ref, layout);
  const store = useStore();
  const settleMs = DEFAULT_SETTLE_MS;
  const [, setDraggingAffordanceId] = useState<string | null>(null);
  const [joinArmedId, setJoinArmedId] = useState<NodeId | null>(null);
  const layoutInfo: LayoutInfo = {
    placements: layout.placements,
    unplaced: layout.unplaced,
    settleMs,
    registerPlacementControl: layout.registerPlacementControl,
    observeNatural: layout.observeNatural,
  };

  const panelStyle: CSSProperties = {
    position: 'relative',
    ...scrollExtentStyle(layout),
    ...props.style,
  };

  return (
    <LayoutScope value={layoutInfo}>
      <PresetShell
        kind="panel"
        id={props.id}
        className={props.className}
        style={panelStyle}
        title={props.title}
        testId={props['data-testid']}
        innerRef={ref}
        acceptsDrops={props.acceptsDrops}
        drop={{
          ...(props.stackOnDrop ? { stackOnDrop: props.stackOnDrop } : {}),
          ...(props.splitOnDrop ? { splitOnDrop: props.splitOnDrop } : {}),
          ...(props.dropIntent ? { dropIntent: props.dropIntent } : {}),
          hostsLayout: true,
        }}
        measure={props.measure}
        joinArmedId={joinArmedId}
      >
        {props.draggable ? (
          <DragHandle nodeId={props.id}>{props.children}</DragHandle>
        ) : (
          props.children
        )}
        <AffordanceLayer
          render={props.affordances ?? false}
          affordances={layout.affordances}
          dispatch={layout.dispatchAffordance}
          store={store}
          hitPad={props.affordanceHitPad ?? 4}
          keyStep={props.affordanceKeyStep ?? 8}
          tabStop={props.affordanceTabStops ?? true}
          onActiveChange={setDraggingAffordanceId}
          onJoinArmChange={setJoinArmedId}
        />
      </PresetShell>
    </LayoutScope>
  );
}

/* ---------- Zone ---------- */

export interface ZoneProps extends CommonBindingProps, PresentationalProps, AffordanceHostProps {
  strategyId?: string;
  /** Config for this zone's strategy. Reconciled against what the last render
   *  declared: a changed key is applied and a dropped one deleted, while a key
   *  a gesture wrote — a stack's `activeId` — is left alone. */
  config?: unknown;
  viewport?: { w: number; h: number };
  state?: unknown;
  sort?: ChildSort;
  /**
   * Settle animation duration in ms for children moving between
   * strategy-computed placements. Default 150. Set to 0 to disable.
   */
  settleMs?: number;
  /**
   * Optional renderer for children that exist in the store but were NOT
   * declared as JSX siblings (i.e. added imperatively via
   * `store.registerNode`). Receives the node; the returned ReactNode is
   * wrapped in an absolute-positioned box at the strategy-computed rect.
   * When omitted, imperative-only children still occupy a strategy slot
   * but render no DOM — preserves previous behavior.
   */
  renderImperative?: (node: Node) => ReactNode;
  /**
   * Overrides the `kind` label, which drives the wrapper class and
   * `ChromeMap` dispatch — pass `kind="group"` for the old removed group preset.
   */
  kind?: string;
}

/** @group Components */
export function Zone(props: ZoneProps) {
  // The config this component last declared. The factory writes the first one,
  // so the reconcile below sees a change only when the prop itself moves.
  const declaredConfig = useRef<unknown>(props.config);
  const { id } = useNodeBinding({
    ...defined({ id: props.id, parentId: props.parentId, order: props.order }),
    kindHintForAutoId: 'zone',
    factory: (id, parentId) => {
      // A flow zone never runs a strategy, so demanding an id for one would be
      // asking the consumer to name something that is then ignored.
      const flow = props.hints?.render === 'flow';
      if (!props.strategyId && !flow) {
        throw new Error(`windease: <Zone id="${id}"> requires a strategyId prop.`);
      }
      return createNode({
        id,
        kind: props.kind ?? 'zone',
        container: { strategyId: props.strategyId ?? 'flow', config: props.config },
        parentId: parentId ?? undefined,
        meta: props.meta,
        hints: props.hints,
        order: props.order,
      });
    },
    reconcile: (store, id) => {
      const base = makeReconciler(props);
      base(store, id);
      if (props.state !== undefined) reconcileContainerState(store, id, props.state);
      reconcileContainerConfig(store, id, props.config, declaredConfig.current);
      declaredConfig.current = props.config;
    },
  });

  // Decide whether to provide layout to descendants. We need both:
  // 1. A StrategyRegistryProvider in the tree (otherwise useContainerLayout
  //    has nothing to look up).
  // 2. The strategyId to actually be registered there.
  // The hook below is stable (always called); the registry presence is
  // stable for a given mount, so a downstream conditional render of
  // <ZoneWithLayout> vs <ZonePlain> is safe.
  const registry = useOptionalStrategyRegistry();
  // A flow zone takes the plain path even with its strategy registered: the
  // hint is the declaration, not the absence of a registry entry.
  const canProvideLayout =
    props.hints?.render !== 'flow' &&
    !!props.strategyId &&
    !!registry &&
    registry.has(props.strategyId);
  const store = useStore();
  // Read the parent's scope here, before ZoneWithLayout provides its own.
  const measure = useMeasure(store, id, useLayoutContext());

  if (canProvideLayout) {
    return <ZoneWithLayout {...props} id={id} measure={measure} />;
  }

  const zoneStyle = composeZoneStyle(props);
  return (
    <PresetShell
      kind={props.kind ?? 'zone'}
      id={id}
      className={props.className}
      style={zoneStyle}
      title={props.title}
      testId={props['data-testid']}
      sort={props.sort}
      acceptsDrops={props.acceptsDrops}
      drop={{
        ...(props.stackOnDrop ? { stackOnDrop: props.stackOnDrop } : {}),
        ...(props.splitOnDrop ? { splitOnDrop: props.splitOnDrop } : {}),
        ...(props.dropIntent ? { dropIntent: props.dropIntent } : {}),
      }}
      measure={measure}
    >
      {props.children}
    </PresetShell>
  );
}

function composeZoneStyle(props: ZoneProps): CSSProperties {
  return {
    ...(props.viewport ? { width: props.viewport.w, height: props.viewport.h } : null),
    ...props.style,
  };
}

interface ZoneWithLayoutProps extends ZoneProps {
  id: NodeId;
  measure: PresetShellProps['measure'];
}

/**
 * Zone variant that runs `useContainerLayout` and provides placements to
 * descendants via `LayoutContext`. Only rendered when a strategy registry
 * containing the zone's strategyId is in scope. Hook order is stable for
 * the component instance because the parent Zone's decision flips only
 * when the registry context changes, which would unmount/remount this
 * subtree.
 */
function ZoneWithLayout(props: ZoneWithLayoutProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const layout = useContainerLayout(props.id, ref, props.viewport);
  usePublishGeometry(props.id, ref, layout);
  const store = useStore();
  const settleMs = props.settleMs ?? DEFAULT_SETTLE_MS;
  const [, setDraggingAffordanceId] = useState<string | null>(null);
  const [joinArmedId, setJoinArmedId] = useState<NodeId | null>(null);
  const layoutInfo: LayoutInfo = {
    placements: layout.placements,
    unplaced: layout.unplaced,
    settleMs,
    registerPlacementControl: layout.registerPlacementControl,
    observeNatural: layout.observeNatural,
  };

  // When this Zone is itself absolute-positioned by a parent strategy, our
  // wrapper div is the absolute box and PresetShell's div needs to fill it
  // and serve as the positioned ancestor for descendants. When the Zone is
  // a root, the viewport prop (or style) sets its size.
  const zoneStyle: CSSProperties = {
    position: 'relative',
    ...(props.viewport ? { width: props.viewport.w, height: props.viewport.h } : null),
    ...scrollExtentStyle(layout),
    ...props.style,
  };

  // Render store-only (imperative) children if the consumer provided a
  // renderer. We subscribe to children here AND in PresetShell (the latter
  // is needed for sibling-order reconciliation); the duplicate subscription
  // is cheap and keeps both responsibilities co-located with their use.
  const allChildren = useChildren(props.id);
  const renderImperative = props.renderImperative;
  const imperativeRenders = useMemo(() => {
    if (!renderImperative) return null;
    const out: ReactNode[] = [];
    for (const node of allChildren) {
      const meta = node.meta as Record<string, unknown> | undefined;
      if (meta?.[JSX_OWNER_META_KEY]) continue;
      const rect = layout.placements.get(node.id);
      if (!rect) continue;
      out.push(
        <AbsoluteWrapper key={`imp-${node.id}`} rect={rect} parentId={props.id} nodeId={node.id}>
          {renderImperative(node)}
        </AbsoluteWrapper>,
      );
    }
    return out;
  }, [renderImperative, allChildren, layout.placements, props.id]);

  return (
    <LayoutScope value={layoutInfo}>
      <PresetShell
        kind={props.kind ?? 'zone'}
        id={props.id}
        className={props.className}
        style={zoneStyle}
        title={props.title}
        testId={props['data-testid']}
        sort={props.sort}
        innerRef={ref}
        acceptsDrops={props.acceptsDrops}
        drop={{
          ...(props.stackOnDrop ? { stackOnDrop: props.stackOnDrop } : {}),
          ...(props.splitOnDrop ? { splitOnDrop: props.splitOnDrop } : {}),
          ...(props.dropIntent ? { dropIntent: props.dropIntent } : {}),
          hostsLayout: true,
        }}
        measure={props.measure}
        joinArmedId={joinArmedId}
      >
        {props.children}
        {imperativeRenders}
        <AffordanceLayer
          render={props.affordances ?? false}
          affordances={layout.affordances}
          dispatch={layout.dispatchAffordance}
          store={store}
          hitPad={props.affordanceHitPad ?? 4}
          keyStep={props.affordanceKeyStep ?? 8}
          tabStop={props.affordanceTabStops ?? true}
          onActiveChange={setDraggingAffordanceId}
          onJoinArmChange={setJoinArmedId}
        />
      </PresetShell>
    </LayoutScope>
  );
}

/* ---------- Shared ---------- */

function makeReconciler(props: CommonBindingProps) {
  return (store: Store, id: NodeId) => {
    if (props.meta !== undefined) {
      // setMeta is a patch (not a replace), so the JSX_OWNER_META_KEY marker
      // stamped by useNodeBinding survives untouched.
      store.setMeta(id, props.meta);
    }
    if (props.hints !== undefined) reconcileHints(store, id, props.hints);
    if (props.placement !== undefined) reconcilePlacement(store, id, props.placement);
    if (props.lock !== undefined) store.setLock(id, props.lock);
    if (props.pinned !== undefined) reconcilePinned(store, id, props.pinned);
    const node = store.getNode(id);
    if (!node) return;
    if (props.hidden) {
      if (node.lifecycle.state !== 'hidden') store.hideNode(id);
    } else {
      if (node.lifecycle.state !== 'visible') store.showNode(id);
    }
  };
}

interface PresetShellProps {
  kind: string;
  id: NodeId;
  children?: ReactNode | undefined;
  className?: string | undefined;
  style?: CSSProperties | undefined;
  title?: ReactNode | undefined;
  testId?: string | undefined;
  sort?: ChildSort | undefined;
  /** Optional ref attached to the wrapper div — used by ZoneWithLayout to
   *  measure the container viewport. */
  innerRef?: RefObject<HTMLDivElement | null> | undefined;
  /** When true, registers the wrapper div as a drop target via
   *  `useDropIntentTarget`. The hook is always called (to preserve hook
   *  order); registration is conditional on this flag. */
  acceptsDrops?: boolean | undefined;
  /** Drop hit-test inputs, from the preset that owns them. `<Container>` runs
   *  the same hook. */
  drop?:
    | {
        stackOnDrop?: boolean | undefined;
        splitOnDrop?: boolean | undefined;
        dropIntent?: ((ctx: DropIntentContext) => DropIntent | undefined) | undefined;
        /** A strategy places these children. Without one, CSS does, and the
         *  axis is read off the arrangement rather than the config. */
        hostsLayout?: boolean | undefined;
      }
    | undefined;
  /** Wraps this preset's content in a measurement box reporting its natural
   *  extent, for a node whose `hints.sizing` asked to be measured. */
  measure?:
    | { observe: (id: NodeId, el: Element) => () => void; widthByContent: boolean }
    | undefined;
  /** The pane an armed seam-join would destroy, for a shell that owns an
   *  affordance layer. Published to descendants, never read for this shell —
   *  a seam names one of its own container's children. */
  joinArmedId?: NodeId | null | undefined;
}

/** Wrapper div + ChildRegistry host + ParentContext + sibling-order reconciliation. */
function PresetShell({
  kind,
  id,
  children,
  className,
  style,
  title,
  testId,
  sort,
  innerRef,
  acceptsDrops,
  drop,
  measure,
  joinArmedId,
}: PresetShellProps) {
  // We need a single ref on the wrapper div that serves both layout
  // measurement (innerRef, when provided) and drop-target registration.
  // The hook is always called to keep hook order stable; the `enabled` flag
  // gates the underlying registerDropTarget call.
  const ownRef = useRef<HTMLDivElement | null>(null);
  const wrapperRef = innerRef ?? ownRef;
  const store = useStore();
  const ownContainer = store.getNode(id)?.container;
  const ownAxis = (ownContainer?.config as { axis?: 'x' | 'y' } | undefined)?.axis;
  useDropIntentTarget(id, wrapperRef, {
    enabled: acceptsDrops === true,
    ...(ownAxis ? { axis: ownAxis } : {}),
    ...(ownContainer?.strategyId ? { strategyId: ownContainer.strategyId } : {}),
    isFlow: !drop?.hostsLayout,
    ...(drop?.stackOnDrop ? { stackOnDrop: drop.stackOnDrop } : {}),
    ...(drop?.splitOnDrop ? { splitOnDrop: drop.splitOnDrop } : {}),
    ...(drop?.dropIntent ? { dropIntent: drop.dropIntent } : {}),
  });
  const registry = useChildRegistry();
  // Reset at the top of every render so we capture only the current JSX
  // children, not stale entries from a prior render.
  registry.reset();

  // Subscribe to children so this component re-renders (and the layout
  // effect re-fires) when imperative siblings appear or disappear.
  useChildren(id);

  // Same roving tab stop `<Container>` gives the children it renders: without
  // it a preset pane cannot take the caret, so nothing can navigate away from
  // one either. Only a node declaring `focus` is a candidate.
  const focusBinding = useFocusBinding();
  const rovingId = useFocusedNode()?.id ?? focusBinding?.entryId ?? null;
  const focusable = store.getNode(id)?.focus !== undefined;

  // A pending sibling-order reconciliation that skipped for lock.arrange
  // needs a re-render on unlock to re-run the effect below.
  useForceRerenderOnLockChange(store, id);

  // If a parent container's strategy assigned this node a rect, wrap our
  // DOM in an absolute-positioned box so we render at the right place.
  const selfRect = useLayoutForSelf(id);
  const withheld = useIsUnplaced(id);
  const armedByParent = useContext(JoinArmContext);

  // After children render and self-report, reconcile sibling order.
  useLayoutEffect(() => {
    const view = store.getContainerView(id);
    if (!view) return; // Not a container (e.g. Panel with no nested presets).
    // Drop reported entries that aren't children of THIS parent: a preset can
    // override parentId to point elsewhere and still report to the nearest
    // ChildRegistry by context. Core drops them too; doing it here keeps the
    // observed list honest about what JSX actually nested.
    const currentSet = new Set(view.childOrder);
    const observed = registry
      .snapshot()
      .filter((e) => currentSet.has(e.id))
      .map((e) => ({ id: e.id, order: e.order }));
    reconcileChildOrder(store, id, observed, sort ? { sort } : undefined);
  });

  const wrapperClass =
    kind === 'panel' ? 'windease-panel' : kind === 'group' ? 'windease-group' : 'windease-zone';
  const headerClass =
    kind === 'group'
      ? 'windease-group__title'
      : kind === 'panel'
        ? 'windease-panel__title'
        : undefined;

  const body = (
    <>
      {title !== undefined && headerClass && <header className={headerClass}>{title}</header>}
      {children}
    </>
  );
  const content =
    joinArmedId === undefined ? (
      body
    ) : (
      <JoinArmContext.Provider value={joinArmedId}>{body}</JoinArmContext.Provider>
    );

  const shell = (
    <ChildRegistryContext.Provider value={registry}>
      <ParentScope parentId={id}>
        {/* biome-ignore lint/a11y/useAriaPropsSupportedByRole: aria-label is set only alongside role="group", under the same condition; the rule cannot see through the conditional. */}
        <div
          ref={wrapperRef}
          className={compose(wrapperClass, className)}
          style={style}
          data-testid={testId}
          data-node={id}
          data-node-container={id}
          data-join-armed={armedByParent === id ? 'true' : undefined}
          tabIndex={focusable ? (rovingId === id ? 0 : -1) : undefined}
          role={focusable ? 'group' : undefined}
          aria-label={focusable ? accessibleName(store, id) : undefined}
        >
          {measure ? (
            <MeasuredContent
              id={id}
              widthByContent={measure.widthByContent}
              observe={measure.observe}
            >
              {content}
            </MeasuredContent>
          ) : (
            content
          )}
        </div>
      </ParentScope>
    </ChildRegistryContext.Provider>
  );

  // A missing rect means nobody is placing us — flow mode, or a zone whose
  // strategy isn't registered — and we render where the consumer's JSX put us.
  // Being in `unplaced` is the opposite: a strategy ran and withheld us.
  if (withheld) return null;
  if (!selfRect) return shell;

  return (
    <AbsoluteWrapper rect={selfRect} parentId={store.getNode(id)?.membership?.parentId}>
      {shell}
    </AbsoluteWrapper>
  );
}

/** Absolute-positioned box that places its child at the strategy-computed
 *  rect. Reads `settleMs` from `LayoutContext` so all siblings animate
 *  consistently. */
function AbsoluteWrapper({
  rect,
  parentId,
  nodeId,
  children,
}: {
  rect: Rect;
  parentId?: NodeId | undefined;
  /** Set when this box is the child's only chrome — an imperative render,
   *  which stamps no `data-node` of its own and would be invisible to every
   *  DOM harvest, the drop hit-test included. */
  nodeId?: NodeId | undefined;
  children: ReactNode;
}) {
  const { settleMs } = useLayoutContext();
  const style: CSSProperties = {
    position: 'absolute',
    left: rect.x,
    top: rect.y,
    width: rect.w,
    height: rect.h,
  };
  if (settleMs > 0) {
    style.transition = `left ${settleMs}ms ease, top ${settleMs}ms ease, width ${settleMs}ms ease, height ${settleMs}ms ease`;
  }
  return (
    <div style={style} data-node={nodeId} data-node-container={parentId}>
      {children}
    </div>
  );
}
