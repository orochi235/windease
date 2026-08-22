import { describe, expect, it } from 'vitest';
import type { NodeId } from '../node.js';
import { DEFAULT_JOIN_THRESHOLD, trackJoin } from './seam-join.js';

const JOIN = { atMin: 'a' as NodeId, atMax: 'b' as NodeId, threshold: 24 };
const yes = () => true;
const no = () => false;

describe('trackJoin', () => {
  it('reports no overshoot while the seam is still moving', () => {
    expect(trackJoin({ join: JOIN, requested: 60, consumed: 60, canDestroy: yes })).toEqual({
      armed: false,
      overshoot: 0,
    });
  });

  it('arms toward valueMax once past the threshold, naming atMax', () => {
    expect(trackJoin({ join: JOIN, requested: 150, consumed: 120, canDestroy: yes })).toEqual({
      armed: true,
      candidateId: 'b',
      overshoot: 30,
    });
  });

  it('arms toward valueMin naming atMin', () => {
    expect(trackJoin({ join: JOIN, requested: -150, consumed: -120, canDestroy: yes })).toEqual({
      armed: true,
      candidateId: 'a',
      overshoot: -30,
    });
  });

  it('does not arm at exactly the threshold', () => {
    expect(trackJoin({ join: JOIN, requested: 144, consumed: 120, canDestroy: yes })).toEqual({
      armed: false,
      candidateId: 'b',
      overshoot: 24,
    });
  });

  it('does not arm at exactly the threshold in the negative direction', () => {
    expect(trackJoin({ join: JOIN, requested: -144, consumed: -120, canDestroy: yes })).toEqual({
      armed: false,
      candidateId: 'a',
      overshoot: -24,
    });
  });

  it('names the candidate but refuses to arm when it cannot be destroyed', () => {
    expect(trackJoin({ join: JOIN, requested: 150, consumed: 120, canDestroy: no })).toEqual({
      armed: false,
      candidateId: 'b',
      overshoot: 30,
    });
  });

  it('has no candidate in a direction the strategy did not declare', () => {
    const oneWay = { atMax: 'b' as NodeId, threshold: 24 };
    expect(trackJoin({ join: oneWay, requested: -150, consumed: -120, canDestroy: yes })).toEqual({
      armed: false,
      overshoot: -30,
    });
  });

  it('does not consult canDestroy when there is no candidate', () => {
    let asked = 0;
    trackJoin({
      join: { threshold: 24 },
      requested: 150,
      consumed: 120,
      canDestroy: () => {
        asked++;
        return true;
      },
    });
    expect(asked).toBe(0);
  });

  it('does not consult canDestroy below the threshold, which runs per pointermove', () => {
    let asked = 0;
    trackJoin({
      join: JOIN,
      requested: 130,
      consumed: 120,
      canDestroy: () => {
        asked++;
        return true;
      },
    });
    expect(asked).toBe(0);
  });

  it('publishes the default threshold strategies fall back to', () => {
    expect(DEFAULT_JOIN_THRESHOLD).toBe(24);
  });
});
