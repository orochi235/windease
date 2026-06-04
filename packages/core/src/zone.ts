import type { Rect, LayoutStrategy } from './layout-types.js';
import type { WindowId, ZoneId } from './window.js';

// Re-export Rect as Placement for v0.1 source compatibility within core.
export type Placement = Rect;
export type { LayoutStrategy };

/**
 * Per-item meta: free-form key/value bag attached to a window *while it is a
 * member of a particular zone*. Cleared on release; not carried by moveWindow
 * (zone-specific by definition). Use for things like pin flags or other state
 * that lives at the window-in-zone joint rather than on the window itself
 * (see `WindowRecord.meta` for window-intrinsic meta).
 */
export type ZoneItemMeta = Record<string, unknown>;

export interface ZoneRecord {
  id: ZoneId;
  strategy: LayoutStrategy<unknown, WindowId, unknown>;
  windowIds: WindowId[];
  config: Record<string, unknown>;
  itemMeta: Map<WindowId, ZoneItemMeta>;
  /**
   * When false, the zone opts out of the pinned-prefix ordering invariant.
   * Item meta with `pinned` / `locked` keys can still be set (and `locked`
   * still suppresses drag in the React layer), but resortByPin no-ops and
   * windowIds reflects raw insertion / drag order. Defaults to true.
   */
  allowsPinning: boolean;
}

export interface CreateZoneInput {
  id: ZoneId;
  strategy: LayoutStrategy<unknown, WindowId, unknown>;
  config?: Record<string, unknown>;
  /** See ZoneRecord.allowsPinning. Defaults to true. */
  allowsPinning?: boolean;
}

export function createZoneRecord(input: CreateZoneInput): ZoneRecord {
  return {
    id: input.id,
    strategy: input.strategy,
    windowIds: [],
    config: input.config ?? {},
    itemMeta: new Map(),
    allowsPinning: input.allowsPinning ?? true,
  };
}
