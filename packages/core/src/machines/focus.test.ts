import { describe, it, expect } from 'vitest';
import { createFocusMachine } from './focus.js';

describe('focus machine', () => {
  it('starts blurred', () => {
    expect(createFocusMachine().state).toBe('blurred');
  });
  it('blurred → focused on focus', () => {
    const m = createFocusMachine();
    expect(m.send('focus')).toBe(true);
    expect(m.state).toBe('focused');
  });
  it('focused → blurred on blur', () => {
    const m = createFocusMachine();
    m.send('focus');
    expect(m.send('blur')).toBe(true);
    expect(m.state).toBe('blurred');
  });
  it('focusing while focused is a no-op (illegal)', () => {
    const m = createFocusMachine();
    m.send('focus');
    expect(m.send('focus')).toBe(false);
    expect(m.state).toBe('focused');
  });
});
