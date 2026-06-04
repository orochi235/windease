import type { Rect, LayoutStrategy } from './layout-types.js';
import type { WindowId, ZoneId } from './window.js';

// Re-export Rect as Placement for v0.1 source compatibility within core.
export type Placement = Rect;
export type { LayoutStrategy };

export interface ZoneRecord {
  id: ZoneId;
  strategy: LayoutStrategy<unknown, WindowId, unknown>;
  windowIds: WindowId[];
  config: Record<string, unknown>;
}

export interface CreateZoneInput {
  id: ZoneId;
  strategy: LayoutStrategy<unknown, WindowId, unknown>;
  config?: Record<string, unknown>;
}

export function createZoneRecord(input: CreateZoneInput): ZoneRecord {
  return {
    id: input.id,
    strategy: input.strategy,
    windowIds: [],
    config: input.config ?? {},
  };
}
