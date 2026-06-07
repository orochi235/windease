import { describe, expect, it, vi } from 'vitest';
import { Machine } from './fsm.js';

describe('Machine', () => {
  type S = 'a' | 'b' | 'c';
  type E = 'go' | 'back' | 'noop';
  const def = {
    initial: 'a' as S,
    transitions: {
      a: { go: 'b' as S },
      b: { go: 'c' as S, back: 'a' as S },
      c: { back: 'b' as S },
    },
  };

  it('starts in initial state', () => {
    const m = new Machine<S, E>(def);
    expect(m.state).toBe('a');
  });

  it('transitions on legal event and returns true', () => {
    const m = new Machine<S, E>(def);
    expect(m.send('go')).toBe(true);
    expect(m.state).toBe('b');
  });

  it('returns false on illegal event and does not change state', () => {
    const m = new Machine<S, E>(def);
    expect(m.send('back')).toBe(false);
    expect(m.state).toBe('a');
  });

  it('can() reports without mutating', () => {
    const m = new Machine<S, E>(def);
    expect(m.can('go')).toBe(true);
    expect(m.can('back')).toBe(false);
    expect(m.state).toBe('a');
  });

  it('notifies subscribers with (next, prev, event)', () => {
    const m = new Machine<S, E>(def);
    const fn = vi.fn();
    m.subscribe(fn);
    m.send('go');
    expect(fn).toHaveBeenCalledWith('b', 'a', 'go');
  });

  it('subscriber unsubscribe stops notifications', () => {
    const m = new Machine<S, E>(def);
    const fn = vi.fn();
    const off = m.subscribe(fn);
    off();
    m.send('go');
    expect(fn).not.toHaveBeenCalled();
  });

  it('calls onEnter when entering a state', () => {
    const onB = vi.fn();
    const m = new Machine<S, E>({ ...def, onEnter: { b: onB } });
    m.send('go');
    expect(onB).toHaveBeenCalledTimes(1);
  });

  it('does not call onEnter on illegal transition', () => {
    const onB = vi.fn();
    const m = new Machine<S, E>({ ...def, onEnter: { b: onB } });
    m.send('back');
    expect(onB).not.toHaveBeenCalled();
  });
});
