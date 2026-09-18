/**
 * Keys any container's `config` may carry whatever strategy it runs. The
 * strategy never reads them, so a strategy's `configSpec` does not list them.
 */

/**
 * Which drops a container takes, checked by the drag engine after `lock.accept`
 * and before `acceptPolicy`. `false` refuses every drop, a reorder within the
 * container included.
 *
 * @group Drag and drop
 */
export type AcceptsConfig =
  | false
  | {
      /** Only a source whose `node.kind` is listed may land here. */
      kinds?: readonly string[];
      /** Refuse a drop that would leave more than this many visible children.
       *  A reorder within the container is exempt. */
      max?: number;
    };

/**
 * The container-level keys of `node.container.config`.
 *
 * @group Drag and drop
 */
export interface ContainerConfigKeys {
  accepts?: AcceptsConfig;
}
