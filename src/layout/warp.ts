/**
 * Deformation passes: a layout is computed flat, then bent.
 *
 * A pass is a pure function from a `LayoutResult` (plus the arguments the
 * strategy got) to another `LayoutResult`. `warp` composes a strategy with a
 * list of them and hands back a `LayoutStrategy`, so `strategyId` resolution,
 * config checking and the affordance paths keep working.
 *
 * The rule for where a pass writes: to the rect when it changes where a child
 * is or how big it is, to a channel when it only changes how the child looks.
 * A consumer that ignores every channel still gets a correct, operable layout.
 */

import { WindeaseError } from '../errors.js';
import type {
  Affordance,
  LayoutEvent,
  LayoutItem,
  LayoutResult,
  LayoutStrategy,
  Rect,
  Size,
} from '../layout-types.js';
import { trace } from '../trace.js';
import type { ConfigSpec } from './config-check.js';

/** A point in a container's coordinate space. */
export interface Point {
  x: number;
  y: number;
}

/**
 * What a pass sees: exactly the arguments the base strategy was called with.
 *
 * `pointer` is the transient hover position `layout()` takes, already carried
 * back into *this* pass's input space by `warp` — a pass reads it without
 * knowing how many passes run after it.
 */
export interface PassArgs {
  items: LayoutItem[];
  container: Size;
  state: unknown;
  options: Record<string, unknown>;
  pointer?: Point | undefined;
}

/**
 * One deformation. `apply` maps a result into this pass's output space;
 * `invert` maps a point in that output space back to its input space, which is
 * what gestures run so a screen-space drag reaches the base strategy in table
 * space.
 *
 * `moves` says whether the pass changes any rect. A pass that moves nothing
 * (`bow`) inverts as the identity and may omit `invert`; one that claims a
 * deformation without supplying its inverse is refused by `warp`, at
 * composition time rather than at gesture time.
 */
export interface Pass {
  name: string;
  /** Config keys this pass reads, merged into the composed strategy's spec. */
  configSpec?: ConfigSpec;
  moves: boolean;
  apply(result: LayoutResult<string>, args: PassArgs): LayoutResult<string>;
  invert?(point: Point, args: PassArgs): Point;
}

// ---------------------------------------------------------------------------
// Option readers. House style: anything but a usable number reads as absent.
// ---------------------------------------------------------------------------

/** A finite number, else `fallback`. */
function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A finite number at or above zero, else `fallback`. */
function atLeastZero(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
}

/** A positive finite number, else `fallback`. */
function positiveOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

/** A finite number strictly inside 0..1, else `fallback`. */
function fractionOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value < 1
    ? value
    : fallback;
}

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

// ---------------------------------------------------------------------------
// Result plumbing.
// ---------------------------------------------------------------------------

/** `base` with `extra` merged in per id, key by key. Neither map is mutated,
 *  so two passes emitting channels for the same child both survive. */
export function mergeChannels(
  base: ReadonlyMap<string, Record<string, number>> | undefined,
  extra: ReadonlyMap<string, Record<string, number>>,
): Map<string, Record<string, number>> {
  const out = new Map<string, Record<string, number>>();
  for (const [id, values] of base ?? []) out.set(id, { ...values });
  for (const [id, values] of extra) out.set(id, { ...out.get(id), ...values });
  return out;
}

/**
 * `result` with every placement and affordance rect run through `map`, and
 * `channels` merged with whatever `map` emitted for that id. Affordance rects
 * go through the same map as placements, so a strip's seams stay under the
 * seams as drawn.
 */
