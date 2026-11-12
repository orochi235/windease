import { describe, expect, it } from 'vitest';
import { captureTrace } from '../test-utils/capture-trace.js';
import { FakeClock } from '../test-utils/fake-clock.js';
import { startTouchHold, TOUCH_HOLD_DELAY, TOUCH_HOLD_SLOP } from './touchHold.js';

function hold(options: { delay?: number; slop?: number } = {}) {
  const clock = new FakeClock();
  let armed = 0;
  const h = startTouchHold(
    100,
    100,
    () => {
      armed++;
    },
    { ...options, clock, label: 'row' },
  );
  return { clock, h, armed: () => armed };
}

describe('startTouchHold', () => {
  it('arms once the press has held still for the delay', () => {
    const { clock, h, armed } = hold();
    clock.advance(TOUCH_HOLD_DELAY - 1);
    expect(armed()).toBe(0);
    expect(h.phase()).toBe('pending');
    clock.advance(1);
    expect(armed()).toBe(1);
    expect(h.phase()).toBe('armed');
  });

  it('tolerates drift within the slop', () => {
    const { clock, h, armed } = hold();
    expect(h.move(100 + TOUCH_HOLD_SLOP, 100)).toBe(true);
    clock.advance(TOUCH_HOLD_DELAY);
    expect(armed()).toBe(1);
  });

  it('cancels when the finger moves past the slop first, and never arms', () => {
    const { clock, h, armed } = hold();
    expect(h.move(100, 100 + TOUCH_HOLD_SLOP + 1)).toBe(false);
    expect(h.phase()).toBe('canceled');
    clock.advance(TOUCH_HOLD_DELAY * 2);
    expect(armed()).toBe(0);
    expect(clock.pending).toBe(0);
  });

  it('ignores the slop once armed, so the drag can move', () => {
    const { clock, h } = hold();
    clock.advance(TOUCH_HOLD_DELAY);
    expect(h.move(400, 400)).toBe(true);
    expect(h.phase()).toBe('armed');
  });

  it('cancel before the delay clears the timer; after arming it does nothing', () => {
    const early = hold();
    early.h.cancel('released');
    expect(early.clock.pending).toBe(0);
    early.clock.advance(TOUCH_HOLD_DELAY);
    expect(early.armed()).toBe(0);

    const late = hold();
    late.clock.advance(TOUCH_HOLD_DELAY);
    late.h.cancel('released');
    expect(late.h.phase()).toBe('armed');
  });

  it('takes its own delay and slop', () => {
    const { clock, h, armed } = hold({ delay: 100, slop: 2 });
    expect(h.move(102, 100)).toBe(true);
    clock.advance(100);
    expect(armed()).toBe(1);
    const loose = hold({ slop: 2 });
    expect(loose.h.move(103, 100)).toBe(false);
  });

  it('traces the arm and cancel transitions under dnd', () => {
    const cap = captureTrace('dnd');
    const a = hold();
    a.clock.advance(TOUCH_HOLD_DELAY);
    const b = hold();
    b.h.move(150, 100);
    expect(cap.matching(/touch hold/)).toEqual([
      `[windease:dnd] touch hold on row armed after ${TOUCH_HOLD_DELAY}ms`,
      `[windease:dnd] touch hold on row canceled: moved 50.0px > ${TOUCH_HOLD_SLOP} — left to scroll`,
    ]);
  });
});
