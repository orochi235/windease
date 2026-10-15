/** `placement.share` as a story readout: a bare number, or its axes. */
export function shareLabel(share: unknown): string | undefined {
  if (typeof share === 'number') return share.toFixed(3);
  if (typeof share !== 'object' || share === null) return undefined;
  const parts = Object.entries(share as Record<string, unknown>)
    .filter((e): e is [string, number] => typeof e[1] === 'number')
    .map(([axis, v]) => `${axis} ${v.toFixed(3)}`);
  return parts.length > 0 ? parts.join(', ') : undefined;
}