function mapResult(
  result: LayoutResult<string>,
  map: (rect: Rect, id: string) => { rect: Rect; channels?: Record<string, number> },
): LayoutResult<string> {
  const placements = new Map<string, Rect>();
  const emitted = new Map<string, Record<string, number>>();
  for (const [id, rect] of result.placements) {
    const next = map(rect, id);
    placements.set(id, next.rect);
    if (next.channels) emitted.set(id, next.channels);
  }
  const affordances: Affordance<unknown>[] = result.affordances.map((affordance) => ({
    ...affordance,
    rect: map(affordance.rect, affordance.id).rect,
  }));
  const next: LayoutResult<string> = { ...result, placements, affordances };
  if (emitted.size > 0) next.channels = mergeChannels(result.channels, emitted);
  return next;
}

// ---------------------------------------------------------------------------
// tilt
// ---------------------------------------------------------------------------

/**
 * Where the eye is. `tilt` 0 is top-down and leaves every rect untouched;
 * larger values push the far edge further toward the horizon. `horizon` is
 * where the far edge converges, as a fraction of container height, and
 * `vanishX` defaults to the container's midline.
 *
 * Every key is also a config key of the composed strategy, so a container can
 * override what the camera was constructed with.
 */
export interface Camera {
  tilt?: number;
  horizon?: number;
  vanishX?: number;
}

/** Where the far edge converges when `horizon` is absent or out of range. */
export const DEFAULT_HORIZON = 0.25;

interface Lens {
  /** Perspective strength: 0 is top-down. */
  c: number;
  /** Vanishing point. */
  vx: number;
  vy: number;
  /** Container height; the near edge is `y = h`. */
  h: number;
}

function lensOf(camera: Camera, args: PassArgs): Lens {
  const c = atLeastZero(args.options.tilt, atLeastZero(camera.tilt, 0));
  const horizon = fractionOr(args.options.horizon, fractionOr(camera.horizon, DEFAULT_HORIZON));
  const vx = finiteOr(args.options.vanishX, finiteOr(camera.vanishX, args.container.w / 2));
  return { c, vx, vy: horizon * args.container.h, h: args.container.h };
}

/** Depth of table-space `y`: 0 at the near edge, 1 at the far one. Unclamped,
 *  so the map stays invertible outside the container. */
function depthOf(y: number, lens: Lens): number {
  return lens.h > 0 ? (lens.h - y) / lens.h : 0;
}

/** How much a table-space point at depth `d` shrinks. `s(0) = 1`, so nothing
 *  at the near edge moves. */
function scaleAt(d: number, lens: Lens): number {
  const denominator = 1 + lens.c * d;
  return denominator > 1e-6 ? 1 / denominator : 1 / 1e-6;
}

/** A table-space point in screen space. */
function project(point: Point, lens: Lens): Point & { s: number; d: number } {
  const d = depthOf(point.y, lens);
  const s = scaleAt(d, lens);
  return {
    x: lens.vx + s * (point.x - lens.vx),
    y: lens.vy + s * (point.y - lens.vy),
    s,
    d,
  };
}

/**
 * A screen-space point back in table space — closed form, no numeric solve.
 *
 * Inverting `y' = vy + s(y)·(y − vy)` with `s(y) = H / (H + c·(H − y))` gives
 * `y = (H(1+c)(y' − vy) + H·vy) / (H + c(y' − vy))`, and `x` follows from the
 * scale at the recovered depth.
 */
function unproject(point: Point, lens: Lens): Point {
  const { h, c, vx, vy } = lens;
  if (h <= 0 || c === 0) return { x: point.x, y: point.y };
  const denominator = h + c * (point.y - vy);
  // The one point with no preimage: the horizon's own vanishing line.
  if (Math.abs(denominator) < 1e-9) return { x: point.x, y: point.y };
  const y = (h * (1 + c) * (point.y - vy) + h * vy) / denominator;
  const s = scaleAt(depthOf(y, lens), lens);
  return { x: vx + (point.x - vx) / s, y };
}

