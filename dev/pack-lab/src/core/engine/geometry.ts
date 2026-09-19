// Mirrors PACK_EPSILON and fitsWithin in src/layout/pack.ts.

/** Tolerance, in pixels, for extent comparisons. */
export const EPSILON = 1e-6;

/** Whether an extent ending at `end` stays within `limit`, allowing float drift. */
export const fitsWithin = (end: number, limit: number): boolean => end <= limit + EPSILON;
