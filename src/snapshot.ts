import {
  DuplicateNodeError,
  InvariantViolationError,
  LockedError,
  NodeNotFoundError,
  WindeaseError,
} from './errors.js';
import { type LockSet, resolveLock } from './lock.js';
import { createFocusMachine } from './machines/focus.js';
import { createLifecycleMachine } from './machines/lifecycle.js';
import { createTransitMachine } from './machines/transit.js';
import { asNodeId, type Node, type NodeId, type NodeKind } from './node.js';
import { Store } from './store.js';
import { trace } from './trace.js';

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
  version: 5;
  nodes: SerializedNode[];
  rootIds: string[];
  focusedId: string | null;
  /**
   * Present only on a subtree snapshot: the placement the root held in the
   * parent it was serialized out of. `graft` restores it; `deserialize`
   * ignores it, since a store root has no parent to be placed in.
   */
  rootPlacement?: Record<string, unknown>;
}

function serializeNode(node: Node): SerializedNode {
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
  return out;
}

export interface SerializeOptions {
  /** Serialize only this node and its descendants. */
  root?: NodeId;
}

/**
 * Serialize a Store into a v5 snapshot. Destroyed nodes and
 * transit state are deliberately not included — see spec section 8.
 * Pass `{ root }` to serialize only that node's subtree.
 *
 * @group Snapshots
 */
export function serialize(store: Store, opts?: SerializeOptions): SerializedStore {
  if (opts?.root !== undefined) return serializeSubtree(store, opts.root);
  const nodes: SerializedNode[] = [];
  for (const node of store.nodesTruth.values()) {
    if (node.lifecycle.state === 'destroyed') continue;
    nodes.push(serializeNode(node));
  }
  return {
    version: 5,
    nodes,
    rootIds: [...store.rootIdsTruth],
    focusedId: store.focusedIdTruth,
  };
}

function serializeSubtree(store: Store, rootId: NodeId): SerializedStore {
  const root = store.getNodeTruth(rootId);
  if (!root || root.lifecycle.state === 'destroyed') throw new NodeNotFoundError(rootId);

  const nodes: SerializedNode[] = [];
  const ids = new Set<string>();
  const visit = (id: NodeId): void => {
    const node = store.getNodeTruth(id);
    if (!node || node.lifecycle.state === 'destroyed') return;
    ids.add(node.id);
    nodes.push(serializeNode(node));
    if (node.container) {
      for (const cid of node.container.childOrder) visit(cid);
    }
  };
  visit(rootId);

  // Within this snapshot the subtree root IS a root: its parent is not here.
  const rootEntry = nodes[0] as SerializedNode;
  const rootPlacement = rootEntry.membership?.placement;
  delete rootEntry.membership;

  const focusedId = store.focusedIdTruth;
  const out: SerializedStore = {
    version: 5,
    nodes,
    rootIds: [rootId],
    focusedId: focusedId !== null && ids.has(focusedId) ? focusedId : null,
  };
  if (rootPlacement && Object.keys(rootPlacement).length > 0) out.rootPlacement = rootPlacement;
  return out;
}

export interface GraftOptions {
  /** Index within the target parent's `childOrder`. Appends when omitted. */
  at?: number;
  /** Bypass the target parent's `accept` lock. */
  force?: boolean;
}

/**
 * Attach a subtree snapshot as a child of `parentId`, returning the attached
 * root's id. Every id in the snapshot must be absent from the store — a
 * collision throws rather than remapping, because a snapshot's ids are the
 * host's own record keys.
 *
 * Deliberately does not move focus, even when the snapshot names a focused
 * node.
 *
 * @group Snapshots
 */
export function graft(store: Store, snap: unknown, parentId: NodeId, opts?: GraftOptions): NodeId {
  const parsed = parseSnapshot(snap);
  if (parsed.rootIds.length !== 1) {
    throw new InvariantViolationError(
      'graft-multi-root',
      `graft needs a snapshot with exactly one root, got ${parsed.rootIds.length}`,
      { rootIds: parsed.rootIds },
    );
  }
  const rootId = asNodeId(parsed.rootIds[0] as string);

  const parent = store.getNodeTruth(parentId);
  if (!parent) throw new NodeNotFoundError(parentId);
  if (!parent.container) {
    throw new InvariantViolationError(
      'parent-not-container',
      `graft target ${parentId} has no container capability`,
      { parentId },
    );
  }
  if (opts?.force !== true && store.isLocked(parentId, 'accept')) {
    throw new LockedError(parentId, 'accept', 'graft');
  }
  for (const sn of parsed.nodes) {
    if (store.getNodeTruth(asNodeId(sn.id))) {
      throw new DuplicateNodeError(asNodeId(sn.id));
    }
  }
  validateSnapshotLinks(parsed.nodes);

  trace(
    'store',
    `graft: ${rootId} (${parsed.nodes.length} nodes) → ${parentId}@${opts?.at ?? 'end'}`,
  );
  return rootId;
}

