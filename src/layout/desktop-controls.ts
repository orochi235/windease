import { requestClose } from '../close.js';
import type { Affordance, LayoutItem, Rect, Size } from '../layout-types.js';
import { asNodeId } from '../node.js';
import type { Store } from '../store.js';
import { trace } from '../trace.js';
import type { ConfigConflict } from './config-check.js';
import { itemSize } from './item-place.js';

/** The boxes `controls` can list, in config or in a window's placement. */
export const DESKTOP_CONTROLS = ['close', 'minimize', 'zoom'] as const;

/** One window control. */
export type DesktopControl = (typeof DESKTOP_CONTROLS)[number];

/** The ends of the title band `controlsSide` accepts. */
export const DESKTOP_CONTROLS_SIDE = ['start', 'end'] as const;

/** Affordance id prefixes for the window controls. */
export const DESKTOP_MINIMIZE_PREFIX = 'desktop:minimize:';
export const DESKTOP_CLOSE_PREFIX = 'desktop:close:';
export const DESKTOP_ZOOM_PREFIX = 'desktop:zoom:';

const PREFIXES = [DESKTOP_CLOSE_PREFIX, DESKTOP_MINIMIZE_PREFIX, DESKTOP_ZOOM_PREFIX] as const;

/** Placement key a zoomed window keeps its pre-zoom rect under. */
export const ZOOM_RECORD_KEY = 'zoomRecord';

/**
 * What `zoom` wrote and what it replaced, as `sizeRecord` keeps for a float.
 * The window counts as zoomed only while its placement still holds `wrote`:
 * once anything else moves or resizes it, the record is stale and the next
 * zoom starts over.
 */
export interface ZoomRecord {
  wrote: { x: number; y: number; size: Size };
  /** Where the window showed, and the `placement.size` it had, if any. */
  prior: { x: number; y: number; size: { w?: number; h?: number } | null };
}

/** The `container.config` keys for window controls. */
export interface DesktopControlsConfig {
  /** Shorthand for `controls: ['minimize']`, kept for configs that predate it:
   *  a click box at the band's end that flips the window's `minimized`, and one
   *  over each iconified window that restores it. Ignored when `controls` is set. */
  minimizable?: boolean;
  /** The click boxes each title band carries, in order. A window's own
   *  `placement.controls` overrides it, and `[]` there turns them off. */
  controls?: readonly DesktopControl[];
  /** The end of the title band the boxes sit at. Default `'end'`. */
  controlsSide?: (typeof DESKTOP_CONTROLS_SIDE)[number];
}

/** Adds what `controls` makes of the older shorthand to a composite's spec. */
export function withControlConflicts<T extends { configConflicts: ConfigConflict[] }>(spec: T): T {
  return {
    ...spec,
    configConflicts: [
      ...spec.configConflicts,
      { kind: 'ignored', key: 'minimizable', when: ['controls'] },
    ],
  };
}

/** The id behind a control affordance and which control it is, or null when the
 *  id is not one. */
export function parseControl(affordanceId: string): { control: DesktopControl; id: string } | null {
  for (const prefix of PREFIXES) {
    if (affordanceId.startsWith(prefix)) {
      const control = prefix.slice('desktop:'.length, -1) as DesktopControl;
      return { control, id: affordanceId.slice(prefix.length) };
    }
  }
  return null;
}

function validList(value: unknown): DesktopControl[] | null {
  if (!Array.isArray(value)) return null;
  const out: DesktopControl[] = [];
  for (const c of value) {
    if (DESKTOP_CONTROLS.includes(c) && !out.includes(c)) out.push(c);
  }
  return out;
}

/** The controls `item`'s title band carries, in order. */
export function windowControls(item: LayoutItem, cfg: DesktopControlsConfig): DesktopControl[] {
  const own = validList(item.meta?.controls);
  if (own) return own;
  const shared = validList(cfg.controls);
  if (shared) return shared;
  return cfg.minimizable ? ['minimize'] : [];
}

function sameSize(a: unknown, b: Size): boolean {
  const s = a as { w?: unknown; h?: unknown } | undefined;
  return s?.w === b.w && s?.h === b.h;
}

/** The record of a window that is zoomed now, or undefined. */
export function zoomOf(placement: Record<string, unknown> | undefined): ZoomRecord | undefined {
  const rec = placement?.[ZOOM_RECORD_KEY] as ZoomRecord | undefined;
  if (!rec?.wrote) return undefined;
  const { x, y, size } = rec.wrote;
  if (placement?.x !== x || placement?.y !== y || !sameSize(placement?.size, size))
    return undefined;
  return rec;
}

function controlBox(
  control: DesktopControl,
  item: LayoutItem,
  box: Rect,
  minimized: boolean,
): Affordance {
  const prefix =
    control === 'close'
      ? DESKTOP_CLOSE_PREFIX
      : control === 'zoom'
        ? DESKTOP_ZOOM_PREFIX
        : DESKTOP_MINIMIZE_PREFIX;
  const label =
    control === 'close'
      ? 'close'
      : control === 'zoom'
        ? zoomOf(item.meta)
          ? 'restore size'
          : 'zoom'
        : minimized
          ? 'restore'
          : 'minimize';
  return {
    id: `${prefix}${item.id}`,
    kind: 'click',
    rect: box,
    cursor: 'pointer',
    label,
    childId: item.id,
  };
}

