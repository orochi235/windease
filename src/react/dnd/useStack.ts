import { useCallback, useMemo } from 'react';
import { accessibleName, type NodeId } from '../../index.js';
import { useChildren, useNode } from '../hooks.js';
import { useStore } from '../Provider.js';

export interface StackTab {
  id: NodeId;
  /** What to label the tab with. */
  title: string;
}

export interface StackModel {
  /** The stack's children, in `childOrder`. */
  tabs: StackTab[];
  /** Which tab the strategy is showing. Undefined only for an empty stack. */
  activeId: NodeId | undefined;
  /** Show `id`. A no-op for an id that is not a child of this stack. */
  activate(id: NodeId): void;
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

  const tabs = useMemo(
    () => children.map((c) => ({ id: c.id, title: accessibleName(store, c.id) })),
    [children, store],
  );

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

  return { tabs, activeId, activate };
}