/**
 * Draws the layout in one-point perspective: table space in, screen space out.
 *
 * The near edge (`y = container.h`) is fixed, scale falls monotonically with
 * depth, and `z` carries the depth in 0..1 with far = 1. Each rect keeps its
 * own near edge, so a child sitting on the near edge is untouched.
 *
 * Channels: `scale`, the child's own shrink factor, and `keystone`, the
 * far-edge-to-near-edge width ratio of its quad — a host that wants true
 * trapezoid fidelity builds a `matrix3d` from the two, and one that does not
 * uses `scale` alone.
 *
 * @group Layout
 */
export function tilt(camera: Camera = {}): Pass {
  return {
    name: 'tilt',
    moves: true,
    configSpec: { tilt: 'number', horizon: 'number', vanishX: 'number' },
    apply(result, args) {
      const lens = lensOf(camera, args);
      if (lens.c === 0 || lens.h <= 0) {
        trace('layout', `tilt: 0, ${result.placements.size} rects unchanged`);
        return result;
      }
      const next = mapResult(result, (rect) => {
        const near = project({ x: rect.x, y: rect.y + rect.h }, lens);
        const far = scaleAt(depthOf(rect.y, lens), lens);
        const w = rect.w * near.s;
        const h = rect.h * near.s;
        return {
          rect: { x: near.x, y: near.y - h, z: clamp01(near.d), w, h },
          channels: { scale: near.s, keystone: near.s > 0 ? far / near.s : 1 },
        };
      });
      trace(
        'layout',
        `tilt: ${result.placements.size} rects at tilt ${lens.c}, horizon ${lens.vy}/${lens.h}, vanish x ${lens.vx}`,
      );
      return next;
    },
    invert(point, args) {
      return unproject(point, lensOf(camera, args));
    },
  };
}

// ---------------------------------------------------------------------------
// swell
// ---------------------------------------------------------------------------

/**
 * How a run parts and magnifies under the cursor. `reach` is the falloff
 * radius in px along the main axis, `gain` the peak scale multiplier, `lift`
 * the peak displacement along the cross axis (toward the leading edge — up,
 * for a horizontal run).
 *
 * Dock magnification is `gain` with no `lift`; a card hand parting around the
 * pointer is `lift` with a small `gain`.
 */
export interface SwellOptions {
  reach?: number;
  gain?: number;
  lift?: number;
  axis?: 'x' | 'y';
}

/** Falloff radius when `reach` is absent or unusable. */
export const DEFAULT_REACH = 120;

interface Field {
  axis: 'x' | 'y';
  cursor: number;
  reach: number;
  /** Peak growth: `gain − 1`, so 0 is no magnification. */
  k: number;
  lift: number;
}

function fieldOf(options: SwellOptions, args: PassArgs): Field | null {
  const pointer = args.pointer;
  if (!pointer) return null;
  const axis = (args.options.swellAxis ?? options.axis) === 'y' ? 'y' : 'x';
  const reach = positiveOr(args.options.reach, positiveOr(options.reach, DEFAULT_REACH));
  const gain = positiveOr(args.options.gain, positiveOr(options.gain, 1));
  const lift = finiteOr(args.options.lift, finiteOr(options.lift, 0));
  if (gain === 1 && lift === 0) return null;
  return { axis, cursor: axis === 'x' ? pointer.x : pointer.y, reach, k: gain - 1, lift };
}

/** The falloff at distance `r` from the cursor: 1 under it, 0 at `reach`. */
function focusAt(r: number, field: Field): number {
  return r >= field.reach ? 0 : 1 - r / field.reach;
}

/**
 * The main-axis map: a coordinate is carried away from the cursor by the
 * growth of everything between it and the cursor. Its derivative is the local
 * scale `1 + k·focus`, so the cursor is a fixed point and a symmetric run's
 * displacements cancel.
 */
function swellMain(u: number, field: Field): number {
  const { cursor, reach, k } = field;
  const sign = u < cursor ? -1 : 1;
  const r = Math.abs(u - cursor);
  const grown = r >= reach ? r + (k * reach) / 2 : r * (1 + k) - (k * r * r) / (2 * reach);
  return cursor + sign * grown;
}

