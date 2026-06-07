import {
  CapabilityMissingError,
  CycleError,
  DuplicateNodeError,
  InvariantViolationError,
  NodeNotFoundError,
} from './errors.js';
import { TypedEmitter } from './events.js';
import type { ContainerCap, FocusCap, Node, NodeId, SlotCap } from './node.js';
import { trace } from './trace.js';
import { validateKindShape } from './validators.js';

export interface NodeStoreEvents {
  'node.registered': { id: NodeId };
  'node.unregistered': { id: NodeId };
  'node.transitioned': {
    id: NodeId;
    machine: 'lifecycle' | 'transit' | 'focus';
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
   * Per-container strategy state (e.g. binarySplit ratio) changed. Stored on
   * `node.container.state`; round-trips through snapshot. By design this
   * field should NOT participate in undo/redo when v2 history lands —
   * resize gestures shouldn't pollute the timeline.
   */
  'container.stateChanged': { id: NodeId; from: unknown; to: unknown };
}

/**
 * WindeaseNodeStore — the v0.2 unified-node-model store.
 *
 * Single `nodes` map; every mutation that touches a node produces a fresh
 * Node object (record replacement) so React's useSyncExternalStore detects
 * the change via referential equality. FSM transitions are paired with a
 * node-record swap.
 *
 * Exists alongside the v0.1 `WindeaseStore`. Phase 7 deprecates the old one.
 */
export class WindeaseNodeStore {
  readonly events = new TypedEmitter<NodeStoreEvents>();
  private readonly nodesMap = new Map<NodeId, Node>();
  private readonly rootIdsArr: NodeId[] = [];
  private focusedIdValue: NodeId | null = null;
  private readonly subscribers = new Set<() => void>();
  private notifyScheduled = false;

  // ===== Read =====

  get nodes(): ReadonlyMap<NodeId, Node> {
    return this.nodesMap;
  }

  get rootIds(): readonly NodeId[] {
    return this.rootIdsArr;
  }

  get focusedId(): NodeId | null {
    return this.focusedIdValue;
  }

  getNode(id: NodeId): Node | undefined {
    return this.nodesMap.get(id);
  }

  getChildren(parentId: NodeId): readonly Node[] {
    const parent = this.nodesMap.get(parentId);
    if (!parent?.container) return [];
    const out: Node[] = [];
    for (const cid of parent.container.childIds) {
      const c = this.nodesMap.get(cid);
      if (c) out.push(c);
    }
    return out;
  }

  getParent(id: NodeId): Node | undefined {
    const node = this.nodesMap.get(id);
    if (!node?.slot) return undefined;
    return this.nodesMap.get(node.slot.parentId);
  }

