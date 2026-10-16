import type { LayoutStrategy } from '../layout-types.js';
import type { ConfigConflict, ConfigSpec } from './config-check.js';

/**
 * The config a composite hands the strategy it wraps: `config.inner` when that
 * is an object. Without it, `flat` decides: the composite's own config, which
 * is how desktop and floating read their inner strategy's keys before `inner`
 * existed, or nothing.
 */
export function innerConfig(options: unknown, flat: boolean): Record<string, unknown> {
  const bag = (options ?? {}) as Record<string, unknown>;
  const nested = bag.inner;
  if (typeof nested === 'object' && nested !== null && !Array.isArray(nested)) {
    return nested as Record<string, unknown>;
  }
  return flat ? bag : {};
}

/**
 * The `configSpec` and `configConflicts` of a composite whose inner config may
 * sit flat beside its own keys or under `inner`. Flat inner keys stay accepted;
 * beside `inner` they are reported as ignored, since `inner` wins.
 */
export function compositeSpec(
  own: ConfigSpec,
  inner: Pick<LayoutStrategy<unknown, string, unknown>, 'configSpec'> | undefined,
): { configSpec: ConfigSpec; configConflicts: ConfigConflict[] } {
  if (!inner) return { configSpec: own, configConflicts: [] };
  const innerSpec = inner.configSpec ?? {};
  const flatOnly = Object.keys(innerSpec).filter((k) => !(k in own));
  return {
    configSpec: { ...innerSpec, ...own, inner: inner.configSpec ?? 'object' },
    configConflicts: flatOnly.map((key) => ({ kind: 'ignored', key, when: ['inner'] })),
  };
}