/** The restore box drawn over a window minimized to an icon. */
export function iconRestore(item: LayoutItem, rect: Rect): Affordance {
  return controlBox('minimize', item, rect, true);
}

/** One square box per control, `handleSize` on a side, packed against the
 *  band's start or end in listed order. */
export function controlAffordances(
  item: LayoutItem,
  rect: Rect,
  minimized: boolean,
  cfg: DesktopControlsConfig,
  handleSize: number,
): Affordance[] {
  const list = windowControls(item, cfg);
  if (list.length === 0) return [];
  const side = Math.min(handleSize, rect.h, rect.w / list.length);
  const start = cfg.controlsSide === 'start' ? rect.x : rect.x + rect.w - list.length * side;
  return list.map((control, i) =>
    controlBox(
      control,
      item,
      { x: start + i * side, y: rect.y, z: rect.z, w: side, h: side },
      minimized,
    ),
  );
}

/**
 * Answers a click on a control box. `shown` is where the window shows, which
 * zoom saves: a cascaded window has no stored `x` / `y` to save.
 */
export function dispatchControl(
  store: Store,
  affordanceId: string,
  shown: (id: string) => Rect | undefined,
  container: Size,
): void {
  const parsed = parseControl(affordanceId);
  if (!parsed) return;
  const id = asNodeId(parsed.id);
  if (parsed.control === 'close') {
    requestClose(store, id);
    return;
  }
  const placement = store.getNode(id)?.membership?.placement ?? {};
  if (parsed.control === 'minimize') {
    const minimized = placement.minimized === true;
    trace('layout', `desktop: ${id} ${minimized ? 'restored' : 'minimized'} by its toggle`);
    store.patchPlacement(id, { minimized: !minimized });
    return;
  }
  for (const axis of ['move', 'resize'] as const) {
    if (store.isLocked(id, axis)) {
      trace('layout', `desktop: ${id} zoom refused (lock.${axis})`);
      return;
    }
  }
  const zoomed = zoomOf(placement);
  if (zoomed) {
    const { x, y, size } = zoomed.prior;
    trace('layout', `desktop: ${id} unzoomed to ${x},${y}`);
    store.patchPlacement(id, { x, y, size: size ?? undefined, [ZOOM_RECORD_KEY]: undefined });
    return;
  }
  const rect = shown(id);
  if (!rect) return;
  const max = store.getNode(id)?.hints?.maxSize as Size | undefined;
  const size = {
    w: Math.min(container.w, max?.w ?? Number.POSITIVE_INFINITY),
    h: Math.min(container.h, max?.h ?? Number.POSITIVE_INFINITY),
  };
  const prior = (placement.size as ZoomRecord['prior']['size'] | undefined) ?? null;
  const record: ZoomRecord = {
    wrote: { x: 0, y: 0, size },
    prior: { x: rect.x, y: rect.y, size: prior },
  };
  const patch: Record<string, unknown> = { x: 0, y: 0, size, [ZOOM_RECORD_KEY]: record };
  if (placement.minimized === true) patch.minimized = undefined;
  trace('layout', `desktop: ${id} zoomed to ${size.w}x${size.h} from ${rect.x},${rect.y}`);
  store.patchPlacement(id, patch);
}

/**
 * What a title-band drag writes besides the position when the window carries a
 * zoom record: the pre-zoom size, if it is still zoomed, so the drag restores
 * it as macOS does, and the record's removal either way. The restored window
 * keeps the pointer at the same fraction of its band. Null with no record, and
 * under `lock.resize`, where the drag only moves the window.
 */
export function unzoomForDrag(
  store: Store,
  item: LayoutItem,
  band: Rect,
  at: { x: number; y: number },
  point: { x: number; y: number } | undefined,
): { at: { x: number; y: number }; size: Size | null; patch: Record<string, unknown> } | null {
  const placement = item.meta;
  if (!placement || placement[ZOOM_RECORD_KEY] === undefined) return null;
  const clear = { [ZOOM_RECORD_KEY]: undefined };
  const zoomed = zoomOf(placement);
  if (!zoomed) return { at, size: itemSize(item), patch: clear };
  if (store.isLocked(asNodeId(item.id), 'resize')) {
    trace('layout', `desktop: ${item.id} drag keeps its zoom (lock.resize)`);
    return null;
  }
  const prior = zoomed.prior.size;
  const restored: LayoutItem = { ...item, placement: { ...item.placement } };
  if (prior) restored.placement = { ...restored.placement, size: prior };
  else delete restored.placement?.size;
  const size = itemSize(restored);
  let x = at.x;
  if (point && size && band.w > 0) {
    const frac = Math.max(0, Math.min(1, (point.x - band.x) / band.w));
    x = point.x - frac * size.w;
  }
  trace('layout', `desktop: ${item.id} unzoomed by a drag`);
  return { at: { x, y: at.y }, size, patch: { ...clear, size: prior ?? undefined } };
}
