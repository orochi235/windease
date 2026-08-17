import { InvariantViolationError, WindeaseError } from './errors.js';
import { type LockSet, resolveLock } from './lock.js';
import { createFocusMachine } from './machines/focus.js';
import { createLifecycleMachine } from './machines/lifecycle.js';
import { createTransitMachine } from './machines/transit.js';
import { asNodeId, type Node, type NodeKind } from './node.js';
import { Store } from './store.js';

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
  /** See `Node.order`. */
  order?: number;
  lifecycle: 'mounted' | 'visible' | 'hidden';
  container?: {
    strategyId: string;
    config: unknown;
    childOrder: string[];
    allowsPinning: boolean;
    state?: unknown;
  };
  membership?: {
    parentId: string;
    placement: Record<string, unknown>;
  };
  focus?: { state: 'focused' | 'blurred' };
  lock?: LockSet;
}

export interface SerializedStore {
  version: 4;
  nodes: SerializedNode[];
  rootIds: string[];
  focusedId: string | null;
}

/**
 * Serialize a Store into a v4 snapshot. Destroyed nodes and
 * transit state are deliberately not included — see spec section 8.
 *
 * @group Snapshots
 */
export function serialize(store: Store): SerializedStore {
  const nodes: SerializedNode[] = [];
  for (const node of store.nodesTruth.values()) {
    if (node.lifecycle.state === 'destroyed') continue;
    const out: SerializedNode = {
      id: node.id,
      lifecycle: node.lifecycle.state as 'mounted' | 'visible' | 'hidden',
    };
    if (node.kind !== undefined) out.kind = node.kind;
    if (node.meta && Object.keys(node.meta).length > 0) out.meta = { ...node.meta };
    if (node.activity && Object.keys(node.activity).length > 0) out.activity = { ...node.activity };
    if (node.hints && Object.keys(node.hints).length > 0) out.hints = { ...node.hints };
    if (node.order !== undefined) out.order = node.order;
    if (node.container) {
      const c: SerializedNode['container'] = {
        strategyId: node.container.strategyId,
        config: node.container.config,
        childOrder: [...node.container.childOrder],
        allowsPinning: node.container.allowsPinning,
      };
      if (node.container.state !== undefined) c.state = node.container.state;
      out.container = c;
    }
    if (node.membership) {
      out.membership = {
        parentId: node.membership.parentId,
        placement: { ...node.membership.placement },
      };
    }
    if (node.focus) {
      out.focus = { state: node.focus.state };
    }
    if (node.lock && Object.keys(node.lock).length > 0) out.lock = { ...node.lock };
    nodes.push(out);
  }
  return {
    version: 4,
    nodes,
    rootIds: [...store.rootIdsTruth],
    focusedId: store.focusedIdTruth,
  };
}

/**
 * Hydrate a Store from a v4 snapshot. v2 and v3 snapshots are accepted and
 * migrated on read — see `normalizeLegacyMembership` and `migrateToV4`.
 *
 * Two forms:
 * - `deserialize(snap)` builds and returns a fresh `Store`.
 * - `deserialize(store, snap)` hydrates `store` in place — every existing
 *   node is discarded and replaced with the snapshot's contents — and
 *   returns nothing. This is the form history/undo use: it reuses the
 *   caller's `Store` instance (and its throttle policy, subscribers, and
 *   identity) rather than swapping in a new one.
 *
 * @group Snapshots
 */
export function deserialize(snap: unknown): Store;
export function deserialize(store: Store, snap: unknown): void;
export function deserialize(a: unknown, b?: unknown): Store | void {
  const target = a instanceof Store ? a : undefined;
  const snap = target ? b : a;
  const versioned = snap as { version?: number };
  if (!versioned || typeof versioned !== 'object' || typeof versioned.version !== 'number') {
    throw new WindeaseError(
      'unsupported-snapshot-version',
      'snapshot is missing a numeric version field',
    );
  }
  if (versioned.version === 2 || versioned.version === 3 || versioned.version === 4) {
    const hydrated = hydrate(snap as SerializedStore, versioned.version, target);
    return target ? undefined : hydrated;
  }
  throw new WindeaseError(
    'unsupported-snapshot-version',
    `unknown snapshot version: ${versioned.version}`,
  );
}

/**
 * Back-compat: snapshots written before the `childIds` → `childOrder`
 * rename used `container.childIds`. Normalize any such node in-place so
 * downstream code can assume `container.childOrder` is present.
 */
function normalizeLegacyChildOrder(nodes: SerializedNode[]): void {
  for (const sn of nodes) {
    if (!sn.container) continue;
    const c = sn.container as typeof sn.container & { childIds?: string[] };
    if (c.childOrder === undefined && Array.isArray(c.childIds)) {
      c.childOrder = c.childIds;
      delete c.childIds;
    }
  }
}

/**
 * Back-compat: v2 snapshots named the parent-membership capability `slot`.
 * The shapes are identical, so a key rename is the whole migration.
 */
function normalizeLegacyMembership(nodes: SerializedNode[]): void {
  for (const sn of nodes) {
    const legacy = sn as SerializedNode & { slot?: SerializedNode['membership'] };
    if (legacy.membership === undefined && legacy.slot !== undefined) {
      legacy.membership = legacy.slot;
      delete legacy.slot;
    }
  }
}

/** Back-compat: fold v3's `allowsDrop`/`allowsDragOut`/`placement.locked`
 *  into `lock` and drop the old keys. Mutates `sn` — caller must clone first. */
