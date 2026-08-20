import { describe, expect, it } from 'vitest';
import type { LayoutItem } from '../layout-types.js';
import { splitStrategy } from './split.js';

const items: LayoutItem[] = [{ id: 'a' }, { id: 'b' }];
const C = { w: 1200, h: 800 };

function rects(options: Record<string, unknown>) {
  const state = splitStrategy.initialState?.(items, options);
  return [
    ...splitStrategy
      .layout({ items, container: C, state: state as never, options })
      .placements.values(),
  ];
}

describe('split honors the documented `direction` option', () => {
  it('defaults to horizontal — panes side by side', () => {
    const [a, b] = rects({});
    if (!a || !b) throw new Error('expected two panes');
    expect(a.x).not.toBe(b.x);
    expect(a.y).toBe(b.y);
  });

  it('direction: vertical stacks panes instead', () => {
    const [a, b] = rects({ direction: 'vertical' });
    if (!a || !b) throw new Error('expected two panes');
    expect(a.x).toBe(b.x);
    expect(a.y).not.toBe(b.y);
    expect(a.w).toBe(C.w);
  });

  it('direction: horizontal is explicit and matches the default', () => {
    expect(rects({ direction: 'horizontal' })).toEqual(rects({}));
  });
});
