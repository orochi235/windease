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

export interface BinarySplitState {
  ratio: number;
}

export interface BinarySplitMeta {
  direction: 'horizontal' | 'vertical';
  pixelsPerUnit: number;
}

interface BinarySplitOptions {
  direction?: 'horizontal' | 'vertical';
  gutterSize?: number;
  minRatio?: number;
  maxRatio?: number;
}

const DEFAULT_MIN = 0.05;
const DEFAULT_MAX = 0.95;

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

export const binarySplit: LayoutStrategy<BinarySplitState, string, BinarySplitMeta> = {
  name: 'binarySplit',
  initialState(_items: LayoutItem[]): BinarySplitState {
    return { ratio: 0.5 };
  },
  layout({ items, container, state, options }) {
    if (items.length !== 2) {
      throw new WindeaseError(
        'WRONG_ITEM_COUNT',
        `binarySplit requires exactly 2 items, got ${items.length}`,
      );
    }
    const cfg = options as BinarySplitOptions;
    const direction = cfg.direction ?? 'horizontal';
    const gutter = cfg.gutterSize ?? 4;
    const minR = cfg.minRatio ?? DEFAULT_MIN;
    const maxR = cfg.maxRatio ?? DEFAULT_MAX;
    const r = clamp(state.ratio, minR, maxR);

    const placements = new Map<string, Rect>();
    const a = items[0]!;
    const b = items[1]!;

    if (direction === 'horizontal') {
      const total = container.w;
      const halfG = gutter / 2;
      const aw = total * r - halfG;
      const bx = total * r + halfG;
      placements.set(a.id, { x: 0, y: 0, w: aw, h: container.h });
      placements.set(b.id, { x: bx, y: 0, w: total - bx, h: container.h });
      return {
        placements,
        affordances: [
          {
            id: 'split-0',
            kind: 'drag-x',
            rect: { x: aw, y: 0, w: gutter, h: container.h },
            cursor: 'col-resize',
            meta: { direction, pixelsPerUnit: 1 / total },
          },
        ],
      };
    }
    const total = container.h;
    const halfG = gutter / 2;
    const ah = total * r - halfG;
    const by = total * r + halfG;
    placements.set(a.id, { x: 0, y: 0, w: container.w, h: ah });
    placements.set(b.id, { x: 0, y: by, w: container.w, h: total - by });
    return {
      placements,
      affordances: [
        {
          id: 'split-0',
          kind: 'drag-y',
          rect: { x: 0, y: ah, w: container.w, h: gutter },
          cursor: 'row-resize',
          meta: { direction, pixelsPerUnit: 1 / total },
        },
      ],
    };
  },
  reduce(state, event, context) {
    if (event.kind !== 'drag') return state;
    const cfg = (context.options ?? {}) as BinarySplitOptions;
    const direction = cfg.direction ?? 'horizontal';
    const minR = cfg.minRatio ?? DEFAULT_MIN;
    const maxR = cfg.maxRatio ?? DEFAULT_MAX;
    const total = direction === 'horizontal' ? context.container.w : context.container.h;
    const delta = direction === 'horizontal' ? (event.payload.dx ?? 0) : (event.payload.dy ?? 0);
    if (total === 0) return state;
    return { ratio: clamp(state.ratio + delta / total, minR, maxR) };
  },
};
