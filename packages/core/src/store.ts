import { WindeaseError } from './errors.js';
import { TypedEmitter } from './events.js';
import {
  type CreateWindowInput,
  type WindowId,
  type WindowRecord,
  type ZoneId,
  createWindowRecord,
} from './window.js';
import type { CreateZoneInput, ZoneRecord } from './zone.js';

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
      throw new WindeaseError(
        'ILLEGAL_TRANSITION',
        `cannot show window ${id} from ${prev}`,
      );
    }
    this.events.emit('window.transitioned', {
      id,
      machine: 'lifecycle',
      from: prev,
      to: w.lifecycle.state,
      event: 'show',
    });
    this.scheduleNotify();
  }

  hide(id: WindowId): void {
    const w = this.requireWindow(id);
    const prev = w.lifecycle.state;
    if (!w.lifecycle.send('hide')) {
      throw new WindeaseError(
        'ILLEGAL_TRANSITION',
        `cannot hide window ${id} from ${prev}`,
      );
    }
    this.events.emit('window.transitioned', {
      id,
      machine: 'lifecycle',
      from: prev,
      to: w.lifecycle.state,
      event: 'hide',
    });
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
    this.events.emit('window.transitioned', {
      id,
      machine: 'lifecycle',
      from: prev,
      to: 'destroyed',
      event: 'destroy',
    });
    this.windows.delete(id);
    this.events.emit('window.destroyed', { id });
    this.scheduleNotify();
  }

  // ---- Reactive ----
  subscribe(fn: () => void): () => void {
    this.subscribers.add(fn);
    return () => {
      this.subscribers.delete(fn);
    };
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

  private scheduleNotify(): void {
    if (this.notifyScheduled) return;
    this.notifyScheduled = true;
    queueMicrotask(() => {
      this.notifyScheduled = false;
      for (const fn of this.subscribers) fn();
    });
  }

  // Hooks for later tasks to call.
  protected _internalAccessZones(): Map<ZoneId, ZoneRecord> {
    return this.zones;
  }
}
