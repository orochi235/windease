import { WindeaseError } from './errors.js';
import { TypedEmitter } from './events.js';
import { type SerializedStore, deserialize, serialize } from './snapshot.js';
import {
  type CreateWindowInput,
  type WindowId,
  type WindowRecord,
  type ZoneId,
  createWindowRecord,
} from './window.js';
import type { LayoutStrategy } from './layout-types.js';
import {
  type CreateZoneInput,
  type ZoneRecord,
  type ZoneItemMeta,
  createZoneRecord,
} from './zone.js';

export interface StoreEvents {
  'window.created': { id: WindowId };
  'window.destroyed': { id: WindowId };
  'window.transitioned': {
    id: WindowId;
    machine: 'lifecycle' | 'transit' | 'focus';
    from: string;
    to: string;
    event: string;
  };
  'zone.claimed': { zoneId: ZoneId; windowId: WindowId };
  'zone.released': { zoneId: ZoneId; windowId: WindowId };
  'zone.reordered': { zoneId: ZoneId };
  'zone.metaChanged': { zoneId: ZoneId; windowId: WindowId; meta: ZoneItemMeta };
  'zone.configChanged': { zoneId: ZoneId; config: Record<string, unknown> };
}

export class WindeaseStore {
  readonly events = new TypedEmitter<StoreEvents>();
  private readonly windows = new Map<WindowId, WindowRecord>();
  private readonly zones = new Map<ZoneId, ZoneRecord>();
  private readonly subscribers = new Set<() => void>();
  private notifyScheduled = false;

  // ---- Read ----
  getWindow(id: WindowId): WindowRecord | undefined {
    return this.windows.get(id);
  }
  getZone(id: ZoneId): ZoneRecord | undefined {
    return this.zones.get(id);
  }
  listZones(): ZoneRecord[] {
    return [...this.zones.values()];
  }
  /**
   * List window records, optionally filtered by zone or kind. When a
   * non-null `zoneId` filter is given, results are returned in the zone's
   * `windowIds` order (which honors the pinned-prefix invariant). Otherwise
   * results are in store insertion order.
   */
  listWindows(filter?: { zoneId?: ZoneId | null; kind?: string }): WindowRecord[] {
    if (filter && 'zoneId' in filter && filter.zoneId != null) {
      const z = this.zones.get(filter.zoneId);
      if (!z) return [];
      const out: WindowRecord[] = [];
      for (const wid of z.windowIds) {
        const w = this.windows.get(wid);
        if (!w) continue;
        if (filter.kind !== undefined && w.kind !== filter.kind) continue;
        out.push(w);
      }
      return out;
    }
    const out: WindowRecord[] = [];
    for (const w of this.windows.values()) {
      if (filter?.kind !== undefined && w.kind !== filter.kind) continue;
      if (filter && 'zoneId' in filter && w.zoneId !== filter.zoneId) continue;
      out.push(w);
    }
    return out;
  }

  // ---- Window lifecycle ----
  createWindow(input: CreateWindowInput): WindowId {
    if (this.windows.has(input.id)) {
      throw new WindeaseError('DUPLICATE_WINDOW', `window ${input.id} already exists`);
    }
    const w = createWindowRecord(input);
    this.windows.set(w.id, w);
    this.events.emit('window.created', { id: w.id });
    this.scheduleNotify();
    return w.id;
  }

  show(id: WindowId): void {
    const w = this.requireWindow(id);
    const prev = w.lifecycle.state;
    if (!w.lifecycle.send('show')) {
      throw new WindeaseError('ILLEGAL_TRANSITION', `cannot show window ${id} from ${prev}`);
    }
    this.emitTransition(id, 'lifecycle', prev, w.lifecycle.state, 'show');
    this.scheduleNotify();
  }

