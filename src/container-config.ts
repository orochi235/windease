import type { RaiseMode } from './policies.js';

/**
 * Keys any container's `config` may carry whatever strategy it runs. The
 * strategy never reads them, so a strategy's `configSpec` does not list them.
 */

/**
 * Which drops a container takes, checked by the drag engine after `lock.accept`
 * and before `acceptPolicy`. `false` refuses every drop, a reorder within the
 * container included; `'tear'` refuses every drop but a tab torn out of a
 * descendant stack whose config sets `tear`.
 *
 * @group Drag and drop
 */
export type AcceptsConfig =
  | false
  | 'tear'
  | {
      /** Only a source whose `node.kind` is listed may land here. */
      kinds?: readonly string[];
      /** Refuse a drop that would leave more than this many visible children.
       *  A reorder within the container is exempt. */
      max?: number;
    };

/**
 * Which restructuring drops a container resolves — the declarative form of the
 * React `stackOnDrop` / `splitOnDrop` props. A prop that is set, `false`
 * included, wins.
 *
 * @group Drag and drop
 */
export interface DropConfig {
  /** A drop on the middle of a child stacks the two into a tabbed container. */
  stack?: boolean;
  /** A drop on a child's cross-axis edge splits that child's slot in two. */
  split?: boolean;
  /** A drop on an empty cell of a grid places the child in that cell, as
   *  `placement.cell`, instead of at an index. */
  cell?: boolean;
  /** Under `split`, the pane a split drop places goes in a new container of
   *  this shape, as Golden Layout puts a dropped tab in a stack of its own. A
   *  pane that already has this strategy is placed as it is. */
  wrap?: WrapConfig;
}

/**
 * The container `drop.wrap` puts a split-dropped pane in.
 *
 * @group Drag and drop
 */
export interface WrapConfig {
  strategyId: string;
  /** Defaults to `'group'`. */
  kind?: string;
  config?: Record<string, unknown>;
  allowsPinning?: boolean;
  autoPrune?: boolean;
}

/**
 * How a container's children start a drag. `true`: a press anywhere on a
 * child's wrapper; `'handle'`: only a press on an element inside it marked
 * `data-windease-handle`. Read by the React layer, and inert without a
 * `<DragProvider>`.
 *
 * @group Drag and drop
 */
export type ReorderMode = true | 'handle';

/**
 * How a touch on a drag source behaves. `true` leaves every touch to the page,
 * so only a mouse or pen drags; `'hold'` lets a swipe scroll and starts a drag
 * once a finger presses and holds still.
 *
 * @group Drag and drop
 */
export type TouchScrollMode = true | 'hold';

/**
 * The container-level keys of `node.container.config`.
 *
 * @group Drag and drop
 */
export interface ContainerConfigKeys {
  accepts?: AcceptsConfig;
  drop?: DropConfig;
  /** Brings a focused (or clicked) child to the top of the stacking order. Read by the store. */
  raise?: RaiseMode;
  /** Makes every child a drag source without a `DragHandle` in its chrome. */
  reorder?: ReorderMode;
  /** Under `reorder`, let a touch on a child scroll the page: `true` never
   *  drags by touch, `'hold'` drags after a press and hold. Off by default, so
   *  a finger drags. */
  touchScroll?: boolean | TouchScrollMode;
}

/** Keys every strategy's config check accepts without declaring them. */
export const CONTAINER_CONFIG_KEYS: ReadonlySet<string> = new Set<keyof ContainerConfigKeys>([
  'accepts',
  'drop',
  'raise',
  'reorder',
  'touchScroll',
]);

/** `config.reorder` when it names a mode, else undefined. */
export function readReorderConfig(config: unknown): ReorderMode | undefined {
  const reorder = (config as { reorder?: unknown } | null | undefined)?.reorder;
  return reorder === true || reorder === 'handle' ? reorder : undefined;
}

/** `config.raise` when it names a mode, else undefined. */
export function readRaiseConfig(config: unknown): RaiseMode | undefined {
  const raise = (config as { raise?: unknown } | null | undefined)?.raise;
  return raise === 'click' || raise === 'focus' ? raise : undefined;
}

/** `config.touchScroll` when it names a mode, else undefined. */
export function readTouchScroll(config: unknown): TouchScrollMode | undefined {
  const mode = (config as { touchScroll?: unknown } | null | undefined)?.touchScroll;
  return mode === true || mode === 'hold' ? mode : undefined;
}

/** `config.drop`, or an empty rule when it is absent or not an object. */
export function readDropConfig(config: unknown): DropConfig {
  const drop = (config as { drop?: unknown } | null | undefined)?.drop;
  return typeof drop === 'object' && drop !== null ? (drop as DropConfig) : {};
}
