/**
 * A store write made while a component renders (a node registering itself)
 * invalidates its parent's layout, and React refuses an update to the parent
 * while the child renders. Writes run through `writeDuringRender` hold those
 * notifications until `releaseHeld`, which the writer calls from its layout
 * effect.
 */

let depth = 0;
const held = new Set<() => void>();

export function writeDuringRender<T>(fn: () => T): T {
  depth++;
  try {
    return fn();
  } finally {
    depth--;
  }
}

export function notifyOrHold(fn: () => void): void {
  if (depth === 0) {
    fn();
    return;
  }
  // A render React throws away never reaches its layout effect.
  if (held.size === 0) queueMicrotask(releaseHeld);
  held.add(fn);
}

export function releaseHeld(): void {
  if (held.size === 0) return;
  const fns = [...held];
  held.clear();
  for (const fn of fns) fn();
}