  hide(id: WindowId): void {
    const w = this.requireWindow(id);
    const prev = w.lifecycle.state;
    if (!w.lifecycle.send('hide')) {
      throw new WindeaseError('ILLEGAL_TRANSITION', `cannot hide window ${id} from ${prev}`);
    }
    this.emitTransition(id, 'lifecycle', prev, w.lifecycle.state, 'hide');
    this.scheduleNotify();
  }

  destroy(id: WindowId): void {
    const w = this.requireWindow(id);
    // Release from any zone first (full claim/release logic comes in Task 12).
    if (w.zoneId !== null) {
      const z = this.zones.get(w.zoneId);
      if (z) {
        z.windowIds = z.windowIds.filter((wid) => wid !== id);
        this.events.emit('zone.released', { zoneId: z.id, windowId: id });
      }
      w.zoneId = null;
    }
    const prev = w.lifecycle.state;
    w.lifecycle.send('destroy');
    this.emitTransition(id, 'lifecycle', prev, w.lifecycle.state, 'destroy');
    this.windows.delete(id);
    this.events.emit('window.destroyed', { id });
    this.scheduleNotify();
  }

  // ---- Zone management ----
  registerZone(input: CreateZoneInput): void {
    if (this.zones.has(input.id)) {
      throw new WindeaseError('DUPLICATE_ZONE', `zone ${input.id} already exists`);
    }
    this.zones.set(input.id, createZoneRecord(input));
    this.scheduleNotify();
  }

  unregisterZone(id: ZoneId, opts?: { orphan?: boolean }): void {
    const z = this.requireZone(id);
    if (z.windowIds.length > 0) {
      if (!opts?.orphan) {
        throw new WindeaseError(
          'ZONE_NOT_EMPTY',
          `zone ${id} still owns ${z.windowIds.length} window(s)`,
        );
      }
      for (const wid of [...z.windowIds]) {
        const w = this.windows.get(wid);
        if (w) w.zoneId = null;
        this.events.emit('zone.released', { zoneId: id, windowId: wid });
      }
      z.windowIds.length = 0;
    }
    this.zones.delete(id);
    this.scheduleNotify();
  }

  // ---- Ownership ----
  claim(zoneId: ZoneId, windowId: WindowId, at?: number, meta?: ZoneItemMeta): void {
    const z = this.requireZone(zoneId);
    const w = this.requireWindow(windowId);
    // If already in a zone, release first. This relies on transit settling
    // back to 'idle' so the subsequent beginClaim is always legal.
    if (w.zoneId !== null) this.release(windowId);

    const fromTransit = w.transit.state;
    if (!w.transit.send('beginClaim')) {
      throw new WindeaseError(
        'ILLEGAL_TRANSITION',
        `cannot claim window ${windowId} while transit=${fromTransit}`,
      );
    }
    this.emitTransition(windowId, 'transit', fromTransit, 'claiming', 'beginClaim');

    w.zoneId = zoneId;
    if (at === undefined || at < 0 || at > z.windowIds.length) {
      z.windowIds.push(windowId);
    } else {
      z.windowIds.splice(at, 0, windowId);
    }
    if (meta !== undefined) z.itemMeta.set(windowId, { ...meta });
    this.events.emit('zone.claimed', { zoneId, windowId });
    this.resortByPin(zoneId);

    w.transit.send('settle');
    this.emitTransition(windowId, 'transit', 'claiming', 'idle', 'settle');

    this.scheduleNotify();
  }

  release(windowId: WindowId): void {
    const w = this.requireWindow(windowId);
    if (w.zoneId === null) return;
    const z = this.zones.get(w.zoneId);

    const fromTransit = w.transit.state;
    if (!w.transit.send('beginRelease')) {
      throw new WindeaseError(
        'ILLEGAL_TRANSITION',
        `cannot release window ${windowId} while transit=${fromTransit}`,
      );
    }
    this.emitTransition(windowId, 'transit', fromTransit, 'releasing', 'beginRelease');

    const oldZone = w.zoneId;
    if (z) {
      z.windowIds = z.windowIds.filter((id) => id !== windowId);
      z.itemMeta.delete(windowId);
    }
    w.zoneId = null;
    this.events.emit('zone.released', { zoneId: oldZone, windowId });

    w.transit.send('settle');
    this.emitTransition(windowId, 'transit', 'releasing', 'idle', 'settle');

    this.scheduleNotify();
  }

