import { describe, expect, it } from 'vitest';
import { FakeClock } from './fake-clock.js';

describe('FakeClock', () => {
  it('starts at 0 and advances', () => {
    const c = new FakeClock();
    expect(c.now()).toBe(0);
    c.advance(100);
    expect(c.now()).toBe(100);
  });

  it('fires timers due within the advance window', () => {
    const c = new FakeClock();
    const fired: string[] = [];
    c.setTimeout(() => fired.push('a'), 50);
    c.setTimeout(() => fired.push('b'), 150);
    c.advance(100);
    expect(fired).toEqual(['a']);
    c.advance(100);
    expect(fired).toEqual(['a', 'b']);
  });

  it('fires timers in due order, ties broken by creation order', () => {
    const c = new FakeClock();
    const fired: string[] = [];
    c.setTimeout(() => fired.push('second'), 10);
    c.setTimeout(() => fired.push('first'), 5);
    c.setTimeout(() => fired.push('tie'), 10);
    c.advance(20);
    expect(fired).toEqual(['first', 'second', 'tie']);
  });

  it('observes now() as the timer due time inside the callback', () => {
    const c = new FakeClock();
    let observed = -1;
    c.setTimeout(() => {
      observed = c.now();
    }, 30);
    c.advance(100);
    expect(observed).toBe(30);
  });

  it('does not fire cleared timers', () => {
    const c = new FakeClock();
    let fired = false;
    const h = c.setTimeout(() => {
      fired = true;
    }, 10);
    c.clearTimeout(h);
    c.advance(100);
    expect(fired).toBe(false);
  });

  it('fires timers scheduled from within a timer callback', () => {
    const c = new FakeClock();
    const fired: string[] = [];
    c.setTimeout(() => {
      fired.push('outer');
      c.setTimeout(() => fired.push('inner'), 10);
    }, 10);
    c.advance(100);
    expect(fired).toEqual(['outer', 'inner']);
  });
});
