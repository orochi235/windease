import { describe, expect, it } from 'vitest';
import { createTransitMachine } from './transit.js';

describe('transit machine', () => {
  it('starts idle', () => {
    expect(createTransitMachine().state).toBe('idle');
  });

  it('idle → claiming → idle', () => {
    const m = createTransitMachine();
    expect(m.send('beginClaim')).toBe(true);
    expect(m.state).toBe('claiming');
    expect(m.send('settle')).toBe(true);
    expect(m.state).toBe('idle');
  });

  it('idle → releasing → idle', () => {
    const m = createTransitMachine();
    expect(m.send('beginRelease')).toBe(true);
    expect(m.state).toBe('releasing');
    expect(m.send('settle')).toBe(true);
    expect(m.state).toBe('idle');
  });

  it('cannot begin another transit while in transit', () => {
    const m = createTransitMachine();
    m.send('beginClaim');
    expect(m.send('beginRelease')).toBe(false);
    expect(m.state).toBe('claiming');
  });
});