/**
 * Hydrate a Store from a v5 snapshot. v2, v3 and v4 snapshots are accepted
 * and migrated on read — see `normalizeLegacyMembership`, `migrateToV4`, and
 * `migrateToV5`.
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
  const parsed = parseSnapshot(target ? b : a);
  const hydrated = hydrate(parsed, target);
  return target ? undefined : hydrated;
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

/** Shape of the removed split layout strategy's `container.state`. Kept as a
 *  local type rather than imported — that strategy's module is gone. */
type LegacySplitTree =
  | { kind: 'leaf'; id: string }
  | {
      kind: 'split';
      direction: 'horizontal' | 'vertical';
      ratio: number;
      a: LegacySplitTree;
      b: LegacySplitTree;
    };

const MAX_LEGACY_SPLIT_DEPTH = 500;

/** `container.state` is consumer data of unknown provenance — a cyclic or
 *  absurdly deep structure must fail the check rather than blow the stack,
 *  so migration can fall back instead of crashing hydrate. */
function isLegacySplitTree(
  v: unknown,
  seen: WeakSet<object> = new WeakSet(),
  depth = 0,
): v is LegacySplitTree {
  if (!v || typeof v !== 'object') return false;
  if (depth > MAX_LEGACY_SPLIT_DEPTH || seen.has(v)) return false;
  seen.add(v);
  const o = v as Record<string, unknown>;
  if (o.kind === 'leaf') return typeof o.id === 'string';
  if (o.kind === 'split') {
    return (
      (o.direction === 'horizontal' || o.direction === 'vertical') &&
      isLegacySplitTree(o.a, seen, depth + 1) &&
      isLegacySplitTree(o.b, seen, depth + 1)
    );
  }
  return false;
}

/** The removed strategy laid `horizontal` children side by side along
 *  `rect.w` (x) and `vertical` children stacked along `rect.h` (y). */
function stripConfigFor(direction: 'horizontal' | 'vertical'): Record<string, unknown> {
  return { axis: direction === 'horizontal' ? 'x' : 'y', fill: true };
}

/** Every leaf id reachable from `node`, or `null` if one repeats — a tree
 *  that names the same node twice can't be reparented safely. */
function collectLeafIds(node: LegacySplitTree): Set<string> | null {
  const ids = new Set<string>();
  const walk = (n: LegacySplitTree): boolean => {
    if (n.kind === 'leaf') {
      if (ids.has(n.id)) return false;
      ids.add(n.id);
      return true;
    }
    return walk(n.a) && walk(n.b);
  };
  return walk(node) ? ids : null;
}

/** A split tree only earns a rebuild if its leaves are exactly the
 *  container's original children: no repeats, none naming a node absent
 *  from the snapshot, and none of the container's children left uncovered. */
function treeMatchesChildren(
  state: LegacySplitTree,
  childOrder: readonly string[],
  byId: Map<string, SerializedNode>,
): boolean {
  const leafIds = collectLeafIds(state);
  if (!leafIds) return false;
  for (const id of leafIds) {
    if (!byId.has(id)) return false;
  }
  const order = new Set(childOrder);
  if (leafIds.size !== order.size) return false;
  for (const id of order) {
    if (!leafIds.has(id)) return false;
  }
  return true;
}

/**
 * v4 → v5: the removed split strategy's containers carried a binary tree in
 * `container.state`. Rebuild it as nested strip groups so the leaves survive
 * the strategy's removal: the root split reuses its node, each nested split
 * mints a new group node, and `ratio` is dropped (strip has no equivalent).
 *
 * `container.state` is consumer data of unknown provenance — a snapshot
 * written by code we don't control, possibly hand-edited or drifted. Anything
 * that doesn't validate as a coherent tree over the container's own children
 * falls back to a flat strip with `childOrder` left untouched, rather than
 * throwing and bricking the snapshot.
 */
