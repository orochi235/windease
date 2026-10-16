import { describe, expect, it } from 'vitest';
import type { LayoutItem } from '../layout-types.js';
import { checkStrategyConfig } from './config-check.js';
import { desktopStrategy } from './desktop.js';
import { floatingStrategy } from './floating.js';
import { innerConfig } from './inner-config.js';
import { shelfStrategy } from './shelf.js';
import { stripStrategy } from './strip.js';

const icon = (id: string): LayoutItem => ({
  id,
  hints: { preferredSize: { w: 50, h: 50 } },
  meta: { minimized: true },
});

/** Where the shelf under a desktop puts two minimized windows' icons. */
function iconXs(options: Record<string, unknown>) {
  const desk = desktopStrategy(shelfStrategy);
  const r = desk.layout({
    items: [icon('a'), icon('b')],
    container: { w: 400, h: 300 },
    state: desk.initialState?.([], options) ?? { inner: undefined },
    options: { minimize: 'icon', iconWidth: 50, iconHeight: 50, ...options },
  });
  return ['a', 'b'].map((id) => r.placements.get(id)?.x);
}

describe('innerConfig', () => {
  it('returns config.inner when it is an object', () => {
    expect(innerConfig({ gap: 1, inner: { gap: 2 } }, true)).toEqual({ gap: 2 });
  });

  it('falls back to the flat config, or to nothing', () => {
    expect(innerConfig({ gap: 1 }, true)).toEqual({ gap: 1 });
    expect(innerConfig({ gap: 1 }, false)).toEqual({});
  });
});

describe('a composite reading its inner config under inner', () => {
  it("hands the desktop's shelf config.inner, not the desktop's own keys", () => {
    expect(iconXs({ inner: { gap: 20 } })).toEqual([0, 70]);
  });

  it('still reads the inner keys flat when there is no inner', () => {
    expect(iconXs({ gap: 20 })).toEqual([0, 70]);
  });

  it('lets inner win over a flat key', () => {
    expect(iconXs({ gap: 5, inner: { gap: 20 } })).toEqual([0, 70]);
  });

  it("hands floating's inner strip config.inner", () => {
    const float = floatingStrategy(stripStrategy);
    const r = float.layout({
      items: [{ id: 'a' }, { id: 'b' }],
      container: { w: 200, h: 100 },
      state: float.initialState?.([], {}) as never,
      options: { inner: { axis: 'y', fill: true } },
    });
    expect(r.placements.get('b')?.y).toBe(50);
  });
});

describe('checking a composite config', () => {
  const desk = desktopStrategy(shelfStrategy);
  const check = (config: unknown) =>
    checkStrategyConfig(desk.name, config, desk.configSpec ?? {}, desk.configConflicts);

  it('checks keys under inner against the inner strategy, naming the path', () => {
    const [problem] = check({ inner: { gapp: 4 } });
    expect(problem).toContain("'inner.gapp'");
    expect(problem).toContain("'inner.gap'");
  });

  it('reports a flat inner key beside inner as ignored', () => {
    expect(check({ gap: 4, inner: { gap: 8 } })).toEqual([
      "desktop(shelf): config 'gap' is ignored when 'inner' is set",
    ]);
  });

  it('accepts the flat form on its own', () => {
    expect(check({ gap: 4, minimize: 'icon' })).toEqual([]);
  });

  it('does not take container-level keys under inner', () => {
    expect(check({ inner: { reorder: true } })[0]).toContain("'inner.reorder'");
  });
});
