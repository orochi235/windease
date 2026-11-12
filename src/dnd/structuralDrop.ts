import { createNode } from '../constructors.js';
import { readDropConfig, type WrapConfig } from '../container-config.js';
import type { NodeId } from '../node.js';
import { STACK_STRATEGY_ID, type Store } from '../store.js';
import { trace } from '../trace.js';

/** Container keys a split drop's new group takes from the container it splits. */
export const SPLIT_INHERITS = ['reorder', 'touchScroll', 'drop'] as const;

/** Commit a stack drop: `draggingId` and `ontoId` become tabs of one container. */
export function dropStack(
  store: Store,
  draggingId: NodeId,
  ontoId: NodeId,
  id: NodeId,
  stackConfig: Record<string, unknown> | undefined,
): void {
  try {
    store.stackNodes(draggingId, ontoId, { id, ...(stackConfig ? { config: stackConfig } : {}) });
    trace('dnd', `drop: stack ${draggingId} onto ${ontoId} as ${id}`);
  } catch (err) {
    trace('dnd', `drop failed: ${(err as Error).message}`);
  }
}

export interface SplitDrop {
  draggingId: NodeId;
  /** The container whose child is split, which the hover resolved against. */
  targetId: NodeId;
  ontoId: NodeId;
  axis: 'x' | 'y';
  edge: 'start' | 'end';
  /** Id for the new strip. */
  id: NodeId;
  /** Id for the container `drop.wrap` puts the source in, minted once the strip exists. */
  wrapId: () => NodeId;
  splitConfig: Record<string, unknown> | undefined;
}

/**
 * Commit a split drop: `draggingId` and `ontoId` share a new strip in
 * `ontoId`'s slot. Under the target's `drop.wrap`, the source then sits in a
 * new container of that shape in the strip, unless it already is one.
 */
export function dropSplit(store: Store, d: SplitDrop): void {
  // The group takes a slot of the container that split, so its children
  // drag and split the way that container's did.
  const from = (store.getNode(d.targetId)?.container?.config ?? {}) as Record<string, unknown>;
  const inherited = Object.fromEntries(
    SPLIT_INHERITS.filter((k) => from[k] !== undefined).map((k) => [k, from[k]]),
  );
  const config = { ...inherited, ...d.splitConfig };
  const wrap = readDropConfig(from).wrap;
  const wraps =
    wrap !== undefined && store.getNode(d.draggingId)?.container?.strategyId !== wrap.strategyId;
  try {
    store.transact(() => {
      store.splitInto(d.draggingId, d.ontoId, {
        id: d.id,
        axis: d.axis,
        edge: d.edge,
        ...(Object.keys(config).length > 0 ? { config } : {}),
      });
      // After the split, whose checks have all run: `transact` does not roll back.
      if (wraps && wrap) wrapInPlace(store, d.draggingId, d.wrapId(), wrap);
    }, 'splitDrop');
    trace(
      'dnd',
      `drop: split ${d.draggingId} onto ${d.ontoId} ${d.axis}/${d.edge} as ${d.id}${wraps ? `, wrapped in ${wrap.strategyId}` : ''}`,
    );
  } catch (err) {
    trace('dnd', `drop failed: ${(err as Error).message}`);
  }
}

/** Put `nodeId` alone in a new `wrap`-shaped container at its own index. */
function wrapInPlace(store: Store, nodeId: NodeId, id: NodeId, wrap: WrapConfig): void {
  const parentId = store.getNode(nodeId)?.membership?.parentId;
  if (!parentId) return;
  const at = store.getNode(parentId)?.container?.childOrder.indexOf(nodeId) ?? -1;
  store.registerNode(
    createNode({
      id,
      kind: wrap.kind ?? 'group',
      parentId,
      container: {
        strategyId: wrap.strategyId,
        config: {
          ...wrap.config,
          // A stack shows the pane just dropped, as `stackNodes` does.
          ...(wrap.strategyId === STACK_STRATEGY_ID ? { activeId: nodeId } : {}),
        },
        ...(wrap.allowsPinning !== undefined ? { allowsPinning: wrap.allowsPinning } : {}),
        ...(wrap.autoPrune ? { autoPrune: true } : {}),
      },
    }),
  );
  store.showNode(id);
  if (at >= 0) store.reorderInParent(id, at);
  store.moveNode(nodeId, id);
  trace('dnd', `drop: wrapped ${nodeId} in ${wrap.strategyId} ${id}`);
}