/** `swellMain` inverted — the quadratic's near root, in closed form. */
function swellMainInverse(u: number, field: Field): number {
  const { cursor, reach, k } = field;
  const sign = u < cursor ? -1 : 1;
  const grown = Math.abs(u - cursor);
  if (grown >= reach * (1 + k / 2)) return cursor + sign * (grown - (k * reach) / 2);
  if (Math.abs(k) < 1e-12) return cursor + sign * (grown / (1 + k));
  const disc = Math.max(0, (1 + k) * (1 + k) - (2 * k * grown) / reach);
  return cursor + (sign * (reach * (1 + k - Math.sqrt(disc)))) / k;
}

/**
 * Magnifies and parts a run around the cursor.
 *
 * With no `pointer` — or with neither `gain` nor `lift` set — it returns the
 * result untouched, so the static layout is the no-cursor case and needs no
 * separate path. A pointer outside the container is not special-cased: the
 * falloff handles it.
 *
 * Channels: `focus`, the falloff's own value for that child (0 at the edge of
 * `reach`, 1 under the cursor), and `lift`, the cross-axis displacement it was
 * given in px.
 *
 * @group Layout
 */
export function swell(options: SwellOptions = {}): Pass {
  const at = (point: Point, field: Field) => (field.axis === 'x' ? point.x : point.y);
  return {
    name: 'swell',
    moves: true,
    configSpec: { reach: 'number', gain: 'number', lift: 'number', swellAxis: ['x', 'y'] },
    apply(result, args) {
      const field = fieldOf(options, args);
      if (!field || result.placements.size === 0) {
        trace('layout', `swell: identity (${args.pointer ? 'no gain or lift' : 'no pointer'})`);
        return result;
      }
      const next = mapResult(result, (rect) => {
        const main = field.axis === 'x' ? rect.x + rect.w / 2 : rect.y + rect.h / 2;
        const cross = field.axis === 'x' ? rect.y + rect.h / 2 : rect.x + rect.w / 2;
        const focus = focusAt(Math.abs(main - field.cursor), field);
        const scale = 1 + field.k * focus;
        const w = rect.w * scale;
        const h = rect.h * scale;
        const nextMain = swellMain(main, field);
        const nextCross = cross - field.lift * focus;
        const centerX = field.axis === 'x' ? nextMain : nextCross;
        const centerY = field.axis === 'x' ? nextCross : nextMain;
        return {
          rect: { x: centerX - w / 2, y: centerY - h / 2, z: rect.z, w, h },
          channels: { focus, lift: field.lift * focus },
        };
      });
      trace(
        'layout',
        `swell: ${result.placements.size} rects around ${field.axis}=${field.cursor} (reach ${field.reach}, gain ${1 + field.k}, lift ${field.lift})`,
      );
      return next;
    },
    invert(point, args) {
      const field = fieldOf(options, args);
      if (!field) return point;
      const main = swellMainInverse(at(point, field), field);
      const focus = focusAt(Math.abs(main - field.cursor), field);
      const cross = (field.axis === 'x' ? point.y : point.x) + field.lift * focus;
      return field.axis === 'x' ? { x: main, y: cross } : { x: cross, y: main };
    },
  };
}

// ---------------------------------------------------------------------------
// bow
// ---------------------------------------------------------------------------

/** Total sweep, in radians, at `amount` 1. */
const FULL_SWEEP = Math.PI / 2;

/**
 * Bends a run onto a circle centered on the cross axis beyond the container,
 * and emits each child's tangential `angle`, in degrees.
 *
 * It touches no rect: a rotated child covers the same area centered on the
 * same point, so the rect stays truthful and the angle is decoration. That is
 * also why it needs no inverse — under `bow`, screen space *is* table space.
 *
 * `amount` is the fraction of a quarter turn the whole run sweeps; 0 or
 * unusable reads as no bend at all.
 *
 * @group Layout
 */
