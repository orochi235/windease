import { describe, expect, it } from 'vitest';
import { systemClock } from './throttle.js';

describe('systemClock', () => {
  it('reports a monotonic-ish now()', () => {
    const a = systemClock.now();
    expect(typeof a).toBe('number');
    expect(systemClock.now()).toBeGreaterThanOrEqual(a);
  });

  it('schedules and cancels timers', async () => {
    let fired = false;
    const h = systemClock.setTimeout(() => {
      fired = true;
    }, 0);
    systemClock.clearTimeout(h);
    await new Promise((r) => setTimeout(r, 5));
    expect(fired).toBe(false);
  });
});
