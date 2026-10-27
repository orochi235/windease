import { describe, expect, it, vi } from 'vitest';
import { Gesture, type GestureOptions } from './gesture.js';

function make<T = string>(over: Partial<GestureOptions<T>> = {}) {
  const commit = vi.fn<(target: T) => void>();
  const g = new Gesture<T>({ name: 'test', commit, ...over });
  return { g, commit };
}

describe('Gesture — begin', () => {
  it('starts inactive and becomes active on begin', () => {
    const { g } = make();
    expect(g.state()).toEqual({ active: false, armed: null, message: '' });
    expect(g.begin()).toBe(true);
    expect(g.state().active).toBe(true);
  });

  it('refuses to begin when the lock check names a reason', () => {
    const { g } = make({ refuse: () => 'lock.move' });
    expect(g.begin()).toBe(false);
    expect(g.state().active).toBe(false);
  });

  it('refuses a second begin while one is in flight', () => {
    const refuse = vi.fn(() => null);
    const { g } = make({ refuse });
    g.begin();
    expect(g.begin()).toBe(false);
    expect(refuse).toHaveBeenCalledTimes(1);
  });
});

describe('Gesture — arming', () => {
  it('arms on an offered target and reports it', () => {
    const { g } = make();
    g.begin();
    expect(g.offer('a')).toBe(true);
    expect(g.state().armed).toBe('a');
  });

  it('does not arm a target the lock check refuses', () => {
    const { g } = make({ permits: (t) => t !== 'locked' });
    g.begin();
    expect(g.offer('locked')).toBe(false);
    expect(g.state().armed).toBeNull();
  });

  it('disarms when offered nothing, without asking the lock check', () => {
    const permits = vi.fn(() => true);
    const { g } = make({ permits });
    g.begin();
    g.offer('a');
    permits.mockClear();
    expect(g.offer(null)).toBe(false);
    expect(g.state().armed).toBeNull();
    expect(permits).not.toHaveBeenCalled();
  });

  it('ignores an offer while inactive', () => {
    const { g } = make();
    expect(g.offer('a')).toBe(false);
    expect(g.state().armed).toBeNull();
  });

  it('reports an arm change once, however often the same target is offered', () => {
    const onArm = vi.fn();
    const { g } = make({ onArm });
    g.begin();
    g.offer('a');
    g.offer('a');
    g.offer('b');
    expect(onArm.mock.calls).toEqual([['a'], ['b']]);
  });

  it('treats targets as the same by `same` when given one', () => {
    const onArm = vi.fn();
    const { g } = make<{ id: string; at: number }>({ onArm, same: (a, b) => a.id === b.id });
    g.begin();
    g.offer({ id: 'a', at: 1 });
    g.offer({ id: 'a', at: 2 });
    expect(onArm).toHaveBeenCalledTimes(1);
    expect(g.state().armed).toEqual({ id: 'a', at: 2 });
  });
});

describe('Gesture — announcing', () => {
  it('describes the armed target and falls silent when disarmed', () => {
    const { g } = make({ describe: (t) => `${t} will close` });
    g.begin();
    g.offer('a');
    expect(g.state().message).toBe('a will close');
    g.offer(null);
    expect(g.state().message).toBe('');
  });

  it('notifies subscribers on begin, arm and end, not on a repeat offer', () => {
    const { g } = make();
    const seen: unknown[] = [];
    g.subscribe((s) => seen.push(s));
    g.begin();
    g.offer('a');
    g.offer('a');
    g.release();
    expect(seen).toEqual([
      { active: true, armed: null, message: '' },
      { active: true, armed: 'a', message: '' },
      { active: false, armed: null, message: '' },
    ]);
  });
});

describe('Gesture — release', () => {
  it('commits the armed target and ends', () => {
    const { g, commit } = make();
    g.begin();
    g.offer('a');
    expect(g.release()).toBe(true);
    expect(commit).toHaveBeenCalledWith('a');
    expect(g.state().active).toBe(false);
  });

  it('ends without committing when nothing is armed', () => {
    const onEnd = vi.fn();
    const { g, commit } = make({ onEnd });
    g.begin();
    expect(g.release()).toBe(false);
    expect(commit).not.toHaveBeenCalled();
    expect(onEnd).toHaveBeenCalledWith('cancel');
  });

  it('commits while still active, then ends', () => {
    const { g, commit } = make();
    commit.mockImplementation(() => expect(g.state().active).toBe(true));
    g.begin();
    g.offer('a');
    g.release();
    expect(g.state().active).toBe(false);
  });

  it('ends even when the commit throws, and lets the throw through', () => {
    const { g, commit } = make();
    commit.mockImplementation(() => {
      throw new Error('boom');
    });
    g.begin();
    g.offer('a');
    expect(() => g.release()).toThrow('boom');
    expect(g.state()).toEqual({ active: false, armed: null, message: '' });
  });

  it('reports the end as a commit to onEnd', () => {
    const onEnd = vi.fn();
    const { g } = make({ onEnd });
    g.begin();
    g.offer('a');
    g.release();
    expect(onEnd).toHaveBeenCalledWith('commit');
  });

  it('clears the arm when it ends', () => {
    const onArm = vi.fn();
    const { g } = make({ onArm });
    g.begin();
    g.offer('a');
    g.release();
    expect(onArm.mock.calls).toEqual([['a'], [null]]);
  });
});

describe('Gesture — undo', () => {
  it('runs the commit inside one labeled transaction', () => {
    const events: string[] = [];
    const transact = (fn: () => void, label?: string) => {
      events.push(`begin ${label}`);
      fn();
      events.push('end');
    };
    const { g, commit } = make({ undo: { transact, label: (t) => `drop ${t}` } });
    commit.mockImplementation(() => events.push('commit'));
    g.begin();
    g.offer('a');
    g.release();
    expect(events).toEqual(['begin drop a', 'commit', 'end']);
  });

  it('leaves the commit unbracketed when the label is undefined for that target', () => {
    const transact = vi.fn((fn: () => void) => fn());
    const { g, commit } = make({ undo: { transact, label: () => undefined } });
    g.begin();
    g.offer('a');
    g.release();
    expect(commit).toHaveBeenCalled();
    expect(transact).not.toHaveBeenCalled();
  });
});

describe('Gesture — cancel', () => {
  it('ends without committing, even when armed', () => {
    const onEnd = vi.fn();
    const { g, commit } = make({ onEnd });
    g.begin();
    g.offer('a');
    g.cancel('escape');
    expect(commit).not.toHaveBeenCalled();
    expect(g.state().active).toBe(false);
    expect(onEnd).toHaveBeenCalledWith('cancel');
  });

  it('does nothing while inactive', () => {
    const onEnd = vi.fn();
    const { g } = make({ onEnd });
    g.cancel('escape');
    expect(onEnd).not.toHaveBeenCalled();
  });

  it('a release after a cancel commits nothing', () => {
    const { g, commit } = make();
    g.begin();
    g.offer('a');
    g.cancel('escape');
    g.release();
    expect(commit).not.toHaveBeenCalled();
  });
});
