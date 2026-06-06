import { createPanel } from './constructors.js';
import { InvariantViolationError, WindeaseError } from './errors.js';
import { createFocusMachine } from './machines/focus.js';
import { createLifecycleMachine } from './machines/lifecycle.js';
import { createTransitMachine } from './machines/transit.js';
import { type Node, type NodeId, type NodeKind, asNodeId } from './node.js';
import type { SerializedStore } from './snapshot.js';
import { WindeaseNodeStore } from './store-v2.js';
import { trace } from './trace.js';

export interface SerializedNodeV2 {
  id: string;
  kind: NodeKind;
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
    state?: unknown;
  };
  slot?: {
    parentId: string;
    placement: Record<string, unknown>;
  };
  focus?: { state: 'focused' | 'blurred' };
}

export interface SerializedStoreV2 {
  version: 2;
  nodes: SerializedNodeV2[];
  rootIds: string[];
  focusedId: string | null;
}

/**
 * Serialize a WindeaseNodeStore into a v2 snapshot. Destroyed nodes and
 * transit state are deliberately not included — see spec section 8.
 */
export function serializeNodes(store: WindeaseNodeStore): SerializedStoreV2 {
  const nodes: SerializedNodeV2[] = [];
  for (const node of store.nodes.values()) {
    if (node.lifecycle.state === 'destroyed') continue;
    const out: SerializedNodeV2 = {
      id: node.id,
      kind: node.kind,
      lifecycle: node.lifecycle.state as 'mounted' | 'visible' | 'hidden',
    };
    if (node.meta && Object.keys(node.meta).length > 0) out.meta = { ...node.meta };
    if (node.activity && Object.keys(node.activity).length > 0) out.activity = { ...node.activity };
    if (node.hints && Object.keys(node.hints).length > 0) out.hints = { ...node.hints };
    if (node.container) {
      const c: SerializedNodeV2['container'] = {
        strategyId: node.container.strategyId,
        config: node.container.config,
        childIds: [...node.container.childIds],
        allowsPinning: node.container.allowsPinning,
      };
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

/**
 * Hydrate a fresh WindeaseNodeStore from a snapshot. Accepts v1 (legacy) and
 * v2 shapes. v1 → v2 migration runs in-process; unowned v1 windows are
 * dropped with a console.warn.
 */
export function deserializeToNodeStore(snap: unknown): WindeaseNodeStore {
  const versioned = snap as { version?: number };
  if (!versioned || typeof versioned !== 'object' || typeof versioned.version !== 'number') {
    throw new WindeaseError(
      'unsupported-snapshot-version',
      'snapshot is missing a numeric version field',
    );
  }
  if (versioned.version === 1) {
    return hydrateFromV2(migrateV1ToV2(snap as SerializedStore));
  }
  if (versioned.version === 2) {
    return hydrateFromV2(snap as SerializedStoreV2);
  }
  throw new WindeaseError(
    'unsupported-snapshot-version',
    `unknown snapshot version: ${versioned.version}`,
  );
}

function hydrateFromV2(snap: SerializedStoreV2): WindeaseNodeStore {
  // Build a lookup so we can validate links + multi-focus before mutating.
  const byId = new Map<string, SerializedNodeV2>();
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

  const store = new WindeaseNodeStore();

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

function buildNodeFromSerialized(sn: SerializedNodeV2, opts: { emptyChildIds: boolean }): Node {
  const lifecycle = createLifecycleMachine();
  if (sn.lifecycle === 'visible') lifecycle.send('show');
  else if (sn.lifecycle === 'hidden') {
    lifecycle.send('show');
    lifecycle.send('hide');
  }

  const node: Node = {
    id: asNodeId(sn.id),
    kind: sn.kind,
    lifecycle,
  };
  if (sn.meta) node.meta = { ...sn.meta };
  if (sn.activity) node.activity = { ...sn.activity };
  if (sn.hints) node.hints = { ...sn.hints };
  if (sn.container) {
    node.container = {
      strategyId: sn.container.strategyId,
      config: sn.container.config,
      childIds: opts.emptyChildIds ? [] : sn.container.childIds.map(asNodeId),
      allowsPinning: sn.container.allowsPinning,
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

/**
 * Translate a v1 SerializedStore into a v2 SerializedStoreV2 in-place.
 * v1 zones → 'zone' nodes; v1 windows → 'panel' nodes; v1 itemMeta →
 * slot.placement. Unowned v1 windows are dropped with a console.warn.
 */
export function migrateV1ToV2(v1: SerializedStore): SerializedStoreV2 {
  const nodes: SerializedNodeV2[] = [];

  for (const sz of v1.zones) {
    const out: SerializedNodeV2 = {
      id: sz.id,
      kind: 'zone',
      lifecycle: 'visible',
      container: {
        strategyId: sz.strategyName,
        config: sz.config,
        childIds: [...sz.windowIds],
        allowsPinning: sz.allowsPinning ?? true,
      },
    };
    nodes.push(out);
  }

  const zoneById = new Map(v1.zones.map((z) => [z.id, z] as const));
  const ownership = new Map<string, string>();
  for (const z of v1.zones) {
    for (const wid of z.windowIds) ownership.set(wid, z.id);
  }

  let focusedId: string | null = null;
  for (const sw of v1.windows) {
    if (sw.lifecycle === 'destroyed') continue;
    const parentId = ownership.get(sw.id);
    if (!parentId) {
      // biome-ignore lint/suspicious/noConsole: one-shot migration warning
      console.warn(
        `[windease] v1→v2 migration: dropping unowned window ${sw.id} (zoneId=${sw.zoneId})`,
      );
      trace('store', `v1→v2 drop unowned window ${sw.id}`);
      continue;
    }
    const sz = zoneById.get(parentId);
    const placement = sz?.itemMeta?.[sw.id] ?? {};
    const lifecycle: 'mounted' | 'visible' | 'hidden' =
      sw.lifecycle === 'visible' || sw.lifecycle === 'hidden' ? sw.lifecycle : 'mounted';
    const out: SerializedNodeV2 = {
      id: sw.id,
      kind: 'panel',
      lifecycle,
      slot: { parentId, placement: { ...placement } },
      focus: { state: sw.focus === 'focused' ? 'focused' : 'blurred' },
    };
    if (sw.meta && Object.keys(sw.meta).length > 0) out.meta = { ...sw.meta };
    if (sw.hints && Object.keys(sw.hints).length > 0) out.hints = { ...sw.hints };
    if (sw.focus === 'focused') focusedId = sw.id;
    nodes.push(out);
  }

  return {
    version: 2,
    nodes,
    rootIds: v1.zones.map((z) => z.id),
    focusedId,
  };
}

// Helper to satisfy types where we need an explicit cast point.
const _createPanelStub = createPanel;
void _createPanelStub;
function _typeAnchor(_id: NodeId): NodeId {
  return _id;
}
void _typeAnchor;
