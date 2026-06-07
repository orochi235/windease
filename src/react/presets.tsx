import { type CSSProperties, type ReactNode, useLayoutEffect } from 'react';
import type { NodeId, Store } from '../index.js';
import { createGroup, createPanel, createZone } from '../index.js';
import {
  ChildRegistryContext,
  ParentScope,
  useChildRegistry,
} from './ParentContext.js';
import { defaultChildSort, type ChildSort } from './childSort.js';
import { useChildren } from './hooks.js';
import { useNodeBinding } from './useNodeBinding.js';
import { useStore } from './Provider.js';

interface CommonBindingProps {
  id?: NodeId;
  parentId?: NodeId;
  order?: number;
  meta?: Record<string, unknown>;
  placement?: Record<string, unknown>;
  hidden?: boolean;
}

interface PresentationalProps {
  className?: string;
  style?: CSSProperties;
  title?: ReactNode;
  children?: ReactNode;
  'data-testid'?: string;
}

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

/* ---------- Panel ---------- */

export interface PanelProps extends CommonBindingProps, PresentationalProps {}

export function Panel(props: PanelProps) {
  const { id } = useNodeBinding({
    ...defined({ id: props.id, parentId: props.parentId, order: props.order }),
    kindHintForAutoId: 'panel',
    factory: (id, parentId) => {
      if (!parentId) {
        throw new Error(
          `windease: <Panel id="${id}"> needs a parent — wrap it in a <Zone> or pass parentId explicitly.`,
        );
      }
      return createPanel({
        id,
        parentId,
        ...defined({
          meta: props.meta,
          placement: props.placement,
          order: props.order,
        }),
      });
    },
    reconcile: makeReconciler(props),
  });

  return (
    <PresetShell
      kind="panel"
      id={id}
      className={props.className}
      style={props.style}
      title={props.title}
      testId={props['data-testid']}
    >
      {props.children}
    </PresetShell>
  );
}

/* ---------- Group ---------- */

export interface GroupProps extends CommonBindingProps, PresentationalProps {
  strategyId?: string;
  config?: unknown;
}

export function Group(props: GroupProps) {
  const { id } = useNodeBinding({
    ...defined({ id: props.id, parentId: props.parentId, order: props.order }),
    kindHintForAutoId: 'group',
    factory: (id, parentId) => {
      if (!parentId) {
        throw new Error(
          `windease: <Group id="${id}"> needs a parent — wrap it in a <Zone> or pass parentId explicitly.`,
        );
      }
      if (!props.strategyId) {
        throw new Error(
          `windease: <Group id="${id}"> requires a strategyId prop.`,
        );
      }
      return createGroup({
        id,
        parentId,
        strategyId: props.strategyId,
        config: props.config,
        ...defined({
          meta: props.meta,
          placement: props.placement,
          order: props.order,
        }),
      });
    },
    reconcile: makeReconciler(props),
  });

  return (
    <PresetShell
      kind="group"
      id={id}
      className={props.className}
      style={props.style}
      title={props.title}
      testId={props['data-testid']}
    >
      {props.children}
    </PresetShell>
  );
}

/* ---------- Zone ---------- */

export interface ZoneProps extends CommonBindingProps, PresentationalProps {
  strategyId?: string;
  config?: unknown;
  viewport?: { w: number; h: number };
  state?: unknown;
  sort?: ChildSort;
}

export function Zone(props: ZoneProps) {
  const { id } = useNodeBinding({
    ...defined({ id: props.id, parentId: props.parentId, order: props.order }),
    kindHintForAutoId: 'zone',
    factory: (id, parentId) => {
      if (!props.strategyId) {
        throw new Error(
          `windease: <Zone id="${id}"> requires a strategyId prop.`,
        );
      }
      return createZone({
        id,
        strategyId: props.strategyId,
        config: props.config,
        ...defined({ parentId: parentId ?? undefined, meta: props.meta, order: props.order }),
      });
    },
    reconcile: (store, id) => {
      const base = makeReconciler(props);
      base(store, id);
      if (props.state !== undefined) store.setContainerState(id, props.state);
    },
  });

  const zoneStyle: CSSProperties = {
    ...(props.viewport
      ? { width: props.viewport.w, height: props.viewport.h }
      : null),
    ...props.style,
  };

  return (
    <PresetShell
      kind="zone"
      id={id}
      className={props.className}
      style={zoneStyle}
      title={props.title}
      testId={props['data-testid']}
      sort={props.sort}
    >
      {props.children}
    </PresetShell>
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
    if (props.placement !== undefined) {
      store.patchPlacement(id, props.placement);
    }
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
  kind: 'panel' | 'group' | 'zone';
  id: NodeId;
  children?: ReactNode | undefined;
  className?: string | undefined;
  style?: CSSProperties | undefined;
  title?: ReactNode | undefined;
  testId?: string | undefined;
  sort?: ChildSort | undefined;
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
}: PresetShellProps) {
  const registry = useChildRegistry();
  // Reset at the top of every render so we capture only the current JSX
  // children, not stale entries from a prior render.
  registry.reset();

  const store = useStore();
  // Subscribe to children so this component re-renders (and the layout
  // effect re-fires) when imperative siblings appear or disappear.
  useChildren(id);

  // After children render and self-report, reconcile sibling order.
  useLayoutEffect(() => {
    const view = store.getContainerView(id);
    if (!view) return; // Not a container (e.g. Panel with no nested presets).
    const currentSet = new Set(view.childIds);
    // Drop any reported entries that aren't actually children of THIS parent
    // (a preset can override parentId to point elsewhere; it still reports to
    // the nearest ChildRegistry by context).
    const jsxEntries = registry
      .snapshot()
      .filter((e) => currentSet.has(e.id));
    const jsxIds = new Set(jsxEntries.map((e) => e.id));
    const currentIds = view.childIds;
    const imperativeIds = currentIds.filter((cid) => !jsxIds.has(cid));
    const sortFn = sort ?? defaultChildSort;
    const orderedJsx = sortFn(
      jsxEntries.map((e) => ({ id: e.id, order: e.order })),
      currentIds,
    );
    const finalOrder = [...orderedJsx, ...imperativeIds];
    // finalOrder is now guaranteed a permutation of currentIds: orderedJsx is
    // a subset of currentIds (post-filter), imperativeIds is the complement,
    // and the two sets are disjoint.
    let same = finalOrder.length === currentIds.length;
    if (same) {
      for (let i = 0; i < finalOrder.length; i++) {
        if (finalOrder[i] !== currentIds[i]) {
          same = false;
          break;
        }
      }
    }
    if (!same) store.setChildOrder(id, finalOrder);
  });

  const wrapperClass =
    kind === 'panel'
      ? 'windease-panel'
      : kind === 'group'
        ? 'windease-group'
        : 'windease-zone';
  const headerClass =
    kind === 'group'
      ? 'windease-group__title'
      : kind === 'panel'
        ? 'windease-panel__title'
        : undefined;

  return (
    <ChildRegistryContext.Provider value={registry}>
      <ParentScope parentId={id}>
        <div
          className={compose(wrapperClass, className)}
          style={style}
          data-testid={testId}
          data-node={id}
        >
          {title !== undefined && headerClass && (
            <header className={headerClass}>{title}</header>
          )}
          {children}
        </div>
      </ParentScope>
    </ChildRegistryContext.Provider>
  );
}
