import { describe, expect, it } from 'vitest';
import type { NodeId } from '../node.js';
import { DEFAULT_JOIN_THRESHOLD, trackJoin } from './seam-join.js';

const JOIN = { atMin: 'a' as NodeId, atMax: 'b' as NodeId, threshold: 24 };
const yes = () => true;
const no = () => false;

/** Defaults an unpinned seam, so each test names only the ends it cares about. */
function track(input: Partial<Parameters<typeof trackJoin>[0]>) {
  return trackJoin({
    join: JOIN,
    overshoot: 0,
    delta: 0,
    atMin: false,
    atMax: false,
    canDestroy: yes,
    ...input,
  });
}

describe('trackJoin — an unpinned seam is resizing, not overshooting', () => {
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

describe('trackJoin — accumulation', () => {
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

describe('trackJoin — unpinned travel never adds to the push', () => {
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

describe('trackJoin — unwinding', () => {
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

describe('trackJoin — the candidate', () => {
  it('names the candidate but refuses to arm when it cannot be destroyed', () => {
    expect(track({ overshoot: 0, delta: 30, atMax: true, canDestroy: no })).toEqual({
      armed: false,
      candidateId: 'b',
      overshoot: 30,
    });
  });

  it('has no candidate in a direction the strategy did not declare', () => {
    const oneWay = { atMax: 'b' as NodeId, threshold: 24 };
    expect(track({ join: oneWay, overshoot: 0, delta: -30, atMin: true })).toEqual({
      armed: false,
      overshoot: -30,
    });
  });

  it('does not consult canDestroy when there is no candidate', () => {
    let asked = 0;
    track({
      join: { threshold: 24 },
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

describe('trackJoin — constants', () => {
  it('publishes the default threshold strategies fall back to', () => {
    expect(DEFAULT_JOIN_THRESHOLD).toBe(24);
  });
});
