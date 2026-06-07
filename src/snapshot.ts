import { InvariantViolationError, WindeaseError } from './errors.js';
import { createFocusMachine } from './machines/focus.js';
import { createLifecycleMachine } from './machines/lifecycle.js';
import { createTransitMachine } from './machines/transit.js';
import { type Node, type NodeKind, asNodeId } from './node.js';
import { WindeaseStore } from './store.js';

export interface SerializedNode {
  id: string;
  kind?: NodeKind;
  meta?: Record<string, unknown>;
  activity?: Record<string, unknown>;
  hints?: {
    minSize?: { w: number; h: number };
    preferredSize?: { w: number; h: number };
    order?: number;
  };
  lifecycle: 'mounted' | 'visible' | 'hidden';
  container?: {
    strategyId: string;
    config: unknown;
    childIds: string[];
    allowsPinning: boolean;
    /** Omitted when true (the default). */
    allowsDrop?: boolean;
    /** Omitted when true (the default). */
    allowsDragOut?: boolean;
    state?: unknown;
  };
  slot?: {
    parentId: string;
    placement: Record<string, unknown>;
  };
  focus?: { state: 'focused' | 'blurred' };
}

export interface SerializedStore {
  version: 2;
  nodes: SerializedNode[];
  rootIds: string[];
  focusedId: string | null;
}

/**
 * Serialize a WindeaseStore into a v2 snapshot. Destroyed nodes and
 * transit state are deliberately not included — see spec section 8.
 */
export function serialize(store: WindeaseStore): SerializedStore {
  const nodes: SerializedNode[] = [];
  for (const node of store.nodes.values()) {
    if (node.lifecycle.state === 'destroyed') continue;
    const out: SerializedNode = {
      id: node.id,
      lifecycle: node.lifecycle.state as 'mounted' | 'visible' | 'hidden',
    };
    if (node.kind !== undefined) out.kind = node.kind;
    if (node.meta && Object.keys(node.meta).length > 0) out.meta = { ...node.meta };
    if (node.activity && Object.keys(node.activity).length > 0) out.activity = { ...node.activity };
    if (node.hints && Object.keys(node.hints).length > 0) out.hints = { ...node.hints };
    if (node.container) {
      const c: SerializedNode['container'] = {
        strategyId: node.container.strategyId,
        config: node.container.config,
        childIds: [...node.container.childIds],
        allowsPinning: node.container.allowsPinning,
      };
      if (node.container.allowsDrop === false) c.allowsDrop = false;
      if (node.container.allowsDragOut === false) c.allowsDragOut = false;
      if (node.container.state !== undefined) c.state = node.container.state;
      out.container = c;
    }
    if (node.slot) {
      out.slot = {
        parentId: node.slot.parentId,
        placement: { ...node.slot.placement },
      };
    }
    if (node.focus) {
      out.focus = { state: node.focus.state };
    }
    nodes.push(out);
  }
  return {
    version: 2,
    nodes,
    rootIds: [...store.rootIds],
    focusedId: store.focusedId,
  };
}

/** Hydrate a fresh WindeaseStore from a v2 snapshot. */
export function deserialize(snap: unknown): WindeaseStore {
  const versioned = snap as { version?: number };
  if (!versioned || typeof versioned !== 'object' || typeof versioned.version !== 'number') {
    throw new WindeaseError(
      'unsupported-snapshot-version',
      'snapshot is missing a numeric version field',
    );
  }
  if (versioned.version === 2) {
    return hydrateFromV2(snap as SerializedStore);
  }
  throw new WindeaseError(
    'unsupported-snapshot-version',
    `unknown snapshot version: ${versioned.version}`,
  );
}

