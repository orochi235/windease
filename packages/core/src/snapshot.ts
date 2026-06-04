import { WindeaseError } from './errors.js';
import {
  type WindowId,
  type ZoneId,
  type WindowRecord,
  asWindowId,
  asZoneId,
  createWindowRecord,
} from './window.js';
import {
  type LayoutStrategy,
  type ZoneRecord,
  createZoneRecord,
} from './zone.js';

export interface SerializedWindow {
  id: string;
  kind: string;
  zoneId: string | null;
  lifecycle: string;
  transit: string;
  focus: string;
  hints: WindowRecord['hints'];
  meta: WindowRecord['meta'];
}

export interface SerializedZone {
  id: string;
  strategyName: string;
  windowIds: string[];
  config: Record<string, unknown>;
}

export interface SerializedStore {
  version: 1;
  windows: SerializedWindow[];
  zones: SerializedZone[];
}

export function serialize(
  windows: Map<WindowId, WindowRecord>,
  zones: Map<ZoneId, ZoneRecord>,
): SerializedStore {
  return {
    version: 1,
    windows: [...windows.values()].map((w) => ({
      id: w.id,
      kind: w.kind,
      zoneId: w.zoneId,
      lifecycle: w.lifecycle.state,
      transit: w.transit.state,
      focus: w.focus.state,
      hints: w.hints,
      meta: w.meta,
    })),
    zones: [...zones.values()].map((z) => ({
      id: z.id,
      strategyName: z.strategy.name,
      windowIds: [...z.windowIds],
      config: z.config,
    })),
  };
}

export function deserialize(
  snap: SerializedStore,
  strategies: Record<string, LayoutStrategy>,
): { windows: Map<WindowId, WindowRecord>; zones: Map<ZoneId, ZoneRecord> } {
  const windows = new Map<WindowId, WindowRecord>();
  for (const sw of snap.windows) {
    const w = createWindowRecord({
      id: asWindowId(sw.id),
      kind: sw.kind,
      hints: sw.hints,
      meta: sw.meta,
    });
    // Drive each machine to the persisted state via legal transitions.
    if (sw.lifecycle === 'visible') w.lifecycle.send('show');
    else if (sw.lifecycle === 'hidden') {
      w.lifecycle.send('show');
      w.lifecycle.send('hide');
    } else if (sw.lifecycle === 'destroyed') {
      // Destroyed windows are dropped on hydrate.
      continue;
    }
    if (sw.focus === 'focused') w.focus.send('focus');
    w.zoneId = sw.zoneId === null ? null : asZoneId(sw.zoneId);
    windows.set(w.id, w);
  }

  const zones = new Map<ZoneId, ZoneRecord>();
  for (const sz of snap.zones) {
    const strategy = strategies[sz.strategyName];
    if (!strategy) {
      throw new WindeaseError(
        'UNKNOWN_STRATEGY',
        `no strategy registered for name ${sz.strategyName}`,
      );
    }
    const z = createZoneRecord({
      id: asZoneId(sz.id),
      strategy,
      config: sz.config,
    });
    z.windowIds = sz.windowIds.map(asWindowId);
    zones.set(z.id, z);
  }
  return { windows, zones };
}
