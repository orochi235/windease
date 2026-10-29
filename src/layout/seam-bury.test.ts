import { describe, expect, it } from 'vitest';
import type { NodeId } from '../node.js';
import {
  buryOf,
  commitBury,
  commitJoin,
  DEFAULT_BURY_THRESHOLD,
  DEFAULT_JOIN_THRESHOLD,
  trackBury,
  trackJoin,
  trackReveal,
} from './seam-bury.js';

const BURY = { atMin: 'a' as NodeId, atMax: 'b' as NodeId, threshold: 24 };
const yes = () => true;
const no = () => false;

/** Defaults an unpinned seam, so each test names only the ends it cares about. */
function track(input: Partial<Parameters<typeof trackBury>[0]>) {
  return trackBury({
    bury: BURY,
    overshoot: 0,
    delta: 0,
    atMin: false,
    atMax: false,
    canDestroy: yes,
    ...input,
  });
}

describe('trackBury — an unpinned seam is resizing, not overshooting', () => {
  it('does not arm on a single fast move while the seam still has room', () => {
    expect(track({ overshoot: 0, delta: 200 })).toEqual({ armed: false, overshoot: 0 });
  });

  it('does not arm across repeated fast moves while the seam still has room', () => {
    let state = track({ overshoot: 0, delta: 200 });
    state = track({ overshoot: state.overshoot, delta: 200 });
    expect(state).toEqual({ armed: false, overshoot: 0 });
    state = track({ overshoot: state.overshoot, delta: 200 });
    expect(state.overshoot).toBe(0);
    expect(state.armed).toBe(false);
  });
});

describe('trackBury — accumulation', () => {
  it('accumulates a move made against the max clamp, naming atMax', () => {
    expect(track({ overshoot: 0, delta: 30, atMax: true })).toEqual({
      armed: true,
      candidateId: 'b',
      overshoot: 30,
    });
  });

  it('accumulates across pinned moves', () => {
    const first = track({ overshoot: 0, delta: 15, atMax: true });
    expect(first).toEqual({ armed: false, candidateId: 'b', overshoot: 15 });
    expect(track({ overshoot: first.overshoot, delta: 15, atMax: true })).toEqual({
      armed: true,
      candidateId: 'b',
      overshoot: 30,
    });
  });

  it('mirrors against the min clamp, naming atMin', () => {
    expect(track({ overshoot: 0, delta: -30, atMin: true })).toEqual({
      armed: true,
      candidateId: 'a',
      overshoot: -30,
    });
  });

  it('does not arm at exactly the threshold', () => {
    expect(track({ overshoot: 0, delta: 24, atMax: true })).toEqual({
      armed: false,
      candidateId: 'b',
      overshoot: 24,
    });
  });

  it('does not arm at exactly the threshold in the negative direction', () => {
    expect(track({ overshoot: 0, delta: -24, atMin: true })).toEqual({
      armed: false,
      candidateId: 'a',
      overshoot: -24,
    });
  });

  it('ignores the far clamp when pushing toward the near one', () => {
    expect(track({ overshoot: 0, delta: 30, atMin: true })).toEqual({ armed: false, overshoot: 0 });
  });
});

// A strip squeezed below the sum of its floors reports both ends pinned at
// rest, with nothing having visibly stopped for the user.
describe('trackBury — a seam with no range at all', () => {
  it('does not accumulate travel toward max', () => {
    expect(track({ overshoot: 0, delta: 30, atMin: true, atMax: true })).toEqual({
      armed: false,
      overshoot: 0,
    });
  });

  it('does not accumulate travel toward min', () => {
    expect(track({ overshoot: 0, delta: -30, atMin: true, atMax: true })).toEqual({
      armed: false,
      overshoot: 0,
    });
  });
});

describe('trackBury — unpinned travel never adds to the push', () => {
  it('does not grow overshoot when the seam is free again', () => {
    expect(track({ overshoot: 5, delta: 20 })).toEqual({
      armed: false,
      candidateId: 'b',
      overshoot: 5,
    });
  });

  it('does not grow overshoot however fast the free seam is moving', () => {
    expect(track({ overshoot: 1, delta: 200 })).toEqual({
      armed: false,
      candidateId: 'b',
      overshoot: 1,
    });
  });

  it('still unwinds on reverse travel while free', () => {
    expect(track({ overshoot: 30, delta: -10 })).toEqual({
      armed: false,
      candidateId: 'b',
      overshoot: 20,
    });
  });
});

