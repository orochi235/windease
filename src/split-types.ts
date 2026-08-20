import type { NodeId } from './node.js';

/**
 * Input bag for `Store.split`. Discriminated on `direction`, so each mode
 * requires exactly the ids it needs.
 *
 * Named `SplitInput` to match `CreateNodeInput`.
 */
export type SplitInput =
  | {
      direction: 'x' | 'y';
      /** Total children after the split. Default 2, must be >= 2. */
      into?: number | undefined;
      /** Required in wrap mode; unused when flattening or reconfiguring. */
      groupId?: NodeId | undefined;
      /** Length must be `into - 1`. */
      newIds: readonly NodeId[];
      /** Merged over every container config this call writes. */
      config?: Record<string, unknown> | undefined;
      force?: boolean | undefined;
    }
  | {
      direction: 'both';
      /** `[cols, rows]`. Both >= 1, product >= 2. */
      into: readonly [number, number];
      /** Outer group, then one per column, left to right. */
      groupIds: readonly NodeId[];
      /** Length must be `cols * rows - 1`. Fills column-major. */
      newIds: readonly NodeId[];
      config?: Record<string, unknown> | undefined;
      force?: boolean | undefined;
    }
  | {
      /**
       * One `gridStrategy` container, no nesting.
       *
       * NOTE: `gridStrategy` honors `placement.span` but has no resize
       * affordances that write it, so a tiling built this way has **no
       * draggable gutters**. Use `'both'` if the panes must be resizable.
       */
      direction: 'grid';
      into: number;
      /** Passed through to the grid config; grid's default applies if omitted. */
      cols?: number | undefined;
      groupId?: NodeId | undefined;
      newIds: readonly NodeId[];
      config?: Record<string, unknown> | undefined;
      force?: boolean | undefined;
    };
