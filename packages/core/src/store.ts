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
import {
  type CreateZoneInput,
  type LayoutStrategy,
  type ZoneRecord,
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
  listWindows(filter?: { zoneId?: ZoneId | null; kind?: string }): WindowRecord[] {
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
  claim(zoneId: ZoneId, windowId: WindowId, at?: number): void {
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
    this.events.emit('zone.claimed', { zoneId, windowId });

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
    if (z) z.windowIds = z.windowIds.filter((id) => id !== windowId);
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
    this.scheduleNotify();
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

  hydrate(snap: SerializedStore, opts: { strategies: Record<string, LayoutStrategy> }): void {
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
