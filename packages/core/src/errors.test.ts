import { describe, it, expect } from 'vitest';
import { WindeaseError } from './errors.js';

describe('WindeaseError', () => {
  it('carries code and message', () => {
    const e = new WindeaseError('UNKNOWN_WINDOW', 'no such id: x');
    expect(e.code).toBe('UNKNOWN_WINDOW');
    expect(e.message).toBe('no such id: x');
    expect(e.name).toBe('WindeaseError');
    expect(e instanceof Error).toBe(true);
  });
});