function migrateToV5(nodes: SerializedNode[]): void {
  const byId = new Map(nodes.map((sn) => [sn.id, sn] as const));
  const usedIds = new Set(nodes.map((sn) => sn.id));

  for (const sn of [...nodes]) {
    const container = sn.container;
    if (container?.strategyId !== 'split') continue;
    const state = container.state;
    const originalChildOrder = container.childOrder;
    container.strategyId = 'strip';
    delete container.state;

    const flatten = (reason: string): void => {
      container.config = stripConfigFor('horizontal');
      trace('store', `snapshot: split container ${sn.id} kept flat — ${reason}`);
    };

    if (!isLegacySplitTree(state)) {
      flatten('state is not a recognizable split tree');
      continue;
    }
    // A degenerate single-item split serializes its state as a bare leaf —
    // nothing to rebuild beyond the strategy swap already done above.
    if (state.kind === 'leaf') {
      flatten('single-leaf state, nothing to rebuild');
      continue;
    }
    if (!treeMatchesChildren(state, originalChildOrder, byId)) {
      flatten("tree's leaves don't match childOrder one-to-one");
      continue;
    }
    container.config = stripConfigFor(state.direction);

    const mintId = (path: number[]): string => {
      let candidate = `${sn.id}:s${path.join('')}`;
      let suffix = 2;
      while (usedIds.has(candidate)) {
        candidate = `${sn.id}:s${path.join('')}_${suffix}`;
        suffix += 1;
      }
      usedIds.add(candidate);
      return candidate;
    };

    // Returns the id to place in `parentId`'s childOrder for `node`: the
    // node's own id (reparented) for a leaf, or a freshly minted group id
    // for a nested split, whose own children are built recursively.
    const convert = (node: LegacySplitTree, path: number[], parentId: string): string => {
      if (node.kind === 'leaf') {
        const leaf = byId.get(node.id);
        if (leaf) leaf.membership = { parentId, placement: leaf.membership?.placement ?? {} };
        return node.id;
      }
      const groupId = mintId(path);
      const childOrder = [
        convert(node.a, [...path, 0], groupId),
        convert(node.b, [...path, 1], groupId),
      ];
      const group: SerializedNode = {
        id: groupId,
        kind: 'group',
        lifecycle: 'visible',
        membership: { parentId, placement: {} },
        container: {
          strategyId: 'strip',
          config: stripConfigFor(node.direction),
          childOrder,
          allowsPinning: true,
        },
      };
      byId.set(groupId, group);
      nodes.push(group);
      return groupId;
    };

    container.childOrder = [convert(state.a, [0], sn.id), convert(state.b, [1], sn.id)];
  }
}

/** Version-check, clone, and migrate to v5. The clone matters: the caller
 *  may reuse the snapshot object they passed in. */
function parseSnapshot(snap: unknown): SerializedStore {
  const versioned = snap as { version?: number };
  if (!versioned || typeof versioned !== 'object' || typeof versioned.version !== 'number') {
    throw new WindeaseError(
      'unsupported-snapshot-version',
      'snapshot is missing a numeric version field',
    );
  }
  const version = versioned.version;
  if (version !== 2 && version !== 3 && version !== 4 && version !== 5) {
    throw new WindeaseError('unsupported-snapshot-version', `unknown snapshot version: ${version}`);
  }
  const src = snap as SerializedStore;
  const nodes = src.nodes.map((sn) => structuredClone(sn));
  normalizeLegacyChildOrder(nodes);
  normalizeLegacyMembership(nodes);
  if (version < 4) migrateToV4(nodes);
  if (version < 5) migrateToV5(nodes);
  const out: SerializedStore = {
    version: 5,
    nodes,
    rootIds: [...src.rootIds],
    focusedId: src.focusedId ?? null,
  };
  if (src.rootPlacement !== undefined) out.rootPlacement = structuredClone(src.rootPlacement);
  return out;
}

/** Bidirectional parent/child links, and at most one focused node. */
function validateSnapshotLinks(nodes: SerializedNode[]): void {
  const byId = new Map<string, SerializedNode>();
  for (const sn of nodes) byId.set(sn.id, sn);

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
}

function hydrate(snap: SerializedStore, target?: Store): Store {
  const nodes = snap.nodes;
  validateSnapshotLinks(nodes);
  const byId = new Map<string, SerializedNode>();
  for (const sn of nodes) byId.set(sn.id, sn);

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
