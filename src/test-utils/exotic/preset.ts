import { createNode } from '../../constructors.js';
import { nodeToLayoutItem } from '../../layout-node-adapter.js';
import type { Size } from '../../layout-types.js';
import type { LockSet } from '../../lock.js';
import { asNodeId, type Node, type NodeHints, type NodeId } from '../../node.js';
import { Store } from '../../store.js';
import type { Scenario } from './invariants.js';

/**
 * One node of a preset tree. Mirrors `CreateNodeInput` with ids as plain
 * strings and children nested, so a preset is JSON-safe and reads top-down.
 * A node with `strategy` is a container; one with a parent gets membership.
 */
export interface PresetNode {
  id: string;
  kind?: string;
  /** `container.strategyId`. Present → the node is a container. */
  strategy?: string;
  config?: Record<string, unknown>;
  /** The container's persisted strategy state (saved positions, anchors…), as `setContainerState` takes it. */
  state?: unknown;
  hints?: NodeHints;
  placement?: Record<string, unknown>;
  meta?: Record<string, unknown>;
  lock?: boolean | LockSet;
  /** Shown, then hidden — `hidden` proper, which layout skips, not merely `mounted`. */
  hidden?: boolean;
  children?: PresetNode[];
}

/**
 * A layout reproduced from real software, as a canned tree: what it is, what
 * it stresses, the viewport it was designed for, and the tree itself. One
 * preset feeds a store (stories, e2e, tree tests) and, per container, a flat
 * {@link Scenario} (strategy tests).
 */
export interface Preset {
  id: string;
  /** The real product or corpus, e.g. "Blender 4.x default workspace". */
  source: string;
  /** What about it stresses the library, in one line. */
  stress: string;
  viewport: Size;
  root: PresetNode;
}

/** Every node in `preset`, parents before children. */
export function presetNodes(preset: Preset): { node: PresetNode; parentId?: string }[] {
  const out: { node: PresetNode; parentId?: string }[] = [];
  const walk = (node: PresetNode, parentId?: string) => {
    out.push(parentId === undefined ? { node } : { node, parentId });
    for (const child of node.children ?? []) walk(child, node.id);
  };
  walk(preset.root);
  return out;
}

/** Registers `preset` into `store` (a new one by default). Throws on a duplicate id. */
export function presetToStore(preset: Preset, store: Store = new Store()): Store {
  const seen = new Set<string>();
  for (const { node, parentId } of presetNodes(preset)) {
    if (seen.has(node.id)) throw new Error(`preset ${preset.id}: duplicate node id ${node.id}`);
    seen.add(node.id);
    const id = asNodeId(node.id);
    store.registerNode(
      createNode({
        id,
        kind: node.kind ?? (node.strategy ? 'group' : 'panel'),
        parentId: parentId === undefined ? undefined : asNodeId(parentId),
        container: node.strategy
          ? { strategyId: node.strategy, config: node.config ?? {} }
          : undefined,
        focus: !node.strategy,
        placement: node.placement,
        meta: node.meta,
        hints: node.hints,
        lock: node.lock,
      }),
    );
    if (node.strategy && node.state !== undefined) store.setContainerState(id, node.state);
    store.showNode(id);
    if (node.hidden) store.hideNode(id);
  }
  return store;
}

/**
 * The flat {@link Scenario} for one container of `preset` — the root by
 * default — run at `container` (the preset's viewport by default). Items are
 * projected the way the React layer projects them, hidden children skipped.
 */
export function presetScenario(
  preset: Preset,
  containerId: string = preset.root.id,
  container: Size = preset.viewport,
): Scenario {
  const store = presetToStore(preset);
  const parent = store.getNode(asNodeId(containerId) as NodeId);
  if (!parent?.container) throw new Error(`preset ${preset.id}: ${containerId} is not a container`);
  const items = parent.container.childOrder
    .map((id) => store.getNode(id))
    .filter((n): n is Node => n !== undefined && n.lifecycle.state !== 'hidden')
    .map(nodeToLayoutItem);
  return {
    id: containerId === preset.root.id ? preset.id : `${preset.id}/${containerId}`,
    source: preset.source,
    stress: preset.stress,
    container,
    items,
    options: (parent.container.config ?? {}) as Record<string, unknown>,
    ...(parent.container.state === undefined ? {} : { state: parent.container.state }),
  };
}
