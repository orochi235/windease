import { describe, expect, it } from 'vitest';
import { prng } from '../test-utils/exotic/invariants.js';
import { type ClampItem, clampExplicitSizes } from './resize.js';

interface Case {
  seed: number;
  available: number;
  items: ClampItem[];
}

/** 500 rows shaped like strip's: a few stored sizes among auto panes, some capped. */
const CASES: Case[] = Array.from({ length: 500 }, (_, seed) => {
  const r = prng(seed + 1);
  const n = r(1, 8);
  const items: ClampItem[] = Array.from({ length: n }, (_, i) => ({
    id: `p${i}`,
    explicit: r(0, 9) < 4 ? undefined : r(0, 900),
    min: r(0, 3) === 0 ? 0 : r(0, 300),
    max: r(0, 1) === 0 ? undefined : r(0, 500),
  }));
  return { seed: seed + 1, available: r(0, 1600), items };
});

const floorOf = (it: ClampItem) =>
  Math.min(it.min, it.max ?? Number.POSITIVE_INFINITY, it.explicit ?? Number.POSITIVE_INFINITY);

function violations(check: (c: Case, out: Map<string, number>) => string[]): string[] {
  return CASES.flatMap((c) => check(c, clampExplicitSizes(c)).map((v) => `seed ${c.seed}: ${v}`));
}

describe('clampExplicitSizes over generated strip rows', () => {
  it('sizes every item, finite and non-negative', () => {
    const bad = violations((c, out) =>
      c.items
        .filter((it) => {
          const v = out.get(it.id);
          return v === undefined || !Number.isFinite(v) || v < 0;
        })
        .map((it) => `${it.id}=${out.get(it.id)}`),
    );
    expect(bad.slice(0, 5)).toEqual([]);
  });

  it('never renders an item under its floor', () => {
    const bad = violations((c, out) =>
      c.items
        .filter((it) => (out.get(it.id) ?? 0) < floorOf(it) - 1e-6)
        .map((it) => `${it.id}=${out.get(it.id)} under ${floorOf(it)}`),
    );
    expect(bad.slice(0, 5)).toEqual([]);
  });

  it('caps a stored size at its max', () => {
    const bad = violations((c, out) =>
      c.items
        .filter((it) => it.explicit !== undefined && it.max !== undefined)
        .filter((it) => (out.get(it.id) ?? 0) > (it.max ?? 0) + 1e-6)
        .map((it) => `${it.id}=${out.get(it.id)} over ${it.max}`),
    );
    expect(bad.slice(0, 5)).toEqual([]);
  });

  // Defect: maxSize is not applied to an item with no stored size.
  it.fails('caps an auto item at its max', () => {
    const bad = violations((c, out) =>
      c.items
        .filter((it) => it.explicit === undefined && it.max !== undefined)
        .filter((it) => (out.get(it.id) ?? 0) > (it.max ?? 0) + 1e-6)
        .map((it) => `${it.id}=${out.get(it.id)} over ${it.max}`),
    );
    expect(bad.slice(0, 5)).toEqual([]);
  });

  // Defect: leftover is split equally, so a larger floor overflows a row that fits.
  it.fails('stays within the extent whenever the floors fit in it', () => {
    const bad = violations((c, out) => {
      const floors = c.items.reduce((s, it) => s + floorOf(it), 0);
      const used = c.items.reduce((s, it) => s + (out.get(it.id) ?? 0), 0);
      return floors <= c.available && used > c.available + 1e-6
        ? [`used ${used} of ${c.available} with floors ${floors}`]
        : [];
    });
    expect(bad.slice(0, 5)).toEqual([]);
  });
});

describe('clampExplicitSizes on the rows the strip fixtures isolate', () => {
  // Defect: leftover is split equally, so a larger floor overflows a row that fits.
  it.fails('slack: a 400px channel and a 380px thread fit the 780px left over', () => {
    const out = clampExplicitSizes({
      available: 1100,
      items: [
        { id: 'rail', explicit: 70, min: 0 },
        { id: 'sidebar', explicit: 260, min: 0 },
        { id: 'channel', explicit: undefined, min: 400 },
        { id: 'thread', explicit: undefined, min: 380 },
      ],
    });
    const used = [...out.values()].reduce((s, v) => s + v, 0);
    expect(used).toBeCloseTo(1100, 9);
    expect(out.get('channel')).toBeGreaterThanOrEqual(400);
    expect(out.get('thread')).toBeGreaterThanOrEqual(380);
  });

  // Defect: maxSize is not applied to an item with no stored size.
  it.fails('obsidian: the note stops at its 700px readable-line cap', () => {
    const out = clampExplicitSizes({
      available: 1920,
      items: [
        { id: 'files', explicit: 300, min: 200 },
        { id: 'note', explicit: undefined, min: 0, max: 700 },
        { id: 'outline', explicit: 300, min: 200 },
      ],
    });
    expect(out.get('note')).toBe(700);
  });
});
