/**
 * Container config keys the store reads itself, rather than a strategy. Each
 * strategy that honors one lists it in its `configSpec` from here.
 */

/** The values `container.config.raise` accepts. The store raises on focus for
 *  both; `'click'` also raises on a click that moves no focus, in the React layer. */
export const RAISE_MODES = ['click', 'focus'] as const;

/** The values a stack's `config.show` accepts. `'dropped'` activates a child
 *  that arrives by `moveNode`, `moveNodes` or `registerNode`. */
export const STACK_SHOW = ['dropped'] as const;

/** The values a stack's `config.fallback` accepts: which visible child becomes
 *  active when the active one is unregistered, hidden or moved out. `'next'`
 *  and `'prev'` fall to the other side at an end; `'first'` clears `activeId`. */
export const STACK_FALLBACK = ['next', 'prev', 'first'] as const;

/** One of {@link RAISE_MODES}. */
export type RaiseMode = (typeof RAISE_MODES)[number];
