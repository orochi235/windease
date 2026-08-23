import { createNode } from './constructors.js';
import {
  CapabilityMissingError,
  CycleError,
  DuplicateNodeError,
  InvariantViolationError,
  LockedError,
  NodeNotFoundError,
  PinIndexError,
} from './errors.js';
import { TypedEmitter } from './events.js';
import { chooseSuccessor } from './focus/successor.js';
import { type LockAxis, type LockSet, resolveLock } from './lock.js';
import type { ContainerCap, FocusCap, MembershipCap, Node, NodeHints, NodeId } from './node.js';
import { placeRespectingPins } from './pinning.js';
import { splitNode, unsplitNode } from './split.js';
import type { SplitInput } from './split-types.js';
import {
  type MachineName,
  type PendingPublish,
  Publisher,
  type StoreOptions,
  systemClock,
  type ThrottlePendingPayload,
  type ThrottlePublishedPayload,
} from './throttle.js';
import { trace } from './trace.js';

/** `container.strategyId` a stack carries. Named here because `stackNodes`
 *  recognises an existing stack by it. */
const STACK_STRATEGY_ID = 'stack';

export interface StoreEvents {
  'node.registered': { id: NodeId };
  'node.unregistered': { id: NodeId };
  'node.transitioned': {
    id: NodeId;
    machine: MachineName;
    from: string;
    to: string;
  };
  'node.moved': {
    id: NodeId;
    fromParentId: NodeId | null;
    toParentId: NodeId;
    fromIndex: number;
    toIndex: number;
  };
  'node.reordered': {
    parentId: NodeId;
    id: NodeId;
    fromIndex: number;
    toIndex: number;
  };
  'node.placementChanged': {
    id: NodeId;
    changes: Record<string, { from: unknown; to: unknown }>;
  };
  'node.metaChanged': {
    id: NodeId;
    changes: Record<string, { from: unknown; to: unknown }>;
  };
  'node.hintsChanged': {
    id: NodeId;
    changes: Record<string, { from: unknown; to: unknown }>;
  };
  'node.lockChanged': { id: NodeId; from: Readonly<LockSet>; to: Readonly<LockSet> };
  'node.pinnedChanged': { id: NodeId; from: number | null; to: number | null };
  'node.activityChanged': {
    id: NodeId;
    changes: Record<string, { from: unknown; to: unknown }>;
  };
  'node.cascadeDestroyed': {
    parentId: NodeId;
    descendantIds: readonly NodeId[];
  };
  'container.configChanged': { id: NodeId; from: unknown; to: unknown };
  'container.allowsPinningChanged': { id: NodeId; from: boolean; to: boolean };
  /**
   * Per-container strategy state (e.g. a resize ratio) changed. Stored on
   * `node.container.state`; round-trips through snapshot. By design this
   * field should NOT participate in undo/redo when v2 history lands —
   * resize gestures shouldn't pollute the timeline.
   */
  'container.stateChanged': { id: NodeId; from: unknown; to: unknown };
  'container.strategyChanged': { id: NodeId; from: string; to: string };
  /** A node that had no container gained one, via `ensureContainer`. Not
   *  emitted for a node registered with a container already on it. */
  'container.added': { id: NodeId; strategyId: string };
  /**
   * The store chose focus for you because the focused node went away. Never
   * emitted for an explicit `focusNode`. `to` is null when nothing remained.
   */
  'focus.successor': {
    from: NodeId;
    to: NodeId | null;
    reason: 'destroyed' | 'hidden' | 'moved';
  };
  /**
   * A composite operation started. Bracket history pushes on this pair to get
   * one undo step for the whole operation: the `node.*` events are synchronous
   * and per-mutation, so an unbracketed listener sees one `split` as many separate
   * changes.
   */
  'transaction.begin': { label?: string };
  /** Closes a `transaction.begin`. Fires even when the callback threw. */
  'transaction.end': { label?: string };
  /**
   * A node started being withheld by throttling. Only ever emitted by a
   * store constructed with a `throttle` policy.
   */
  'throttle.pending': ThrottlePendingPayload;
  /**
   * A withheld node reached the published view. Pairs with
   * `throttle.pending` for the same id.
   */
  'throttle.published': ThrottlePublishedPayload;
}

/**
 * Store — the unified-node-model store.
 *
 * Single `nodes` map; every mutation that touches a node produces a fresh
 * Node object (record replacement) so React's useSyncExternalStore detects
 * the change via referential equality. FSM transitions are paired with a
 * node-record swap.
 *
 * @group Store
 */
export class Store {
  readonly events = new TypedEmitter<StoreEvents>();
  private readonly nodesMap = new Map<NodeId, Node>();
  private readonly rootIdsArr: NodeId[] = [];
  private focusedIdValue: NodeId | null = null;
  private coalescing = false;
  private readonly subscribers = new Set<() => void>();
  private readonly publisher: Publisher;
  private locksSuspended = 0;
  private txnDepth = 0;

  constructor(options: StoreOptions = {}) {
    this.publisher = new Publisher({
      truth: this.nodesMap,
      policy: options.throttle,
      clock: options.clock ?? systemClock,
      readGlobals: () => ({ rootIds: this.rootIdsArr, focusedId: this.focusedIdValue }),
      notify: () => {
        for (const fn of this.subscribers) fn();
      },
      onPending: (payload) => this.events.emit('throttle.pending', payload),
      onPublished: (payload) => this.events.emit('throttle.published', payload),
    });
  }

  // ===== Read =====
  //
  // `nodes` / `rootIds` / `focusedId` / `getNode` return the PUBLISHED view:
  // what subscribers and the React layer see, which may lag truth when a
  // throttle policy is configured. The `*Truth` variants return the exact
  // current state and are what snapshot and history read.
  //
  // With no throttle policy the two are identity-equal.

  get nodes(): ReadonlyMap<NodeId, Node> {
    return this.publisher.nodes;
  }

  /** Truth: unlagged, exactly what the last mutation wrote. */
  get nodesTruth(): ReadonlyMap<NodeId, Node> {
    return this.nodesMap;
  }

  get rootIds(): readonly NodeId[] {
    return this.publisher.rootIds;
  }

  /** Truth: unlagged root id list. */
  get rootIdsTruth(): readonly NodeId[] {
    return this.rootIdsArr;
  }

