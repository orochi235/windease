import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { VERSION } from './index.js';

/**
 * `VERSION` is hand-written and read by nobody inside the library, so nothing
 * else fails when it goes stale — it sat at 1.0.0 through the 1.1.0 release.
 * This is the only thing that notices.
 */
describe('VERSION', () => {
  it('matches package.json', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      version: string;
    };
    expect(VERSION).toBe(pkg.version);
  });
});