describe('trackBury — unwinding', () => {
  it('gives back overshoot once the seam moves again, and disarms', () => {
    expect(track({ overshoot: 30, delta: -10, atMax: true })).toEqual({
      armed: false,
      candidateId: 'b',
      overshoot: 20,
    });
  });

  it('stops at zero rather than arming the opposite direction', () => {
    expect(track({ overshoot: 20, delta: -50 })).toEqual({ armed: false, overshoot: 0 });
  });
});

describe('trackBury — the candidate', () => {
  it('names the candidate but refuses to arm when it cannot be destroyed', () => {
    expect(track({ overshoot: 0, delta: 30, atMax: true, canDestroy: no })).toEqual({
      armed: false,
      candidateId: 'b',
      overshoot: 30,
    });
  });

  it('has no candidate in a direction the strategy did not declare', () => {
    const oneWay = { atMax: 'b' as NodeId, threshold: 24 };
    expect(track({ bury: oneWay, overshoot: 0, delta: -30, atMin: true })).toEqual({
      armed: false,
      overshoot: -30,
    });
  });

  it('does not consult canDestroy when there is no candidate', () => {
    let asked = 0;
    track({
      bury: { threshold: 24 },
      overshoot: 0,
      delta: 30,
      atMax: true,
      canDestroy: () => {
        asked++;
        return true;
      },
    });
    expect(asked).toBe(0);
  });

  it('does not consult canDestroy below the threshold, which runs per pointermove', () => {
    let asked = 0;
    track({
      overshoot: 0,
      delta: 10,
      atMax: true,
      canDestroy: () => {
        asked++;
        return true;
      },
    });
    expect(asked).toBe(0);
  });
});

describe('trackBury — constants', () => {
  it('publishes the default threshold strategies fall back to', () => {
    expect(DEFAULT_BURY_THRESHOLD).toBe(24);
  });
});

describe('the names it had before 2.3', () => {
  it('runs trackJoin as trackBury, taking the bury as join', () => {
    const input = { overshoot: 0, delta: 30, atMin: false, atMax: true, canDestroy: yes };
    expect(trackJoin({ ...input, join: BURY })).toEqual(trackBury({ ...input, bury: BURY }));
  });

  it('keeps commitJoin and the threshold', () => {
    expect(commitJoin).toBe(commitBury);
    expect(DEFAULT_JOIN_THRESHOLD).toBe(DEFAULT_BURY_THRESHOLD);
  });

  it('reads a bury from a strategy that still emits join', () => {
    const rect = { x: 0, y: 0, z: 0, w: 4, h: 100 };
    expect(buryOf({ id: 's', kind: 'resize-x', rect, join: BURY })).toBe(BURY);
    expect(buryOf({ id: 's', kind: 'resize-x', rect, bury: BURY })).toBe(BURY);
  });
});

describe('trackReveal — a handle over a hidden pane', () => {
  const REVEAL = { id: 'side' as NodeId, threshold: 24, direction: 1 as const };

  it('does not arm inside the threshold', () => {
    expect(trackReveal({ reveal: REVEAL, travel: 0, delta: 24 })).toEqual({
      armed: false,
      travel: 24,
    });
  });

  it('arms once travel the way the pane opens passes the threshold', () => {
    const first = trackReveal({ reveal: REVEAL, travel: 0, delta: 20 });
    expect(trackReveal({ reveal: REVEAL, travel: first.travel, delta: 5 })).toEqual({
      armed: true,
      travel: 25,
    });
  });

  it('disarms when the pointer comes back inside the threshold', () => {
    expect(trackReveal({ reveal: REVEAL, travel: 40, delta: -30 })).toEqual({
      armed: false,
      travel: 10,
    });
  });

  it('counts nothing for travel away from where the pane opens', () => {
    expect(trackReveal({ reveal: REVEAL, travel: 0, delta: -200 })).toEqual({
      armed: false,
      travel: 0,
    });
  });

  it('reads a pane that opens toward the start of the axis the other way round', () => {
    const left = { ...REVEAL, direction: -1 as const };
    expect(trackReveal({ reveal: left, travel: 0, delta: -30 })).toEqual({
      armed: true,
      travel: -30,
    });
    expect(trackReveal({ reveal: left, travel: 0, delta: 30 })).toEqual({
      armed: false,
      travel: 0,
    });
  });
});