  get focusedId(): NodeId | null {
    return this.publisher.focusedId;
  }

  /** Truth: unlagged focused id. */
  get focusedIdTruth(): NodeId | null {
    return this.focusedIdValue;
  }

  getNode(id: NodeId): Node | undefined {
    return this.publisher.nodes.get(id);
  }

  /** Truth: unlagged node record. */
  getNodeTruth(id: NodeId): Node | undefined {
    return this.nodesMap.get(id);
  }

  /**
   * What throttling is currently withholding for `id`, or `null` if
   * nothing is. Always `null` on a store with no `throttle` policy — an
   * un-throttled store tracks nothing and withholds nothing.
   *
   * `eligibleAt` on the result is when the node's gate opens, not when it
   * will publish: `notifyMs` and stagger waves can defer the flush past
   * it. Pair with the `throttle.pending` / `throttle.published` events to
   * observe the transitions rather than poll.
   */
  getPending(id: NodeId): PendingPublish | null {
    return this.publisher.getPending(id);
  }

  getChildren(parentId: NodeId): readonly Node[] {
    const parent = this.nodesMap.get(parentId);
    if (!parent?.container) return [];
    const out: Node[] = [];
    for (const cid of parent.container.childOrder) {
      const c = this.nodesMap.get(cid);
      if (c) out.push(c);
    }
    return out;
  }

  getParent(id: NodeId): Node | undefined {
    const node = this.nodesMap.get(id);
    if (!node?.membership) return undefined;
    return this.nodesMap.get(node.membership.parentId);
  }

  getAncestors(id: NodeId): readonly Node[] {
    const chain: Node[] = [];
    let current = this.nodesMap.get(id);
    while (current?.membership) {
      const parent = this.nodesMap.get(current.membership.parentId);
      if (!parent) break;
      chain.unshift(parent);
      current = parent;
    }
    const self = this.nodesMap.get(id);
    if (self) chain.push(self);
    return chain;
  }

  isContainer(id: NodeId): boolean {
    return !!this.nodesMap.get(id)?.container;
  }

  isMember(id: NodeId): boolean {
    return !!this.nodesMap.get(id)?.membership;
  }

  /** Whether the node has the focus capability — *not* whether it is focused.
   *  For that, compare `store.focusedId`. */
  canFocus(id: NodeId): boolean {
    return !!this.nodesMap.get(id)?.focus;
  }

  /**
   * @deprecated Renamed to {@link Store.canFocus}; removed at 2.0.0. The name
   * read as a state check one method away from `focusedId`, and was misread
   * that way in practice.
   */
  hasFocus(id: NodeId): boolean {
    return this.canFocus(id);
  }

  getContainerView(id: NodeId): {
    childOrder: readonly NodeId[];
    config: unknown;
    allowsPinning: boolean;
    autoUnsplit: boolean;
  } | null {
    const c = this.nodesMap.get(id)?.container;
    if (!c) return null;
    return {
      childOrder: c.childOrder,
      config: c.config,
      allowsPinning: c.allowsPinning,
      autoUnsplit: c.autoUnsplit ?? false,
    };
  }

  // ===== Register / unregister =====

  registerNode(node: Node): void {
    if (this.nodesMap.has(node.id)) {
      throw new DuplicateNodeError(node.id);
    }
    if (node.membership) {
      const parent = this.nodesMap.get(node.membership.parentId);
      if (!parent) throw new NodeNotFoundError(node.membership.parentId);
      if (!parent.container) {
        throw new InvariantViolationError(
          'parent-not-container',
          `parent ${node.membership.parentId} has no container capability`,
          { parentId: node.membership.parentId, childId: node.id },
        );
      }
      this.nodesMap.set(node.id, node);
      this.publisher.markDirty(node.id, { bypass: true });
      this.replaceContainer(parent.id, (c) => ({
        ...c,
        childOrder: [...c.childOrder, node.id],
      }));
      this.publisher.markDirty(parent.id, { bypass: true });
    } else {
      this.nodesMap.set(node.id, node);
      this.publisher.markDirty(node.id, { bypass: true });
      this.rootIdsArr.push(node.id);
      this.publisher.markGlobalsDirty();
    }
    this.events.emit('node.registered', { id: node.id });
    trace('store', `register: ${node.id} (kind=${node.kind})`);
    this.scheduleNotify();
  }

  unregisterNode(id: NodeId, opts?: MutateOptions): void {
    this.assertUnlocked(id, 'destroy', 'unregisterNode', opts);
    const node = this.requireNode(id);
    const wasIn = node.membership?.parentId;
    this.transact(() => {
      this.#unregisterNodeInner(id, node);
      if (wasIn) this.coalesceParent(wasIn);
    }, 'unregisterNode');
  }

  #unregisterNodeInner(id: NodeId, node: Node): void {
    const descendantIds: NodeId[] = [];
    if (node.container) {
      this.collectDescendants(id, descendantIds);
    }
    for (const did of descendantIds) {
      this.detachAndRemove(did);
      this.events.emit('node.unregistered', { id: did });
    }
    if (descendantIds.length > 0) {
      this.events.emit('node.cascadeDestroyed', { parentId: id, descendantIds });
      trace('store', `destroy cascade: ${id} → ${descendantIds.length} descendants`);
    }