function hydrateFromV2(snap: SerializedStore): WindeaseStore {
  // Build a lookup so we can validate links + multi-focus before mutating.
  const byId = new Map<string, SerializedNode>();
  for (const sn of snap.nodes) byId.set(sn.id, sn);

  // Validate bidirectional link.
  for (const sn of snap.nodes) {
    if (!sn.slot) continue;
    const parent = byId.get(sn.slot.parentId);
    if (!parent) {
      throw new InvariantViolationError(
        'orphan-child',
        `node ${sn.id} has parentId ${sn.slot.parentId} but no such node`,
        { id: sn.id, parentId: sn.slot.parentId },
      );
    }
    if (!parent.container) {
      throw new InvariantViolationError(
        'parent-not-container',
        `node ${sn.id}'s parent ${parent.id} has no container`,
        { id: sn.id, parentId: parent.id },
      );
    }
    if (!parent.container.childIds.includes(sn.id)) {
      throw new InvariantViolationError(
        'broken-bidi-link',
        `node ${sn.id} claims parent ${parent.id} but parent doesn't list it`,
        { id: sn.id, parentId: parent.id },
      );
    }
  }

  // Multi-focus check.
  let focusedSeen: string | null = null;
  for (const sn of snap.nodes) {
    if (sn.focus?.state === 'focused') {
      if (focusedSeen) {
        throw new InvariantViolationError(
          'multi-focus',
          `multiple focused nodes in snapshot: ${focusedSeen}, ${sn.id}`,
          { ids: [focusedSeen, sn.id] },
        );
      }
      focusedSeen = sn.id;
    }
  }

  const store = new WindeaseStore();

  // Visit nodes in tree order: each root, then DFS through its childIds,
  // which preserves both insertion order and the snapshot's intended child
  // ordering. Building containers with empty childIds at register time lets
  // the store populate them via the child registrations.
  const visit = (id: string): void => {
    const sn = byId.get(id);
    if (!sn) return;
    const node = buildNodeFromSerialized(sn, { emptyChildIds: true });
    store.registerNode(node);
    if (sn.container) {
      for (const cid of sn.container.childIds) visit(cid);
    }
  };

  for (const rid of snap.rootIds) visit(rid);
  // Any nodes not reached via rootIds (e.g. unslotted but not listed as
  // roots) — register them as additional roots in stable order.
  for (const sn of snap.nodes) {
    if (store.getNode(asNodeId(sn.id))) continue;
    if (sn.slot) {
      // Already-orphan branches were validated above; if we get here the
      // node was unreachable from rootIds — that's a corrupt snapshot.
      throw new InvariantViolationError(
        'unreachable-node',
        `node ${sn.id} not reachable from rootIds`,
        { id: sn.id },
      );
    }
    visit(sn.id);
  }

  if (snap.focusedId) {
    const focused = store.getNode(asNodeId(snap.focusedId));
    if (focused?.focus) {
      store.focusNode(asNodeId(snap.focusedId));
    }
  }

  return store;
}

function buildNodeFromSerialized(sn: SerializedNode, opts: { emptyChildIds: boolean }): Node {
  const lifecycle = createLifecycleMachine();
  if (sn.lifecycle === 'visible') lifecycle.send('show');
  else if (sn.lifecycle === 'hidden') {
    lifecycle.send('show');
    lifecycle.send('hide');
  }

  const node: Node = {
    id: asNodeId(sn.id),
    lifecycle,
  };
  if (sn.kind !== undefined) node.kind = sn.kind;
  if (sn.meta) node.meta = { ...sn.meta };
  if (sn.activity) node.activity = { ...sn.activity };
  if (sn.hints) node.hints = { ...sn.hints };
  if (sn.container) {
    node.container = {
      strategyId: sn.container.strategyId,
      config: sn.container.config,
      childIds: opts.emptyChildIds ? [] : sn.container.childIds.map(asNodeId),
      allowsPinning: sn.container.allowsPinning,
      allowsDrop: sn.container.allowsDrop ?? true,
      allowsDragOut: sn.container.allowsDragOut ?? true,
    };
    if (sn.container.state !== undefined) {
      node.container.state = sn.container.state;
    }
  }
  if (sn.slot) {
    node.slot = {
      parentId: asNodeId(sn.slot.parentId),
      placement: { ...sn.slot.placement },
      transit: createTransitMachine(),
    };
  }
  if (sn.focus) {
    // Focus state is restored via store.focusNode after registration to keep
    // focusedId in sync; here we always init blurred.
    node.focus = createFocusMachine();
  }
  return node;
}