  moveWindow(windowId: WindowId, toZoneId: ZoneId, at?: number): void {
    this.release(windowId);
    this.claim(toZoneId, windowId, at);
  }

  reorderInZone(zoneId: ZoneId, order: WindowId[]): void {
    const z = this.requireZone(zoneId);
    const current = new Set(z.windowIds);
    if (order.length !== current.size || order.some((id) => !current.has(id))) {
      throw new WindeaseError(
        'ILLEGAL_TRANSITION',
        `reorder set does not match zone ${zoneId} membership`,
      );
    }
    z.windowIds = [...order];
    this.events.emit('zone.reordered', { zoneId });
    // A reorder request that interleaves pinned/unpinned is silently snapped
    // back to the pinned-prefix invariant — drops near the pinned section
    // still land in a sensible spot for the user.
    this.resortByPin(zoneId);
    this.scheduleNotify();
  }

  /**
   * Stable-partition windowIds so all items whose itemMeta.pinned or
   * itemMeta.locked is truthy occupy a contiguous prefix. Locked items imply
   * pinned for layout purposes; they additionally resist drag/destroy in the
   * React layer. No-ops if the ordering is already correct.
   */
  private resortByPin(zoneId: ZoneId): void {
    const z = this.zones.get(zoneId);
    if (!z) return;
    if (!z.allowsPinning) return;
    const pinned: WindowId[] = [];
    const rest: WindowId[] = [];
    for (const wid of z.windowIds) {
      const m = z.itemMeta.get(wid);
      if (m?.pinned || m?.locked) pinned.push(wid);
      else rest.push(wid);
    }
    const next = [...pinned, ...rest];
    let changed = false;
    for (let i = 0; i < next.length; i++) {
      if (next[i] !== z.windowIds[i]) {
        changed = true;
        break;
      }
    }
    if (!changed) return;
    z.windowIds = next;
    this.events.emit('zone.reordered', { zoneId });
  }