export function bow(amount = 0, axis: 'x' | 'y' = 'x'): Pass {
  return {
    name: 'bow',
    moves: false,
    configSpec: { bow: 'number', bowAxis: ['x', 'y'] },
    apply(result, args) {
      const bend = atLeastZero(args.options.bow, atLeastZero(amount, 0));
      const main = (args.options.bowAxis ?? axis) === 'y' ? 'y' : 'x';
      if (bend === 0 || result.placements.size < 2) {
        trace('layout', `bow: identity (${bend === 0 ? 'no bend' : 'run of under two'})`);
        return result;
      }
      const centers: number[] = [];
      for (const rect of result.placements.values()) {
        centers.push(main === 'x' ? rect.x + rect.w / 2 : rect.y + rect.h / 2);
      }
      const low = Math.min(...centers);
      const high = Math.max(...centers);
      const extent = high - low;
      if (extent <= 0) return result;
      const sweep = bend * FULL_SWEEP;
      const middle = (low + high) / 2;
      const emitted = new Map<string, Record<string, number>>();
      for (const [id, rect] of result.placements) {
        const center = main === 'x' ? rect.x + rect.w / 2 : rect.y + rect.h / 2;
        const t = (center - middle) / extent;
        emitted.set(id, { angle: (t * sweep * 180) / Math.PI });
      }
      trace(
        'layout',
        `bow: ${result.placements.size} rects over ${extent.toFixed(1)}px sweeping ${((sweep * 180) / Math.PI).toFixed(1)}° (radius ${(extent / sweep).toFixed(1)})`,
      );
      return { ...result, channels: mergeChannels(result.channels, emitted) };
    },
  };
}

// ---------------------------------------------------------------------------
// warp
// ---------------------------------------------------------------------------

/** Every pass's input-space pointer, innermost first: entry `i` is what pass
 *  `i` sees, and entry `0` is what the base strategy sees. */
function pointersFor(
  passes: Pass[],
  pointer: Point | undefined,
  args: PassArgs,
): (Point | undefined)[] {
  const out: (Point | undefined)[] = new Array(passes.length + 1);
  out[passes.length] = pointer;
  for (let i = passes.length - 1; i >= 0; i--) {
    const outer = out[i + 1];
    const pass = passes[i];
    out[i] = outer && pass?.invert ? pass.invert(outer, { ...args, pointer: outer }) : outer;
  }
  return out;
}

/** `point` carried from screen space back to the base strategy's table space. */
function invertPoint(passes: Pass[], point: Point, args: PassArgs): Point {
  const pointers = pointersFor(passes, args.pointer, args);
  let at = point;
  for (let i = passes.length - 1; i >= 0; i--) {
    const pass = passes[i];
    if (pass?.invert) at = pass.invert(at, { ...args, pointer: pointers[i + 1] });
  }
  return at;
}

/**
 * A `LayoutEvent` with its screen-space coordinates carried back into table
 * space. `point` is inverted directly; a delta is inverted as the difference
 * between the pointer's two positions, since the map is not linear and a
 * delta alone has no anchor. Without a `point` there is no anchor at all, so
 * the delta passes through — which is what a keyboard-synthesized drag wants,
 * its units being the strategy's own.
 */
function invertEvent(passes: Pass[], event: LayoutEvent, args: PassArgs): LayoutEvent {
  const { point, dx, dy } = event.payload;
  if (!point) return event;
  // A drag's own point is where the pointer is, and it is the only pointer a
  // gesture context carries — `swell` fixes the cursor, so reading it here is
  // exact rather than an approximation.
  const at: PassArgs = { ...args, pointer: args.pointer ?? point };
  const to = invertPoint(passes, point, at);
  const payload: LayoutEvent['payload'] = { point: to };
  if (dx !== undefined || dy !== undefined) {
    const from = invertPoint(passes, { x: point.x - (dx ?? 0), y: point.y - (dy ?? 0) }, at);
    if (dx !== undefined) payload.dx = to.x - from.x;
    if (dy !== undefined) payload.dy = to.y - from.y;
  }
  return { ...event, payload };
}

