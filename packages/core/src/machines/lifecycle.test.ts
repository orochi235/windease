import { describe, expect, it } from 'vitest';
import { createLifecycleMachine } from './lifecycle.js';

describe('lifecycle machine', () => {
  it('starts mounted', () => {
    const m = createLifecycleMachine();
    expect(m.state).toBe('mounted');
  });

  it('mounted → visible on show', () => {
    const m = createLifecycleMachine();
    expect(m.send('show')).toBe(true);
    expect(m.state).toBe('visible');
  });

  it('visible → hidden on hide', () => {
    const m = createLifecycleMachine();
    m.send('show');
    expect(m.send('hide')).toBe(true);
    expect(m.state).toBe('hidden');
  });

  it('hidden → visible on show (restore)', () => {
    const m = createLifecycleMachine();
    m.send('show');
    m.send('hide');
    expect(m.send('show')).toBe(true);
    expect(m.state).toBe('visible');
  });

  it('any non-destroyed → destroyed on destroy', () => {
    for (const start of ['mounted', 'visible', 'hidden'] as const) {
      const m = createLifecycleMachine();
      if (start === 'visible') m.send('show');
      if (start === 'hidden') {
        m.send('show');
        m.send('hide');
      }
      expect(m.send('destroy')).toBe(true);
      expect(m.state).toBe('destroyed');
    }
  });

  it('destroyed is terminal', () => {
    const m = createLifecycleMachine();
    m.send('destroy');
    expect(m.send('show')).toBe(false);
    expect(m.send('hide')).toBe(false);
    expect(m.send('destroy')).toBe(false);
    expect(m.state).toBe('destroyed');
  });
});