  getAncestors(id: NodeId): readonly Node[] {
    const chain: Node[] = [];
    let current = this.nodesMap.get(id);
    while (current?.slot) {
      const parent = this.nodesMap.get(current.slot.parentId);
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

  isSlotted(id: NodeId): boolean {
    return !!this.nodesMap.get(id)?.slot;
  }

  hasFocus(id: NodeId): boolean {
    return !!this.nodesMap.get(id)?.focus;
  }

  getContainerView(
    id: NodeId,
  ): { childIds: readonly NodeId[]; config: unknown; allowsPinning: boolean } | null {
    const c = this.nodesMap.get(id)?.container;
    if (!c) return null;
    return { childIds: c.childIds, config: c.config, allowsPinning: c.allowsPinning };
  }

  // ===== Register / unregister =====

  registerNode(node: Node): void {
    validateKindShape(node);
    if (this.nodesMap.has(node.id)) {
      throw new DuplicateNodeError(node.id);
    }
    if (node.slot) {
      const parent = this.nodesMap.get(node.slot.parentId);
      if (!parent) throw new NodeNotFoundError(node.slot.parentId);
      if (!parent.container) {
        throw new InvariantViolationError(
          'parent-not-container',
          `parent ${node.slot.parentId} has no container capability`,
          { parentId: node.slot.parentId, childId: node.id },
        );
      }
      this.nodesMap.set(node.id, node);
      this.replaceContainer(parent.id, (c) => ({
        ...c,
        childIds: [...c.childIds, node.id],
      }));
      this.resortByPin(parent.id);
    } else {
      this.nodesMap.set(node.id, node);
      this.rootIdsArr.push(node.id);
    }
    this.events.emit('node.registered', { id: node.id });
    trace('store', `register: ${node.id} (kind=${node.kind})`);
    this.scheduleNotify();
  }

  unregisterNode(id: NodeId): void {
    const node = this.requireNode(id);

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

    if (this.focusedIdValue === id) this.focusedIdValue = null;
    this.detachAndRemove(id);
    this.events.emit('node.unregistered', { id });
    trace('store', `unregister: ${id}`);
    this.scheduleNotify();
  }

  private collectDescendants(parentId: NodeId, out: NodeId[]): void {
    const parent = this.nodesMap.get(parentId);
    if (!parent?.container) return;
    for (const cid of parent.container.childIds) {
      const child = this.nodesMap.get(cid);
      if (!child) continue;
      if (child.container) this.collectDescendants(cid, out);
      out.push(cid);
    }
  }

  /** Remove a node from its parent's childIds (or rootIds) and from the map.
   *  Does NOT cascade and does NOT emit. */
  private detachAndRemove(id: NodeId): void {
    const node = this.nodesMap.get(id);
    if (!node) return;
    if (node.slot) {
      const parent = this.nodesMap.get(node.slot.parentId);
      if (parent?.container) {
        this.replaceContainer(parent.id, (c) => ({
          ...c,
          childIds: c.childIds.filter((cid) => cid !== id),
        }));
      }
    } else {
      const idx = this.rootIdsArr.indexOf(id);
      if (idx >= 0) this.rootIdsArr.splice(idx, 1);
    }
    this.nodesMap.delete(id);
    if (this.focusedIdValue === id) this.focusedIdValue = null;
  }

  // ===== Move / reorder =====

  moveNode(id: NodeId, newParentId: NodeId, at?: number): void {
    const node = this.requireNode(id);
    if (!node.slot) {
      throw new InvariantViolationError('move-unslotted', `cannot move unslotted node ${id}`, {
        id,
      });
    }
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

    const fromParentId = node.slot.parentId;
    const fromContainer = this.nodesMap.get(fromParentId)?.container;
    if (!fromContainer) {
      throw new InvariantViolationError(
        'orphan-source',
        `node ${id} reports parent ${fromParentId} which is not a container`,
        { id, fromParentId },
      );
    }
    const fromIndex = fromContainer.childIds.indexOf(id);

    // Transit: idle → releasing
    const transit = node.slot.transit;
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
      childIds: c.childIds.filter((cid) => cid !== id),
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

    // Add to new parent, set new parentId on the slot
    this.replaceSlot(id, (s) => ({ ...s, parentId: newParentId }));
    const insertIndex = clampIndex(at, newParent.container.childIds.length);
    this.replaceContainer(newParentId, (c) => {
      const next = [...c.childIds];
      next.splice(insertIndex, 0, id);
      return { ...c, childIds: next };
    });
    const toIndex = this.nodesMap.get(newParentId)?.container?.childIds.indexOf(id) ?? insertIndex;

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
    this.events.emit('node.transitioned', {
      id,
      machine: 'transit',
      from: 'claiming',
      to: transit.state,
    });

    this.resortByPin(newParentId);
    this.scheduleNotify();
  }

  reorderInParent(id: NodeId, at: number): void {
    const node = this.requireNode(id);
    if (!node.slot) {
      throw new InvariantViolationError('reorder-unslotted', `node ${id} not slotted`, { id });
    }
    const parentId = node.slot.parentId;
    const parent = this.requireNode(parentId);
    if (!parent.container) {
      throw new InvariantViolationError(
        'parent-not-container',
        `parent ${parentId} has no container`,
        { parentId },
      );
    }
    const fromIndex = parent.container.childIds.indexOf(id);
    if (fromIndex < 0) {
      throw new InvariantViolationError(
        'orphan-source',
        `node ${id} not found in parent ${parentId} childIds`,
        { id, parentId },
      );
    }
    const targetIndex = clampIndex(at, parent.container.childIds.length - 1);
    if (targetIndex === fromIndex) return;
    this.replaceContainer(parentId, (c) => {
      const next = [...c.childIds];
      next.splice(fromIndex, 1);
      next.splice(targetIndex, 0, id);
      return { ...c, childIds: next };
    });
    this.resortByPin(parentId);
    const finalIndex = this.nodesMap.get(parentId)?.container?.childIds.indexOf(id) ?? targetIndex;
    this.events.emit('node.reordered', { parentId, id, fromIndex, toIndex: finalIndex });
    this.scheduleNotify();
  }

  private resortByPin(parentId: NodeId): void {
    const parent = this.nodesMap.get(parentId);
    if (!parent?.container?.allowsPinning) return;
    const pinned: NodeId[] = [];
    const rest: NodeId[] = [];
    for (const cid of parent.container.childIds) {
      const child = this.nodesMap.get(cid);
      const placement = child?.slot?.placement;
      if (placement?.pinned || placement?.locked) pinned.push(cid);
      else rest.push(cid);
    }
    const next = [...pinned, ...rest];
    let same = true;
    for (let i = 0; i < next.length; i++) {
      if (next[i] !== parent.container.childIds[i]) {
        same = false;
        break;
      }
    }
    if (same) return;
    this.replaceContainer(parentId, (c) => ({ ...c, childIds: next }));
  }

  private isDescendantOf(maybeDescendant: NodeId, ancestor: NodeId): boolean {
    let current = this.nodesMap.get(maybeDescendant);
    while (current?.slot) {
      if (current.slot.parentId === ancestor) return true;
      current = this.nodesMap.get(current.slot.parentId);
    }
    return false;
  }

  // ===== Placement / meta =====

  setPlacement(id: NodeId, key: string, value: unknown): void {
    this.patchPlacement(id, { [key]: value });
  }

  patchPlacement(id: NodeId, patch: Record<string, unknown>): void {
    const node = this.requireNode(id);
    if (!node.slot) {
      throw new CapabilityMissingError(id, 'slot', 'patchPlacement');
    }
    const prev = node.slot.placement;
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
    this.replaceSlot(id, (s) => ({ ...s, placement: next }));
    this.events.emit('node.placementChanged', { id, changes });
    if (node.slot.parentId) this.resortByPin(node.slot.parentId);
    this.scheduleNotify();
  }

  getPlacement(id: NodeId): Record<string, unknown> {
    return this.nodesMap.get(id)?.slot?.placement ?? {};
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

  updateContainerConfig(id: NodeId, patch: unknown): void {
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
   * Read the persisted strategy state for `id`'s container (e.g. binarySplit
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
  setContainerState(id: NodeId, state: unknown): void {
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
      // Clear pinned flags from children (locked retained for drag suppression).
      for (const cid of node.container.childIds) {
        const child = this.nodesMap.get(cid);
        if (child?.slot?.placement?.pinned) {
          const nextPlacement = { ...child.slot.placement };
          delete nextPlacement.pinned;
          this.replaceSlot(cid, (s) => ({ ...s, placement: nextPlacement }));
          this.events.emit('node.placementChanged', {
            id: cid,
            changes: { pinned: { from: true, to: undefined } },
          });
        }
      }
    } else {
      this.resortByPin(id);
    }
    this.scheduleNotify();
  }

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
    this.events.emit('node.transitioned', {
      id,
      machine: 'lifecycle',
      from: prev,
      to: node.lifecycle.state,
    });
    this.scheduleNotify();
  }

  // ===== Focus =====

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
    this.events.emit('node.transitioned', {
      id,
      machine: 'focus',
      from: 'blurred',
      to: 'focused',
    });
    this.focusedIdValue = id;
    this.scheduleNotify();
  }

  blurAll(): void {
    if (!this.focusedIdValue) return;
    const node = this.nodesMap.get(this.focusedIdValue);
    if (node?.focus) {
      node.focus.send('blur');
      this.replaceNode(node.id);
      this.events.emit('node.transitioned', {
        id: node.id,
        machine: 'focus',
        from: 'focused',
        to: 'blurred',
      });
    }
    this.focusedIdValue = null;
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
    if (this.notifyScheduled) return;
    this.notifyScheduled = true;
    queueMicrotask(() => {
      this.notifyScheduled = false;
      for (const fn of this.subscribers) fn();
    });
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
  }

  private replaceContainer(id: NodeId, fn: (c: ContainerCap) => ContainerCap): void {
    const prev = this.nodesMap.get(id);
    if (!prev?.container) return;
    const nextContainer = fn(prev.container);
    this.nodesMap.set(id, { ...prev, container: nextContainer });
  }

  private replaceSlot(id: NodeId, fn: (s: SlotCap) => SlotCap): void {
    const prev = this.nodesMap.get(id);
    if (!prev?.slot) return;
    const nextSlot = fn(prev.slot);
    this.nodesMap.set(id, { ...prev, slot: nextSlot });
  }
}

function clampIndex(at: number | undefined, length: number): number {
  if (at === undefined) return length;
  if (at < 0) return 0;
  if (at > length) return length;
  return at;
}

// Re-export commonly used types for convenience.
export type { ContainerCap, FocusCap, SlotCap };
