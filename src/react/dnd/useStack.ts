import { useCallback, useMemo } from 'react';
import { accessibleName, type NodeId, type Rect } from '../../index.js';
import { useChildren, useNode } from '../hooks.js';
import { useLayoutContext } from '../LayoutContext.js';
import { useStore } from '../Provider.js';

/** One tab in a {@link StackModel}: the child it selects and the label to
 *  show for it. */
export interface StackTab {
  id: NodeId;
  /** What to label the tab with. */
  title: string;
  /** This tab's own title bar under `tabs: 'stacked'`; see {@link StackModel.band}. */
  bar?: Rect;
}

/** A tabbed container rendered as data — the tabs, which is active, and the
 *  callbacks to switch or close one. Bring your own markup. */
export interface StackModel {
  /** The stack's children, in `childOrder`. */
  tabs: StackTab[];
  /** Which tab the strategy is showing. Undefined only for an empty stack. */
  activeId: NodeId | undefined;
  /** Show `id`. A no-op for an id that is not a child of this stack. */
  activate(id: NodeId): void;
  /** The band the strategy reserved for tabs, in the stack's own coordinates.
   *  Read from the stack's layout, so it is set only where that layout is in
   *  scope: its `overlay`, its affordance renderers and its children. */
  band?: Rect;
}

/**
 * The tab model for a stack container. The strip itself is the consumer's to
 * draw — this answers what to draw and what a click means.
 *
 * @group Hooks
 */
export function useStack(containerId: NodeId): StackModel {
  const store = useStore();
  const node = useNode(containerId);
  const children = useChildren(containerId);
  const configuredActive = (node?.container?.config as { activeId?: string } | undefined)?.activeId;

  const { channels } = useLayoutContext();
  const tabs = useMemo(
    () =>
      children.map((c) => {
        const tab: StackTab = { id: c.id, title: accessibleName(store, c.id) };
        const bar = rectOf(channels?.get(c.id), 'tab');
        if (bar) tab.bar = bar;
        return tab;
      }),
    [children, store, channels],
  );
  const band = tabs[0] && rectOf(channels?.get(tabs[0].id), 'band');

  // The strategy falls back to the first child for an activeId naming one that
  // has left, so the model has to report the same tab the body is showing.
  const activeId = tabs.some((t) => t.id === configuredActive)
    ? (configuredActive as NodeId)
    : tabs[0]?.id;

  const activate = useCallback(
    (id: NodeId) => {
      const view = store.getContainerView(containerId);
      if (!view?.childOrder.includes(id)) return;
      store.setActiveChild(containerId, id);
    },
    [store, containerId],
  );

  return band ? { tabs, activeId, activate, band } : { tabs, activeId, activate };
}

function rectOf(c: Record<string, number> | undefined, prefix: 'band' | 'tab'): Rect | undefined {
  const x = c?.[`${prefix}X`];
  if (c === undefined || x === undefined) return undefined;
  return { x, y: c[`${prefix}Y`] ?? 0, z: 0, w: c[`${prefix}W`] ?? 0, h: c[`${prefix}H`] ?? 0 };
}
