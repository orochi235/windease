import type { FocusAdapter } from './types.js';

/**
 * Does nothing, on purpose. Core tests run against it, and it is what a host
 * with no platform focus concept installs. Its real job is keeping the
 * `FocusAdapter` interface honest: an interface with one implementation
 * always grows assumptions about that implementation.
 */
export const nullFocusAdapter: FocusAdapter = {
  present() {},
  announce() {},
};