  /**
   * Merge-patch a zone's strategy config. Keys set to `undefined` are
   * deleted. Emits `zone.configChanged` and schedules a notify so React
   * consumers re-read. Replaces direct mutation of `zone.config`, which
   * doesn't notify and silently bypasses history transactions.
   */
  updateZoneConfig(zoneId: ZoneId, patch: Record<string, unknown>): void {
    const z = this.requireZone(zoneId);
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) delete z.config[k];
      else z.config[k] = v;
    }
    this.events.emit('zone.configChanged', { zoneId, config: z.config });
    this.scheduleNotify();
  }

  /**
   * Flip a zone's pinned-prefix opt-in. When set true after being false,
   * re-runs resortByPin so existing pinned/locked items move to the front.
   */
  setZoneAllowsPinning(zoneId: ZoneId, allows: boolean): void {
    const z = this.requireZone(zoneId);
    if (z.allowsPinning === allows) return;
    z.allowsPinning = allows;
    this.events.emit('zone.configChanged', { zoneId, config: z.config });
    if (!allows) {
      // Disabling pinning clears any pending pin flags so consumers don't
      // carry inert state. `locked` is left in place — it semantically
      // means "system chrome" and still suppresses drag in the React layer.
      for (const [wid, meta] of z.itemMeta) {
        if (!('pinned' in meta)) continue;
        const next = { ...meta };
        delete next.pinned;
        z.itemMeta.set(wid, next);
        this.events.emit('zone.metaChanged', { zoneId, windowId: wid, meta: next });
      }
    } else {
      this.resortByPin(zoneId);
    }
    this.scheduleNotify();
  }

  // ---- Per-item meta ----
  getItemMeta(zoneId: ZoneId, windowId: WindowId): ZoneItemMeta | undefined {
    return this.zones.get(zoneId)?.itemMeta.get(windowId);
  }

  /**
   * Replace the item-meta bag for a windowId's membership in zoneId. Throws
   * if the window isn't currently a member of that zone — the bag is keyed
   * on the membership, not the window. Pass an empty object to clear.
   */
  setItemMeta(zoneId: ZoneId, windowId: WindowId, meta: ZoneItemMeta): void {
    const z = this.requireZone(zoneId);
    const w = this.requireWindow(windowId);
    if (w.zoneId !== zoneId) {
      throw new WindeaseError(
        'ILLEGAL_TRANSITION',
        `window ${windowId} is not a member of zone ${zoneId}`,
      );
    }
    const next: ZoneItemMeta = { ...meta };
    z.itemMeta.set(windowId, next);
    this.events.emit('zone.metaChanged', { zoneId, windowId, meta: next });
    this.resortByPin(zoneId);
    this.scheduleNotify();
  }

  /**
   * Merge-patch the item-meta bag. Keys set to `undefined` are deleted.
   * Throws if the window isn't currently a member of zoneId.
   */
  patchItemMeta(zoneId: ZoneId, windowId: WindowId, patch: ZoneItemMeta): void {
    const current = this.getItemMeta(zoneId, windowId) ?? {};
    const next: ZoneItemMeta = { ...current };
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) delete next[k];
      else next[k] = v;
    }
    this.setItemMeta(zoneId, windowId, next);
  }

  // ---- Focus ----
  focus(id: WindowId): void {
    const target = this.requireWindow(id);
    if (target.focus.state === 'focused') return;
    for (const w of this.windows.values()) {
      if (w.id === id) continue;
      if (w.focus.state === 'focused') {
        w.focus.send('blur');
        this.emitTransition(w.id, 'focus', 'focused', 'blurred', 'blur');
      }
    }
    target.focus.send('focus');
    this.emitTransition(id, 'focus', 'blurred', 'focused', 'focus');
    this.scheduleNotify();
  }

  // ---- Reactive ----
  subscribe(fn: () => void): () => void {
    this.subscribers.add(fn);
    return () => {
      this.subscribers.delete(fn);
    };
  }

  // ---- Persistence ----
  snapshot(): SerializedStore {
    return serialize(this.windows, this.zones);
  }

  hydrate(
    snap: SerializedStore,
    opts: { strategies: Record<string, LayoutStrategy<unknown, WindowId, unknown>> },
  ): void {
    const { windows, zones } = deserialize(snap, opts.strategies);
    this.windows.clear();
    this.zones.clear();
    for (const [k, v] of windows) this.windows.set(k, v);
    for (const [k, v] of zones) this.zones.set(k, v);
    this.scheduleNotify();
  }

  // ---- Internals ----
  private requireWindow(id: WindowId): WindowRecord {
    const w = this.windows.get(id);
    if (!w) throw new WindeaseError('UNKNOWN_WINDOW', `no window with id ${id}`);
    return w;
  }

  private requireZone(id: ZoneId): ZoneRecord {
    const z = this.zones.get(id);
    if (!z) throw new WindeaseError('UNKNOWN_ZONE', `no zone with id ${id}`);
    return z;
  }

  private emitTransition(
    id: WindowId,
    machine: 'lifecycle' | 'transit' | 'focus',
    from: string,
    to: string,
    event: string,
  ): void {
    this.events.emit('window.transitioned', { id, machine, from, to, event });
  }

  private scheduleNotify(): void {
    if (this.notifyScheduled) return;
    this.notifyScheduled = true;
    queueMicrotask(() => {
      this.notifyScheduled = false;
      for (const fn of this.subscribers) fn();
    });
  }
}
