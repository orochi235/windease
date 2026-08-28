/** Structural equality for strategy config bags, and the record guard both it
 *  and the reconcile patcher need. Its own module because `store` and
 *  `reconcile` both compare configs and `reconcile` imports `store`. */

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Structural equality, so a config literal rebuilt each render with the same
 *  values does not rewrite the store and notify its way into a render loop. */
export function sameConfig(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => sameConfig(v, b[i]));
  }
  if (!isRecord(a) || !isRecord(b)) return false;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((k) => k in b && sameConfig(a[k], b[k]));
}
