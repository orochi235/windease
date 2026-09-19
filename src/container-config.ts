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
}

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
}

/** Keys every strategy's config check accepts without declaring them. */
export const CONTAINER_CONFIG_KEYS: ReadonlySet<string> = new Set<keyof ContainerConfigKeys>([
  'accepts',
  'drop',
  'raise',
]);

/** `config.drop`, or an empty rule when it is absent or not an object. */
export function readDropConfig(config: unknown): DropConfig {
  const drop = (config as { drop?: unknown } | null | undefined)?.drop;
  return typeof drop === 'object' && drop !== null ? (drop as DropConfig) : {};
}
