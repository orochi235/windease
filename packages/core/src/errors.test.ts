import { describe, expect, it } from 'vitest';
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

import { describe as describe2, it as it2, expect as expect2 } from 'vitest';

describe2('WindeaseError - workspace codes', () => {
  for (const code of ['WRONG_ITEM_COUNT', 'UNKNOWN_AFFORDANCE_KIND', 'NO_INITIAL_STATE'] as const) {
    it2(`carries ${code}`, () => {
      const e = new WindeaseError(code, `test ${code}`);
      expect2(e.code).toBe(code);
      expect2(e.message).toBe(`test ${code}`);
    });
  }
});
