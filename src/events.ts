/** Default event-name → payload mapping for {@link TypedEmitter}: any name,
 *  any payload. Supply your own interface for checked event names. */
export type EventMap = Record<string, unknown>;

/**
 * Small synchronous emitter with event names and payloads checked against `M`.
 * `on` returns its own unsubscribe function.
 *
 * A throwing listener is logged and skipped so it can't take out the others,
 * which also means a thrown error will not reach the code that emitted.
 */
export class TypedEmitter<M extends object = EventMap> {
  private readonly listeners = new Map<keyof M, Set<(payload: unknown) => void>>();

  on<K extends keyof M>(event: K, fn: (payload: M[K]) => void): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(fn as (payload: unknown) => void);
    return () => {
      set?.delete(fn as (payload: unknown) => void);
    };
  }

  emit<K extends keyof M>(event: K, payload: M[K]): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const fn of set) {
      try {
        fn(payload);
      } catch (err) {
        // Listener errors are swallowed so one bad listener doesn't break others.
        console.error('[windease] event listener threw', err);
      }
    }
  }
}