/**
 * `strategy` with `passes` run over its result, in order, as one strategy.
 *
 * ```ts
 * const hand = warp(stripStrategy, [bow(0.4), swell({ reach: 160, lift: 28 })]);
 * ```
 *
 * The composed `configSpec` is the base's keys plus each pass's, so a typo in
 * a camera key is caught like any other. Gestures run the passes' inverses in
 * reverse, so `reduce` and `dispatchAffordance` reach the base strategy in the
 * space it laid out in.
 *
 * Throws a `WindeaseError` at composition time — not at gesture time — for a
 * pass that moves rects without supplying an inverse.
 *
 * @group Layout
 */
export function warp<TState, TMeta = unknown>(
  strategy: LayoutStrategy<TState, string, TMeta>,
  passes: Pass[],
): LayoutStrategy<TState, string, TMeta> {
  for (const pass of passes) {
    if (pass.moves && !pass.invert) {
      throw new WindeaseError(
        'pass-not-invertible',
        `Pass '${pass.name}' moves rects but supplies no inverse; warp(${strategy.name}) cannot run gestures through it`,
      );
    }
  }

  const configSpec: Record<string, ConfigSpec[string]> = { ...strategy.configSpec };
  for (const pass of passes) Object.assign(configSpec, pass.configSpec);

  const name = `warp(${[strategy.name, ...passes.map((p) => p.name)].join(', ')})`;
  trace('layout', `${name}: composed over ${passes.length} pass(es)`);

  const composed: LayoutStrategy<TState, string, TMeta> = {
    name,
    configSpec,
    ...(strategy.configConflicts ? { configConflicts: strategy.configConflicts } : {}),
    layout(input) {
      const args: PassArgs = {
        items: input.items,
        container: input.container,
        state: input.state,
        options: input.options,
        ...(input.pointer ? { pointer: input.pointer } : {}),
      };
      const pointers = pointersFor(passes, input.pointer, args);
      const { pointer: _screen, ...rest } = input;
      const inner = pointers[0];
      let result = strategy.layout(inner ? { ...rest, pointer: inner } : rest) as LayoutResult<
        string,
        TMeta
      >;
      passes.forEach((pass, i) => {
        result = pass.apply(result as LayoutResult<string>, {
          ...args,
          pointer: pointers[i],
        }) as LayoutResult<string, TMeta>;
      });
      return result;
    },
  };

  if (strategy.initialState) {
    composed.initialState = (items, options) => strategy.initialState?.(items, options) as TState;
  }
  if (strategy.canAccept) {
    composed.canAccept = (items, options) => strategy.canAccept?.(items, options) ?? true;
  }
  if (strategy.navigate) composed.navigate = (input) => strategy.navigate?.(input);
  if (strategy.land) composed.land = (ctx) => strategy.land?.(ctx) as TState;
  if (strategy.float) composed.float = strategy.float;
  if (strategy.command) {
    composed.command = (state, cmd, context) => strategy.command?.(state, cmd, context) as TState;
  }
  if (strategy.reduce) {
    composed.reduce = (state, event, context) =>
      strategy.reduce?.(
        state,
        invertEvent(passes, event, { ...context, state }),
        context,
      ) as TState;
  }
  if (strategy.dispatchAffordance) {
    composed.dispatchAffordance = (ctx) => {
      strategy.dispatchAffordance?.({
        ...ctx,
        event: invertEvent(passes, ctx.event, {
          items: ctx.items,
          container: ctx.container,
          state: undefined,
          options: ctx.options,
        }),
      });
    };
  }

  return composed;
}