function migrateLockFields(sn: SerializedNode): void {
  const container = sn.container as
    | (NonNullable<SerializedNode['container']> & { allowsDrop?: boolean; allowsDragOut?: boolean })
    | undefined;
  const placement = sn.membership?.placement as
    | (Record<string, unknown> & { locked?: boolean })
    | undefined;
  const lock: LockSet = { ...(sn.lock ?? {}) };
  let changed = false;
  if (container?.allowsDrop === false) {
    lock.accept = true;
    changed = true;
  }
  if (container?.allowsDragOut === false) {
    lock.dragOut = true;
    changed = true;
  }
  if (container) {
    delete container.allowsDrop;
    delete container.allowsDragOut;
  }
  if (placement?.locked === true) {
    lock.move = true;
    lock.resize = true;
    lock.destroy = true;
    changed = true;
    delete placement.locked;
  }
  if (changed) sn.lock = lock;
}

/** Back-compat: resolve boolean `placement.pinned: true` to the child's
 *  actual position in `childOrder`, without moving it there. */
function migratePinnedIndices(nodes: SerializedNode[]): void {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const sn of nodes) {
    if (!sn.container) continue;
    for (const childId of sn.container.childOrder) {
      const placement = byId.get(childId)?.membership?.placement;
      if (placement?.pinned === true) {
        placement.pinned = sn.container.childOrder.indexOf(childId);
      }
    }
  }
}

function migrateToV4(nodes: SerializedNode[]): void {
  for (const sn of nodes) migrateLockFields(sn);
  migratePinnedIndices(nodes);
}

function hydrate(snap: SerializedStore, version: number, target?: Store): Store {
  // Clone before any migration touches node contents — the caller may reuse
  // the snapshot object they passed in.
  const nodes = snap.nodes.map((sn) => structuredClone(sn));
  normalizeLegacyChildOrder(nodes);
  normalizeLegacyMembership(nodes);
  if (version < 4) migrateToV4(nodes);
  // Build a lookup so we can validate links + multi-focus before mutating.
  const byId = new Map<string, SerializedNode>();
  for (const sn of nodes) byId.set(sn.id, sn);

  // Validate bidirectional link.
  for (const sn of nodes) {
    if (!sn.membership) continue;
    const parent = byId.get(sn.membership.parentId);
    if (!parent) {
      throw new InvariantViolationError(
        'orphan-child',
        `node ${sn.id} has parentId ${sn.membership.parentId} but no such node`,
        { id: sn.id, parentId: sn.membership.parentId },
      );
    }
    if (!parent.container) {
      throw new InvariantViolationError(
        'parent-not-container',
        `node ${sn.id}'s parent ${parent.id} has no container`,
        { id: sn.id, parentId: parent.id },
      );
    }
    if (!parent.container.childOrder.includes(sn.id)) {
      throw new InvariantViolationError(
        'broken-bidi-link',
        `node ${sn.id} claims parent ${parent.id} but parent doesn't list it`,
        { id: sn.id, parentId: parent.id },
      );
    }
  }

  // Multi-focus check.
  let focusedSeen: string | null = null;
  for (const sn of nodes) {
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

  const store = target ?? new Store();

  if (target) {
    // Wholesale replacement: drop every existing node (cascading from each
    // root) before repopulating from the snapshot. Truth reads only — the
    // published view is meaningless mid-hydrate and gets resynced below.
    // Suspend locks so a destroy-locked root doesn't abort the restore.
    target.withLocksSuspended(() => {
      for (const rootId of [...target.rootIdsTruth]) {
        target.unregisterNode(rootId);
      }
    });
  }

  // Visit nodes in tree order: each root, then DFS through its childOrder,
  // which preserves both insertion order and the snapshot's intended child
  // ordering. Building containers with empty childOrder at register time lets
  // the store populate them via the child registrations.
  const visit = (id: string): void => {
    const sn = byId.get(id);
    if (!sn) return;
    const node = buildNodeFromSerialized(sn, { emptyChildOrder: true });
    store.registerNode(node);
    if (sn.container) {
      for (const cid of sn.container.childOrder) visit(cid);
    }
  };

  for (const rid of snap.rootIds) visit(rid);
  // Any nodes not reached via rootIds (e.g. unparented but not listed as
  // roots) — register them as additional roots in stable order.
  for (const sn of nodes) {
    if (store.getNodeTruth(asNodeId(sn.id))) continue;
    if (sn.membership) {
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
    const focused = store.getNodeTruth(asNodeId(snap.focusedId));
    if (focused?.focus) {
      store.focusNode(asNodeId(snap.focusedId));
    }
  }

  // Hydration is a wholesale replacement, not an incremental change — the
  // published view must match immediately and any in-flight timers from the
  // pre-hydrate store are meaningless.
  store.resetPublished();

  return store;
}

function buildNodeFromSerialized(sn: SerializedNode, opts: { emptyChildOrder: boolean }): Node {
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
  if (sn.order !== undefined) node.order = sn.order;
  if (sn.container) {
    node.container = {
      strategyId: sn.container.strategyId,
      config: sn.container.config,
      childOrder: opts.emptyChildOrder ? [] : sn.container.childOrder.map(asNodeId),
      allowsPinning: sn.container.allowsPinning,
    };
    if (sn.container.state !== undefined) {
      node.container.state = sn.container.state;
    }
  }
  if (sn.membership) {
    node.membership = {
      parentId: asNodeId(sn.membership.parentId),
      placement: { ...sn.membership.placement },
      transit: createTransitMachine(),
    };
  }
  if (sn.focus) {
    // Focus state is restored via store.focusNode after registration to keep
    // focusedId in sync; here we always init blurred.
    node.focus = createFocusMachine();
  }
  if (sn.lock) {
    // Capability-filtered even for a native v4 lock: a hand-crafted or
    // corrupted snapshot must not smuggle in an axis this node doesn't support.
    const resolved = resolveLock(node, sn.lock);
    if (Object.keys(resolved).length > 0) node.lock = resolved;
  }
  return node;
}
