/**
 * A strategy's container config arrives as an untyped bag — `node.container.config`
 * is whatever the host registered — and every strategy casts it. A typo therefore
 * type-checks at the call site, casts cleanly, and silently takes the default.
 * A strategy that declares a `configSpec` gets those reported instead.
 */

/** What one config key accepts: a primitive type, or the set of allowed values. */
export type ConfigFieldSpec = 'number' | 'boolean' | 'string' | readonly string[];

/** Every key a strategy understands. Keys absent from the config are fine —
 *  strategy config is optional throughout. */
export type ConfigSpec = Readonly<Record<string, ConfigFieldSpec>>;

/**
 * A relationship between config keys that {@link ConfigSpec} cannot express,
 * because both keys are individually valid. Two shapes, and the difference
 * matters to whoever reads the diagnostic:
 *
 * - `exclusive` — the keys cancel each other and the strategy cannot honor
 *   both. Set one.
 * - `ignored` — `key` is valid, but a branch taken by any of `when` never
 *   reads it. The layout is the one `when` describes, and `key` does nothing.
 *
 * @group Layout
 */
export type ConfigConflict =
  | { readonly kind: 'exclusive'; readonly keys: readonly string[] }
  | { readonly kind: 'ignored'; readonly key: string; readonly when: readonly string[] };

/** Levenshtein distance, capped: only used to decide whether to name a
 *  suggestion, so the exact figure past the cap is worthless. */
function distance(a: string, b: string, cap: number): number {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(
        (prev[j] ?? 0) + 1,
        (row[j - 1] ?? 0) + 1,
        (prev[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = row;
  }
  return prev[b.length] ?? cap + 1;
}

function nearestKey(key: string, known: string[]): string | null {
  // Two edits: enough for a transposition plus a dropped letter ('axl' for
  // 'axis'), not enough to pair any two keys a real strategy declares.
  const cap = 2;
  let best: { key: string; d: number } | null = null;
  for (const candidate of known) {
    const d = distance(key.toLowerCase(), candidate.toLowerCase(), cap);
    if (d <= cap && (!best || d < best.d)) best = { key: candidate, d };
  }
  return best?.key ?? null;
}

/** "'a'", "'a' and 'b'", "'a', 'b' and 'c'" — read inside a sentence. */
function list(keys: readonly string[]): string {
  const quoted = keys.map((k) => `'${k}'`);
  if (quoted.length <= 1) return quoted[0] ?? '';
  return `${quoted.slice(0, -1).join(', ')} and ${quoted[quoted.length - 1]}`;
}

function describe(spec: ConfigFieldSpec): string {
  return Array.isArray(spec) ? spec.map((v) => `'${v}'`).join(' | ') : String(spec);
}

/**
 * Problems with `config` as `strategyName` understands it, as sentences ready
 * to trace. Empty when the config is fine, and when it is not an object —
 * there is nothing useful to say about a config that is not a bag of keys.
 *
 * @group Layout
 */
export function checkStrategyConfig(
  strategyName: string,
  config: unknown,
  spec: ConfigSpec,
  conflicts?: readonly ConfigConflict[],
): string[] {
  if (typeof config !== 'object' || config === null || Array.isArray(config)) return [];
  const known = Object.keys(spec);
  const problems: string[] = [];

  for (const [key, value] of Object.entries(config as Record<string, unknown>)) {
    if (value === undefined) continue;
    const field = spec[key];
    if (field === undefined) {
      const near = nearestKey(key, known);
      problems.push(
        near
          ? `${strategyName}: unknown config key '${key}' — did you mean '${near}'?`
          : `${strategyName}: unknown config key '${key}'`,
      );
      continue;
    }
    if (Array.isArray(field)) {
      if (!field.includes(value as string)) {
        problems.push(
          `${strategyName}: config '${key}' is ${JSON.stringify(value)}, expected ${describe(field)}`,
        );
      }
      continue;
    }
    if (typeof value !== field) {
      problems.push(
        `${strategyName}: config '${key}' is a ${typeof value}, expected a ${String(field)}`,
      );
    }
  }

  const bag = config as Record<string, unknown>;
  const set = (key: string): boolean => Object.hasOwn(bag, key) && bag[key] !== undefined;

  for (const conflict of conflicts ?? []) {
    if (conflict.kind === 'exclusive') {
      const clashing = conflict.keys.filter(set);
      if (clashing.length > 1) {
        problems.push(`${strategyName}: config ${list(clashing)} are mutually exclusive — set one`);
      }
      continue;
    }
    if (!set(conflict.key)) continue;
    const blockers = conflict.when.filter(set);
    if (blockers.length > 0) {
      problems.push(
        `${strategyName}: config '${conflict.key}' is ignored when ${list(blockers)} is set`,
      );
    }
  }

  return problems;
}
