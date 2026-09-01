/** The transition table defining a {@link Machine}: its initial state, which
 *  events move it where, and optional per-state entry callbacks. */
export interface MachineDef<S extends string, E extends string> {
  initial: S;
  transitions: { [from in S]?: { [event in E]?: S } };
  onEnter?: { [s in S]?: (m: Machine<S, E>) => void };
}

/** Notified after each accepted transition, with the new state, the previous
 *  one, and the event that caused it. */
export type MachineSubscriber<S extends string, E extends string> = (
  next: S,
  prev: S,
  event: E,
) => void;

/**
 * A minimal state machine backing every node capability. Transitions are
 * total: an event with no entry in the table is refused and `send` returns
 * `false` rather than throwing, so callers test rather than catch.
 *
 * Mutable and identity-stable, unlike the `Node` records that hold it.
 */
export class Machine<S extends string, E extends string = string> {
  state: S;
  private readonly def: MachineDef<S, E>;
  private readonly subs = new Set<MachineSubscriber<S, E>>();

  constructor(def: MachineDef<S, E>) {
    this.def = def;
    this.state = def.initial;
  }

  can(event: E): boolean {
    return this.def.transitions[this.state]?.[event] !== undefined;
  }

  send(event: E): boolean {
    const next = this.def.transitions[this.state]?.[event];
    if (next === undefined) return false;
    const prev = this.state;
    this.state = next;
    this.def.onEnter?.[next]?.(this);
    for (const fn of this.subs) fn(next, prev, event);
    return true;
  }

  subscribe(fn: MachineSubscriber<S, E>): () => void {
    this.subs.add(fn);
    return () => {
      this.subs.delete(fn);
    };
  }
}