    if (this.focusedIdValue === id) this.succeedFocus(id, 'destroyed');
    const parentId = node.membership?.parentId;
    this.detachAndRemove(id);
    if (parentId) this.clampPins(parentId);
    this.events.emit('node.unregistered', { id });
    trace('store', `unregister: ${id}`);
    this.scheduleNotify();
  }

  private collectDescendants(parentId: NodeId, out: NodeId[]): void {
    const parent = this.nodesMap.get(parentId);
    if (!parent?.container) return;
    for (const cid of parent.container.childOrder) {
      const child = this.nodesMap.get(cid);
      if (!child) continue;
      if (child.container) this.collectDescendants(cid, out);
      out.push(cid);
    }
  }

  /** Remove a node from its parent's childOrder (or rootIds) and from the map.
   *  Does NOT cascade and does NOT emit. */
  private detachAndRemove(id: NodeId): void {
    const node = this.nodesMap.get(id);
    if (!node) return;
    if (node.membership) {
      const parent = this.nodesMap.get(node.membership.parentId);
      if (parent?.container) {
        this.replaceContainer(parent.id, (c) => ({
          ...c,
          childOrder: c.childOrder.filter((cid) => cid !== id),
        }));
      }
    } else {
      const idx = this.rootIdsArr.indexOf(id);
      if (idx >= 0) this.rootIdsArr.splice(idx, 1);
    }
    this.forgetFocus(node.membership?.parentId, id);
    this.nodesMap.delete(id);
    this.publisher.markDirty(id, { bypass: true });
    this.publisher.markGlobalsDirty();
    if (this.focusedIdValue === id) this.focusedIdValue = null;
  }

  // ===== Move / reorder =====

  moveNode(id: NodeId, newParentId: NodeId, at?: number, opts?: MutateOptions): void {
    const node = this.requireNode(id);
    if (!node.membership) {
      throw new InvariantViolationError('move-unparented', `cannot move unparented node ${id}`, {
        id,
      });
    }
    this.assertUnlocked(id, 'move', 'moveNode', opts);
    this.assertUnlocked(newParentId, 'accept', 'moveNode', opts);
    this.assertUnlocked(node.membership.parentId, 'dragOut', 'moveNode', opts);
    const newParent = this.requireNode(newParentId);
    if (id === newParentId || this.isDescendantOf(newParentId, id)) {
      throw new CycleError(id, newParentId);
    }
    if (!newParent.container) {
      throw new InvariantViolationError(
        'parent-not-container',
        `target ${newParentId} has no container capability`,
        { newParentId, id },
      );
    }

    const fromParentId = node.membership.parentId;
    const fromContainer = this.nodesMap.get(fromParentId)?.container;
    if (!fromContainer) {
      throw new InvariantViolationError(
        'orphan-source',
        `node ${id} reports parent ${fromParentId} which is not a container`,
        { id, fromParentId },
      );
    }
    const fromIndex = fromContainer.childOrder.indexOf(id);

    // Transit: idle → releasing
    const transit = node.membership.transit;
    const transitPrev = transit.state;
    transit.send('beginRelease');
    this.replaceNode(id);
    this.events.emit('node.transitioned', {
      id,
      machine: 'transit',
      from: transitPrev,
      to: transit.state,
    });

    // Remove from old parent
    this.replaceContainer(fromParentId, (c) => ({
      ...c,
      childOrder: c.childOrder.filter((cid) => cid !== id),
    }));

    // Transit: releasing → claiming
    transit.send('settle');
    transit.send('beginClaim');
    this.replaceNode(id);
    this.events.emit('node.transitioned', {
      id,
      machine: 'transit',
      from: 'releasing',
      to: 'claiming',
    });

    // Add to new parent, set new parentId on the membership
    this.replaceMembership(id, (s) => ({ ...s, parentId: newParentId }));
    const insertIndex = clampIndex(at, newParent.container.childOrder.length);
    this.replaceContainer(newParentId, (c) => {
      const spliced = [...c.childOrder];
      spliced.splice(insertIndex, 0, id);
      return {
        ...c,
        childOrder: placeRespectingPins(spliced, id, insertIndex, this.pinnedIndexOf),
      };
    });
    const toIndex =
      this.nodesMap.get(newParentId)?.container?.childOrder.indexOf(id) ?? insertIndex;

    this.events.emit('node.moved', {
      id,
      fromParentId,
      toParentId: newParentId,
      fromIndex,
      toIndex,
    });
    trace('store', `move: ${id} ${fromParentId}@${fromIndex} → ${newParentId}@${toIndex}`);

    // Transit: claiming → idle
    transit.send('settle');
    this.replaceNode(id);
    this.publisher.markDirty(id, { machine: 'transit', bypass: true });
    this.events.emit('node.transitioned', {
      id,
      machine: 'transit',
      from: 'claiming',
      to: transit.state,
    });

    if (this.focusedIdValue) {
      this.forgetFocus(fromParentId, this.focusedIdValue);
      if (this.focusedIdValue === id || this.isDescendantOf(this.focusedIdValue, id)) {
        this.rememberFocus(this.focusedIdValue);
      }
    }

    this.clampPins(fromParentId);
    this.clampPins(newParentId);
    this.scheduleNotify();
    this.coalesceParent(fromParentId);
  }

  /**
   * Collapse `parentId` if it is an `autoUnsplit` container a removal has just
   * left holding exactly one child: the survivor is lifted into the
   * grandparent and this node destroyed.
   *
   * Fires only on that transition, not on any container that happens to hold
   * one child — otherwise a group could never be built up a child at a time.
   * It cannot cascade: `unsplit` replaces the group with its survivor, so the
   * grandparent's child count is unchanged.
   *
   * Silent when a lock forbids it. The caller removed a node; a lock on the
   * group must not turn that into a failed removal.
   */
  private coalesceParent(parentId: NodeId): void {
    // `unsplit` unregisters the group, which re-enters here for its parent.
    if (this.coalescing) return;
    const node = this.nodesMap.get(parentId);
    const container = node?.container;
    if (!node || !container?.autoUnsplit) return;
    // A root has no grandparent to lift into.
    if (!node.membership) return;
    if (container.childOrder.length !== 1) return;
    this.coalescing = true;
    try {
      this.unsplit(parentId);
    } catch (e) {
      if (!(e instanceof LockedError)) throw e;
      trace('store', `autoUnsplit: ${parentId} refused (${e.axis})`);
    } finally {
      this.coalescing = false;
    }
  }

  reorderInParent(id: NodeId, at: number, opts?: MutateOptions): void {
    const node = this.requireNode(id);
    if (!node.membership) {
      throw new InvariantViolationError('reorder-unparented', `node ${id} not parented`, { id });
    }
    this.assertUnlocked(id, 'move', 'reorderInParent', opts);
    const parentId = node.membership.parentId;
    const parent = this.requireNode(parentId);
    if (!parent.container) {
      throw new InvariantViolationError(
        'parent-not-container',
        `parent ${parentId} has no container`,
        { parentId },
      );
    }
    this.assertUnlocked(parentId, 'arrange', 'reorderInParent', opts);
    const fromIndex = parent.container.childOrder.indexOf(id);
    if (fromIndex < 0) {
      throw new InvariantViolationError(
        'orphan-source',
        `node ${id} not found in parent ${parentId} childOrder`,
        { id, parentId },
      );
    }
    const targetIndex = clampIndex(at, parent.container.childOrder.length - 1);
    if (targetIndex === fromIndex && this.getPinnedIndex(id) === null) return;
    this.replaceContainer(parentId, (c) => ({
      ...c,
      childOrder: placeRespectingPins(c.childOrder, id, targetIndex, this.pinnedIndexOf),
    }));
    this.publisher.markDirty(parentId, { bypass: true });
    const finalIndex =
      this.nodesMap.get(parentId)?.container?.childOrder.indexOf(id) ?? targetIndex;
    if (this.getPinnedIndex(id) !== null && finalIndex !== this.getPinnedIndex(id)) {
      this.writePin(id, finalIndex);
    }
    this.events.emit('node.reordered', { parentId, id, fromIndex, toIndex: finalIndex });
    this.scheduleNotify();
  }

  setChildOrder(parentId: NodeId, orderedIds: readonly NodeId[], opts?: MutateOptions): void {
    this.assertUnlocked(parentId, 'arrange', 'setChildOrder', opts);
    const parent = this.requireNode(parentId);
    if (!parent.container) {
      throw new InvariantViolationError(
        'parent-not-container',
        `parent ${parentId} has no container`,
        { parentId },
      );
    }
    const current = parent.container.childOrder;
    if (orderedIds.length !== current.length) {
      throw new InvariantViolationError(
        'reorder-not-permutation',
        `setChildOrder requires a permutation of current childOrder (got ${orderedIds.length}, expected ${current.length})`,
        { parentId, orderedIds: [...orderedIds], current: [...current] },
      );
    }
    const seen = new Set<NodeId>();
    for (const id of orderedIds) {
      if (seen.has(id)) {
        throw new InvariantViolationError(
          'reorder-not-permutation',
          `setChildOrder requires a permutation; received duplicate id ${id}`,
          { parentId, id },
        );
      }
      seen.add(id);
      if (!current.includes(id)) {
        throw new InvariantViolationError(
          'reorder-not-permutation',
          `setChildOrder requires a permutation; id ${id} is not a child of ${parentId}`,
          { parentId, id, current: [...current] },
        );
      }
    }
    // No-op if already in order.
    let same = true;
    for (let i = 0; i < orderedIds.length; i++) {
      if (orderedIds[i] !== current[i]) {
        same = false;
        break;
      }
    }
    if (same) return;

    this.replaceContainer(parentId, (c) => ({ ...c, childOrder: [...orderedIds] }));
    this.publisher.markDirty(parentId, { bypass: true });
    this.clampPins(parentId);
    trace('store', `setChildOrder: ${parentId} → [${orderedIds.join(', ')}]`);
    this.scheduleNotify();
  }

  /** Realign every child's recorded `pinned` index to its actual position in
   *  `parentId`'s childOrder, after a mutation that may have shifted or
   *  removed slots out from under it. */
  private clampPins(parentId: NodeId): void {
    const parent = this.nodesMap.get(parentId);
    if (!parent?.container) return;
    for (const cid of parent.container.childOrder) {
      const pin = this.getPinnedIndex(cid);
      if (pin === null) continue;
      const actual = parent.container.childOrder.indexOf(cid);
      if (pin !== actual) this.writePin(cid, actual);
    }
  }

  private isDescendantOf(maybeDescendant: NodeId, ancestor: NodeId): boolean {
    let current = this.nodesMap.get(maybeDescendant);
    while (current?.membership) {
      if (current.membership.parentId === ancestor) return true;
      current = this.nodesMap.get(current.membership.parentId);
    }
    return false;
  }

  // ===== Placement / meta =====

  setPlacement(id: NodeId, key: string, value: unknown, opts?: MutateOptions): void {
    this.patchPlacement(id, { [key]: value }, opts);
  }

  patchPlacement(id: NodeId, patch: Record<string, unknown>, opts?: MutateOptions): void {
    const node = this.requireNode(id);
    if (!node.membership) {
      throw new CapabilityMissingError(id, 'membership', 'patchPlacement');
    }
    // `span` is grid's cell-count analog of `size`; both are the resize axis.
    if ('size' in patch || 'span' in patch) {
      this.assertUnlocked(id, 'resize', 'patchPlacement', opts);
    }
    // Unlike `size`, a direct `pinned` write can't be lock-gated and allowed through:
    // it skips the bounds check and displacement routing, desyncing it from childOrder.
    if ('pinned' in patch) {
      throw new InvariantViolationError(
        'pinned-reserved',
        `patchPlacement cannot write 'pinned' directly on ${id}; use setPinned/unpin`,
        { id },
      );
    }
    const prev = node.membership.placement;
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    const next: Record<string, unknown> = { ...prev };
    for (const [k, v] of Object.entries(patch)) {
      const from = prev[k];
      if (v === undefined) {
        if (k in next) {
          delete next[k];
          changes[k] = { from, to: undefined };
        }
      } else if (from !== v) {
        next[k] = v;
        changes[k] = { from, to: v };
      }
    }
    if (Object.keys(changes).length === 0) return;
    this.replaceMembership(id, (s) => ({ ...s, placement: next }));
    this.events.emit('node.placementChanged', { id, changes });
    this.scheduleNotify();
  }

  getPlacement(id: NodeId): Record<string, unknown> {
    return this.nodesMap.get(id)?.membership?.placement ?? {};
  }

  /**
   * Patch the layout hints a strategy reads (`minSize`, `sizing`, …). A patch
   * like `setMeta`, not a replace, so a binding can state one key without
   * knowing the rest.
   *
   * Values compare by value: a binding rebuilds `hints` from props on every
   * render, and identity would report a change on each one.
   */
  setHints(id: NodeId, patch: Record<string, unknown>): void {
    const node = this.requireNode(id);
    const prev = (node.hints ?? {}) as Record<string, unknown>;
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    const next: Record<string, unknown> = { ...prev };
    for (const [k, v] of Object.entries(patch)) {
      const from = prev[k];
      if (v === undefined) {
        if (k in next) {
          delete next[k];
          changes[k] = { from, to: undefined };
        }
      } else if (JSON.stringify(from) !== JSON.stringify(v)) {
        next[k] = v;
        changes[k] = { from, to: v };
      }
    }
    if (Object.keys(changes).length === 0) return;
    this.replaceNode(id, (n) => ({ ...n, hints: next as NodeHints }));
    this.events.emit('node.hintsChanged', { id, changes });
    this.scheduleNotify();
  }

  setMeta(id: NodeId, patch: Record<string, unknown>): void {
    const node = this.requireNode(id);
    const prev = node.meta ?? {};
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    const next: Record<string, unknown> = { ...prev };
    for (const [k, v] of Object.entries(patch)) {
      const from = prev[k];
      if (v === undefined) {
        if (k in next) {
          delete next[k];
          changes[k] = { from, to: undefined };
        }
      } else if (from !== v) {
        next[k] = v;
        changes[k] = { from, to: v };
      }
    }
    if (Object.keys(changes).length === 0) return;
    this.replaceNode(id, (n) => ({ ...n, meta: next }));
    this.events.emit('node.metaChanged', { id, changes });
    this.scheduleNotify();
  }

  getMeta(id: NodeId): Record<string, unknown> {
    return this.nodesMap.get(id)?.meta ?? {};
  }

  // ===== Activity =====

  setActivity(id: NodeId, value: Record<string, unknown>): void {
    const node = this.requireNode(id);
    const prev = node.activity ?? {};
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    for (const k of Object.keys(prev)) {
      if (!(k in value)) changes[k] = { from: prev[k], to: undefined };
    }
    for (const [k, v] of Object.entries(value)) {
      if (prev[k] !== v) changes[k] = { from: prev[k], to: v };
    }
    if (Object.keys(changes).length === 0) return;
    const nextActivity = Object.keys(value).length === 0 ? undefined : { ...value };
    this.replaceNode(id, (n) => {
      const next = { ...n };
      if (nextActivity === undefined) delete next.activity;
      else next.activity = nextActivity;
      return next;
    });
    this.events.emit('node.activityChanged', { id, changes });
    trace('store', `activity: ${id} changed: ${Object.keys(changes).join(',')}`);
    this.scheduleNotify();
  }

  patchActivity(id: NodeId, patch: Record<string, unknown>): void {
    const node = this.requireNode(id);
    const prev = node.activity ?? {};
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    const next: Record<string, unknown> = { ...prev };
    for (const [k, v] of Object.entries(patch)) {
      const from = prev[k];
      if (v === undefined) {
        if (k in next) {
          delete next[k];
          changes[k] = { from, to: undefined };
        }
      } else if (from !== v) {
        next[k] = v;
        changes[k] = { from, to: v };
      }
    }
    if (Object.keys(changes).length === 0) return;
    const nextActivity = Object.keys(next).length === 0 ? undefined : next;
    this.replaceNode(id, (n) => {
      const out = { ...n };
      if (nextActivity === undefined) delete out.activity;
      else out.activity = nextActivity;
      return out;
    });
    this.events.emit('node.activityChanged', { id, changes });
    trace('store', `activity: ${id} changed: ${Object.keys(changes).join(',')}`);
    this.scheduleNotify();
  }

  getActivity(id: NodeId): Record<string, unknown> {
    return this.nodesMap.get(id)?.activity ?? {};
  }

  // ===== Container config =====

  updateContainerConfig(id: NodeId, patch: unknown, opts?: MutateOptions): void {
    this.assertUnlocked(id, 'arrange', 'updateContainerConfig', opts);
    const node = this.requireNode(id);
    if (!node.container) {
      throw new CapabilityMissingError(id, 'container', 'updateContainerConfig');
    }
    const from = node.container.config;
    // For object-shaped configs, merge-patch with undefined-deletes.
    // For non-object configs, the patch replaces.
    let next: unknown;
    if (typeof from === 'object' && from !== null && typeof patch === 'object' && patch !== null) {
      const merged: Record<string, unknown> = { ...(from as Record<string, unknown>) };
      for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
        if (v === undefined) delete merged[k];
        else merged[k] = v;
      }
      next = merged;
    } else {
      next = patch;
    }
    if (next === from) return;
    this.replaceContainer(id, (c) => ({ ...c, config: next }));
    this.events.emit('container.configChanged', { id, from, to: next });
    this.scheduleNotify();
  }

  /**
   * Read the persisted strategy state for `id`'s container (e.g. a resize
   * ratio), or undefined if nothing has been written yet — in which case the
   * consumer initializes via `strategy.initialState`. Lives on
   * `node.container.state`, round-trips through snapshot/hydrate.
   *
   * NOT meant to feed undo/redo: when v2 history lands, this field should be
   * explicitly excluded — resize gestures should not pollute the timeline.
   */
  getContainerState(id: NodeId): unknown {
    return this.nodesMap.get(id)?.container?.state;
  }

  /** Write strategy state for `id`'s container. Emits `container.stateChanged`
   * and schedules a notify. Throws if `id` has no container capability. */
  setContainerState(id: NodeId, state: unknown, opts?: MutateOptions): void {
    this.assertUnlocked(id, 'arrange', 'setContainerState', opts);
    const node = this.requireNode(id);
    if (!node.container) {
      throw new CapabilityMissingError(id, 'container', 'setContainerState');
    }
    const from = node.container.state;
    if (from === state) return;
    this.replaceContainer(id, (c) => ({ ...c, state }));
    this.events.emit('container.stateChanged', { id, from, to: state });
    this.scheduleNotify();
  }

  /**
   * Swap the layout strategy for `id`'s container. Drops the persisted
   * `state`, since it belongs to the outgoing strategy; the config is not
   * migrated — pass a matching one through `updateContainerConfig`.
   */
  setStrategy(id: NodeId, strategyId: string, opts?: MutateOptions): void {
    this.assertUnlocked(id, 'arrange', 'setStrategy', opts);
    const node = this.requireNode(id);
    if (!node.container) throw new CapabilityMissingError(id, 'container', 'setStrategy');
    const from = node.container.strategyId;
    if (from === strategyId) return;
    const priorState = node.container.state;
    this.replaceContainer(id, (c) => ({ ...c, strategyId, state: undefined }));
    this.events.emit('container.strategyChanged', { id, from, to: strategyId });
    if (priorState !== undefined) {
      this.events.emit('container.stateChanged', { id, from: priorState, to: undefined });
    }
    trace('store', `strategy: ${id} ${from} → ${strategyId} (state cleared)`);
    this.scheduleNotify();
  }

  /**
   * Give `id` a container capability if it has none. No-op when it already
   * has one — the existing `childOrder` and config are left alone.
   */
  ensureContainer(id: NodeId, strategyId: string, config: unknown, opts?: MutateOptions): void {
    this.assertUnlocked(id, 'arrange', 'ensureContainer', opts);
    const node = this.requireNode(id);
    if (node.container) return;
    this.nodesMap.set(id, {
      ...node,
      container: { strategyId, config, childOrder: [], allowsPinning: true },
    });
    this.publisher.markDirty(id, { bypass: true });
    this.events.emit('container.added', { id, strategyId });
    trace('store', `ensureContainer: ${id} (${strategyId})`);
    this.scheduleNotify();
  }

  setLock(id: NodeId, input: boolean | LockSet): void {
    const node = this.requireNode(id);
    const from = node.lock ?? {};
    const to = resolveLock(node, input);
    if (sameLock(from, to)) return;
    this.replaceNode(id, (n) => (Object.keys(to).length === 0 ? omitLock(n) : { ...n, lock: to }));
    this.events.emit('node.lockChanged', { id, from: { ...from }, to: { ...to } });
    trace('store', `setLock: ${id} → {${Object.keys(to).join(',')}}`);
    this.scheduleNotify();
  }

  getLock(id: NodeId): Readonly<LockSet> {
    return this.nodesMap.get(id)?.lock ?? {};
  }

  isLocked(id: NodeId, axis: LockAxis): boolean {
    if (this.locksSuspended > 0) return false;
    return this.nodesMap.get(id)?.lock?.[axis] === true;
  }

  /** Run `fn` with every lock ignored. Used internally by `deserialize`'s
   *  in-place restore; a caller-side history restore should wrap itself the same way. */
  withLocksSuspended<T>(fn: () => T): T {
    this.locksSuspended += 1;
    try {
      return fn();
    } finally {
      this.locksSuspended -= 1;
    }
  }

  private assertUnlocked(
    id: NodeId,
    axis: LockAxis,
    operation: string,
    opts?: MutateOptions,
  ): void {
    if (opts?.force === true) return;
    if (!this.isLocked(id, axis)) return;
    throw new LockedError(id, axis, operation);
  }

  /**
   * Turn on collapse-when-one-child for this container. See
   * `ContainerCap.autoUnsplit`. Gated by `arrange`: it changes what happens to
   * this container's children.
   */
  setAutoUnsplit(id: NodeId, enabled: boolean, opts?: MutateOptions): void {
    this.assertUnlocked(id, 'arrange', 'setAutoUnsplit', opts);
    const node = this.requireNode(id);
    if (!node.container) {
      throw new CapabilityMissingError(id, 'container', 'setAutoUnsplit');
    }
    if ((node.container.autoUnsplit ?? false) === enabled) return;
    this.replaceContainer(id, (c) => ({ ...c, autoUnsplit: enabled }));
    this.scheduleNotify();
  }

  setAllowsPinning(id: NodeId, allows: boolean): void {
    const node = this.requireNode(id);
    if (!node.container) {
      throw new CapabilityMissingError(id, 'container', 'setAllowsPinning');
    }
    const from = node.container.allowsPinning;
    if (from === allows) return;
    this.replaceContainer(id, (c) => ({ ...c, allowsPinning: allows }));
    this.events.emit('container.allowsPinningChanged', { id, from, to: allows });
    if (!allows) {
      for (const cid of node.container.childOrder) {
        const pinFrom = this.getPinnedIndex(cid);
        if (pinFrom === null) continue;
        this.writePin(cid, null);
        this.events.emit('node.pinnedChanged', { id: cid, from: pinFrom, to: null });
      }
    }
    this.scheduleNotify();
  }

  setPinned(id: NodeId, at?: number, opts?: MutateOptions): void {
    const node = this.requireNode(id);
    if (!node.membership) {
      throw new InvariantViolationError('pin-unparented', `node ${id} not parented`, { id });
    }
    const parentId = node.membership.parentId;
    const parent = this.requireNode(parentId);
    if (!parent.container) {
      throw new InvariantViolationError('parent-not-container', `parent ${parentId}`, {
        parentId,
      });
    }
    this.assertUnlocked(parentId, 'arrange', 'setPinned', opts);
    if (!parent.container.allowsPinning) {
      throw new InvariantViolationError(
        'pinning-not-allowed',
        `parent ${parentId} has allowsPinning: false`,
        { parentId },
      );
    }
    const length = parent.container.childOrder.length;
    const current = parent.container.childOrder.indexOf(id);
    const target = at ?? current;
    if (target < 0 || target >= length) throw new PinIndexError(id, target, length);

    const from = this.getPinnedIndex(id);
    if (target !== current) this.reorderInParent(id, target, { force: true });
    // reorderInParent may have already landed the node and recorded its
    // actual slot internally; only write here if that didn't happen.
    const actual = this.nodesMap.get(parentId)?.container?.childOrder.indexOf(id) ?? target;
    if (this.getPinnedIndex(id) !== actual) this.writePin(id, actual);
    if (from === actual) return;
    this.events.emit('node.pinnedChanged', { id, from, to: actual });
    trace('store', `setPinned: ${id} @ ${actual}`);
    this.scheduleNotify();
  }

  unpin(id: NodeId, opts?: MutateOptions): void {
    const node = this.requireNode(id);
    const parentId = node.membership?.parentId;
    if (parentId) this.assertUnlocked(parentId, 'arrange', 'unpin', opts);
    const from = this.getPinnedIndex(id);
    if (from === null) return;
    this.writePin(id, null);
    this.events.emit('node.pinnedChanged', { id, from, to: null });
    this.scheduleNotify();
  }

  getPinnedIndex(id: NodeId): number | null {
    const raw = this.nodesMap.get(id)?.membership?.placement?.pinned;
    return typeof raw === 'number' ? raw : null;
  }

  private writePin(id: NodeId, at: number | null): void {
    this.replaceMembership(id, (m) => {
      const placement = { ...m.placement };
      if (at === null) delete placement.pinned;
      else placement.pinned = at;
      return { ...m, placement };
    });
  }

  private pinnedIndexOf = (id: NodeId): number | null => this.getPinnedIndex(id);

  // ===== Lifecycle: show / hide =====

  showNode(id: NodeId): void {
    const node = this.requireNode(id);
    const prev = node.lifecycle.state;
    if (!node.lifecycle.send('show')) {
      throw new InvariantViolationError(
        'illegal-transition',
        `cannot show node ${id} from ${prev}`,
        { id, from: prev },
      );
    }
    this.replaceNode(id);
    this.publisher.markDirty(id, { machine: 'lifecycle' });
    this.events.emit('node.transitioned', {
      id,
      machine: 'lifecycle',
      from: prev,
      to: node.lifecycle.state,
    });
    this.scheduleNotify();
  }

  hideNode(id: NodeId): void {
    const node = this.requireNode(id);
    const prev = node.lifecycle.state;
    if (!node.lifecycle.send('hide')) {
      throw new InvariantViolationError(
        'illegal-transition',
        `cannot hide node ${id} from ${prev}`,
        { id, from: prev },
      );
    }
    this.replaceNode(id);
    this.publisher.markDirty(id, { machine: 'lifecycle' });
    this.events.emit('node.transitioned', {
      id,
      machine: 'lifecycle',
      from: prev,
      to: node.lifecycle.state,
    });
    if (this.focusedIdValue === id) this.succeedFocus(id, 'hidden');
    this.scheduleNotify();
  }

  // ===== Focus =====

  private succeedFocus(from: NodeId, reason: 'destroyed' | 'hidden' | 'moved'): void {
    if (this.focusedIdValue !== from) return;
    const to = chooseSuccessor(this, from);
    this.focusedIdValue = null;
    if (to) {
      this.focusNode(to);
    } else {
      this.publisher.markGlobalsDirty();
      this.scheduleNotify();
    }
    this.events.emit('focus.successor', { from, to, reason });
    trace('store', `focus successor: ${from} → ${to ?? 'none'} (${reason})`);
  }

  private rememberFocus(id: NodeId): void {
    let cursor = this.nodesMap.get(id)?.membership?.parentId;
    while (cursor) {
      const parent = this.nodesMap.get(cursor);
      if (!parent?.container) break;
      this.replaceContainer(cursor, (c) => ({ ...c, lastFocusedId: id }));
      cursor = parent.membership?.parentId;
    }
  }

  /** Drop `id` from every ancestor starting at `fromParentId` that remembers it. */
  private forgetFocus(fromParentId: NodeId | undefined, id: NodeId): void {
    let cursor = fromParentId;
    while (cursor) {
      const parent = this.nodesMap.get(cursor);
      if (!parent?.container) break;
      if (parent.container.lastFocusedId === id) {
        this.replaceContainer(cursor, (c) => {
          const { lastFocusedId: _dropped, ...rest } = c;
          return rest;
        });
      }
      cursor = parent.membership?.parentId;
    }
  }

  focusNode(id: NodeId): void {
    const target = this.requireNode(id);
    if (!target.focus) {
      throw new CapabilityMissingError(id, 'focus', 'focusNode');
    }
    if (target.focus.state === 'focused') return;
    if (this.focusedIdValue && this.focusedIdValue !== id) {
      const prev = this.nodesMap.get(this.focusedIdValue);
      if (prev?.focus) {
        prev.focus.send('blur');
        this.replaceNode(prev.id);
        this.publisher.markDirty(prev.id, { machine: 'focus' });
        this.events.emit('node.transitioned', {
          id: prev.id,
          machine: 'focus',
          from: 'focused',
          to: 'blurred',
        });
      }
    }
    target.focus.send('focus');
    this.replaceNode(id);
    this.publisher.markDirty(id, { machine: 'focus' });
    this.events.emit('node.transitioned', {
      id,
      machine: 'focus',
      from: 'blurred',
      to: 'focused',
    });
    this.focusedIdValue = id;
    this.rememberFocus(id);
    this.publisher.markGlobalsDirty();
    this.scheduleNotify();
  }

  blurAll(): void {
    if (!this.focusedIdValue) return;
    const node = this.nodesMap.get(this.focusedIdValue);
    if (node?.focus) {
      node.focus.send('blur');
      this.replaceNode(node.id);
      this.publisher.markDirty(node.id, { machine: 'focus' });
      this.events.emit('node.transitioned', {
        id: node.id,
        machine: 'focus',
        from: 'focused',
        to: 'blurred',
      });
    }
    this.focusedIdValue = null;
    this.publisher.markGlobalsDirty();
    this.scheduleNotify();
  }

  // ===== Subscribe =====

  subscribe(fn: () => void): () => void {
    this.subscribers.add(fn);
    return () => {
      this.subscribers.delete(fn);
    };
  }

  private scheduleNotify(): void {
    this.publisher.schedule();
  }

  /**
   * Publish every pending change synchronously, bypassing `notifyMs`,
   * dwell, and stagger alike. Subscribers are notified before this returns.
   *
   * Use at a synchronization point where pending latency is unwanted — an
   * explicit user gesture that must feel immediate, or a test assertion.
   */
  flushNow(): void {
    this.publisher.flushNow();
  }

  /**
   * Run `fn` as one logical change, emitting `transaction.begin` /
   * `transaction.end` around it. Re-entrant: only the outermost call emits.
   *
   * Does NOT roll back. If `fn` throws, the pair still closes and the throw
   * propagates, but whatever was already mutated stays mutated.
   */
  transact(fn: () => void, label?: string): void {
    const outermost = this.txnDepth === 0;
    this.txnDepth += 1;
    if (outermost) {
      const beginPayload = label === undefined ? {} : { label };
      this.events.emit('transaction.begin', beginPayload);
    }
    let threw = false;
    try {
      fn();
    } catch (e) {
      threw = true;
      throw e;
    } finally {
      this.txnDepth -= 1;
      if (outermost) {
        const endPayload = label === undefined ? {} : { label };
        this.events.emit('transaction.end', endPayload);
        trace('store', `transact: ${label ?? '(unlabeled)'}${threw ? ' (threw)' : ''}`);
      }
    }
  }

  /**
   * Put this node's content in child 0 of a strip or grid container.
   *
   * Which of three things that means is forced by the node's position:
   * a node with a parent is **wrapped** in a new group; a node whose parent is
   * already a strip on the requested axis gets its new siblings **flattened**
   * in beside it; a root has nothing above it to interpose, so it **becomes**
   * the container.
   *
   * All ids are caller-supplied — the store has no id generator. Validation
   * runs before any mutation, so a rejected split leaves the store untouched.
   * Every node it registers is shown, unlike a bare `registerNode`.
   *
   * Runs inside `transact`, so a history integration bracketed on
   * `transaction.begin` / `transaction.end` records one undo step.
   */
  split(id: NodeId, input: SplitInput): void {
    splitNode(this, id, input);
  }

  /**
   * Dissolve a group into its parent: its children move up to the group's
   * index, in order, then the group is unregistered.
   *
   * Nothing calls this automatically. Removing the second-to-last child of a
   * split group leaves a one-child strip, which renders full-bleed and is
   * harmless; collapsing it is the consumer's call.
   *
   * A sole surviving child inherits the group's placement (size, pin); with
   * several children the group's placement is simply dropped.
   */
  unsplit(groupId: NodeId, opts?: MutateOptions): void {
    unsplitNode(this, groupId, opts);
  }

  /**
   * Put `sourceId` and `ontoId` in one tabbed stack. When `ontoId` already
   * lives in a stack this is an ordinary move into it; otherwise a new stack
   * container takes `ontoId`'s slot — same parent, same index, inheriting its
   * placement — and both nodes become its children.
   *
   * The new container gets `autoUnsplit`, so removing one of its last two
   * children dissolves it again.
   */
  stackNodes(
    sourceId: NodeId,
    ontoId: NodeId,
    opts: { id: NodeId; config?: Record<string, unknown> } & MutateOptions,
  ): void {
    const source = this.requireNode(sourceId);
    const onto = this.requireNode(ontoId);
    if (sourceId === ontoId) {
      throw new InvariantViolationError('stack-self', `cannot stack ${sourceId} onto itself`, {
        id: sourceId,
      });
    }
    if (this.isDescendantOf(ontoId, sourceId)) {
      throw new CycleError(sourceId, ontoId);
    }
    if (!onto.membership) {
      throw new CapabilityMissingError(ontoId, 'membership', 'stackNodes');
    }
    if (!source.membership) {
      throw new CapabilityMissingError(sourceId, 'membership', 'stackNodes');
    }
    const parentId = onto.membership.parentId;
    const parent = this.requireNode(parentId);

    if (parent.container?.strategyId === STACK_STRATEGY_ID) {
      this.transact(() => {
        this.moveNode(sourceId, parentId, undefined, opts);
        this.updateContainerConfig(parentId, { activeId: sourceId }, opts);
      }, 'stackNodes');
      return;
    }

    // Everything the transaction needs, checked before it opens: `transact`
    // does not roll back, so a throw from inside leaves a half-built stack.
    if (this.nodesMap.has(opts.id)) throw new DuplicateNodeError(opts.id);
    if (!parent.container) {
      throw new InvariantViolationError(
        'parent-not-container',
        `parent ${parentId} has no container capability`,
        { parentId, childId: ontoId },
      );
    }
    this.assertUnlocked(sourceId, 'move', 'stackNodes', opts);
    this.assertUnlocked(ontoId, 'move', 'stackNodes', opts);
    this.assertUnlocked(parentId, 'arrange', 'stackNodes', opts);
    this.assertUnlocked(parentId, 'accept', 'stackNodes', opts);
    this.assertUnlocked(parentId, 'dragOut', 'stackNodes', opts);
    this.assertUnlocked(source.membership.parentId, 'dragOut', 'stackNodes', opts);

    const at = parent.container.childOrder.indexOf(ontoId);
    const placement = { ...onto.membership.placement };

    this.transact(() => {
      this.registerNode(
        createNode({
          id: opts.id,
          kind: 'group',
          parentId,
          placement,
          container: {
            strategyId: STACK_STRATEGY_ID,
            // The pane you just moved is the one you expect to be looking at.
            config: { ...opts.config, activeId: sourceId },
          },
        }),
      );
      this.showNode(opts.id);
      this.setAutoUnsplit(opts.id, true);
      this.reorderInParent(opts.id, at);
      this.moveNode(ontoId, opts.id);
      this.moveNode(sourceId, opts.id);
    }, 'stackNodes');
    trace('store', `stack: ${sourceId} onto ${ontoId} in new ${opts.id}@${at}`);
  }

  /**
   * Snap the published view to truth and cancel pending flushes. Called by
   * `deserialize`; consumers should not need this.
   *
   * `Publisher.reset()` notifies subscribers synchronously — do NOT add a
   * second notification here or after the call in `deserialize`.
   *
   * @internal
   */
  resetPublished(): void {
    this.publisher.reset();
  }

  // ===== Internal helpers =====

  private requireNode(id: NodeId): Node {
    const node = this.nodesMap.get(id);
    if (!node) throw new NodeNotFoundError(id);
    return node;
  }

  /** Replace the node entry with a fresh object so referential subscribers
   *  re-render. Optionally transforms the node. */
  private replaceNode(id: NodeId, fn?: (n: Node) => Node): void {
    const prev = this.nodesMap.get(id);
    if (!prev) return;
    const next = fn ? fn(prev) : { ...prev };
    this.nodesMap.set(id, next);
    this.publisher.markDirty(id);
  }

  private replaceContainer(id: NodeId, fn: (c: ContainerCap) => ContainerCap): void {
    const prev = this.nodesMap.get(id);
    if (!prev?.container) return;
    const nextContainer = fn(prev.container);
    this.nodesMap.set(id, { ...prev, container: nextContainer });
    this.publisher.markDirty(id);
  }

  private replaceMembership(id: NodeId, fn: (s: MembershipCap) => MembershipCap): void {
    const prev = this.nodesMap.get(id);
    if (!prev?.membership) return;
    const nextMembership = fn(prev.membership);
    this.nodesMap.set(id, { ...prev, membership: nextMembership });
    this.publisher.markDirty(id);
  }
}

function clampIndex(at: number | undefined, length: number): number {
  if (at === undefined) return length;
  if (at < 0) return 0;
  if (at > length) return length;
  return at;
}

export interface MutateOptions {
  /** Bypass lock guards for this call. */
  force?: boolean;
}

function sameLock(a: LockSet, b: LockSet): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].every((k) => !a[k as LockAxis] === !b[k as LockAxis]);
}

function omitLock(n: Node): Node {
  const { lock: _lock, ...rest } = n;
  return rest;
}

// Re-export commonly used types for convenience.
export type { ContainerCap, FocusCap, MembershipCap };
