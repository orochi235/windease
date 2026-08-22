import { afterEach, describe, expect, it, vi } from 'vitest';
import { observePixelRatio } from './pixel-ratio.js';

/**
 * Records every query it was handed, so a test can assert the subscription was
 * re-armed at the *new* ratio rather than left on the stale one.
 */
class FakeMql {
  readonly listeners = new Set<() => void>();
  constructor(readonly query: string) {}
  addEventListener(_type: 'change', cb: () => void): void {
    this.listeners.add(cb);
  }
  removeEventListener(_type: 'change', cb: () => void): void {
    this.listeners.delete(cb);
  }
}

/** A stand-in `window`, so this stays a headless test of a DOM adapter. */
function fakeWindow(ratio: number) {
  const made: FakeMql[] = [];
  const win = {
    devicePixelRatio: ratio,
    matchMedia: (query: string): FakeMql => {
      const mql = new FakeMql(query);
      made.push(mql);
      return mql;
    },
  };
  vi.stubGlobal('window', win);
  return {
    made,
    queries: () => made.map((m) => m.query),
    /** Move the ratio and fire whatever the live subscription is holding. */
    change: (to: number) => {
      win.devicePixelRatio = to;
      for (const cb of [...(made.at(-1)?.listeners ?? [])]) cb();
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('observePixelRatio', () => {
  it('delivers the current ratio immediately', () => {
    fakeWindow(2);
    const seen: number[] = [];

    observePixelRatio((r) => seen.push(r));

    expect(seen).toEqual([2]);
  });

  it('re-arms at the new ratio, so a second change still reports', () => {
    const media = fakeWindow(1);
    const seen: number[] = [];

    observePixelRatio((r) => seen.push(r));
    media.change(2);
    media.change(3);

    expect(seen).toEqual([1, 2, 3]);
    // The trap: a resolution query embeds the ratio it was built with, so a
    // listener left on the original fires once and is then permanently false.
    expect(media.queries()).toEqual([
      '(resolution: 1dppx)',
      '(resolution: 2dppx)',
      '(resolution: 3dppx)',
    ]);
  });

  it('stops delivering after teardown and drops its listener', () => {
    const media = fakeWindow(1);
    const seen: number[] = [];

    const stop = observePixelRatio((r) => seen.push(r));
    stop();
    media.change(2);

    expect(seen).toEqual([1]);
    expect(media.made.every((m) => m.listeners.size === 0)).toBe(true);
  });

  it('suppresses a change that does not move the ratio', () => {
    const media = fakeWindow(1);
    const seen: number[] = [];

    observePixelRatio((r) => seen.push(r));
    media.change(1);

    expect(seen).toEqual([1]);
  });

  it('still primes once where matchMedia is missing', () => {
    vi.stubGlobal('window', { devicePixelRatio: 3 });
    const seen: number[] = [];

    const stop = observePixelRatio((r) => seen.push(r));

    expect(seen).toEqual([3]);
    expect(() => stop()).not.toThrow();
  });

  it('never calls back with no window at all', () => {
    vi.stubGlobal('window', undefined);
    const seen: number[] = [];

    const stop = observePixelRatio((r) => seen.push(r));

    expect(seen).toEqual([]);
    expect(() => stop()).not.toThrow();
  });
});
